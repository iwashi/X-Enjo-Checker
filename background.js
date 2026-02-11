const FIXED_API_ENDPOINT = "https://api.beta.chakoshi.ntt.com/v1/guardrails/apply";

const DEFAULT_SETTINGS = {
  apiKey: "",
  guardrailId: "",
  threshold: 0.7,
  requestTimeoutMs: 10000
};

const SETTINGS_STORAGE = chrome.storage.local;
const LEGACY_STORAGE = chrome.storage.sync;
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const LEGACY_SETTINGS_KEYS = ["apiEndpoint", ...SETTINGS_KEYS];

let migrationPromise = null;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettingsMigrated();
});

void ensureSettingsMigrated();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ANALYZE_POST") {
    return false;
  }

  analyzePost(String(message.text || ""))
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: `Unexpected error: ${error?.message || String(error)}`
      })
    );

  return true;
});

async function analyzePost(text) {
  if (!text.trim()) {
    return { ok: true, shouldBlock: false, maxScore: 0, violations: [] };
  }

  const settings = await loadSettings();
  if (!settings.apiKey.trim()) {
    return {
      ok: false,
      error: "API key is not configured. Open extension options."
    };
  }
  if (!settings.guardrailId.trim()) {
    return {
      ok: false,
      error: "Guardrail ID is not configured. Open extension options."
    };
  }

  const payload = buildPayload(text, settings);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort("timeout"),
    settings.requestTimeoutMs
  );

  let response;
  let responseBody;
  let rawText = "";
  try {
    response = await fetch(FIXED_API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    rawText = await response.text();
  } catch (error) {
    const detail =
      error?.name === "AbortError"
        ? `Request timed out after ${settings.requestTimeoutMs} ms`
        : error?.message || String(error);
    return { ok: false, error: `Failed to call API: ${detail}` };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `API returned ${response.status}: ${truncate(rawText, 600)}`
    };
  }

  try {
    responseBody = rawText ? JSON.parse(rawText) : {};
  } catch (_error) {
    return {
      ok: false,
      error: `API returned non-JSON response: ${truncate(rawText, 600)}`
    };
  }

  const normalized = normalizeResult(responseBody);
  return {
    ok: true,
    shouldBlock: normalized.maxScore >= settings.threshold,
    maxScore: normalized.maxScore,
    threshold: settings.threshold,
    violations: normalized.violations,
    raw: responseBody
  };
}

function buildPayload(text, settings) {
  return {
    input: text,
    guardrail_id: settings.guardrailId
  };
}

function normalizeResult(data) {
  const guardrailsResult = data?.assessments?.guardrails_result;
  if (guardrailsResult && typeof guardrailsResult === "object") {
    const violations = extractGuardrailsViolations(guardrailsResult);
    const maxScore = violations.reduce(
      (max, violation) => Math.max(max, violation.score),
      0
    );
    return { maxScore: clamp01(maxScore), violations };
  }

  const violations = extractLegacyViolations(data);
  const maxScore = violations.reduce(
    (max, violation) => Math.max(max, violation.score),
    Number(data?.output?.riskScore || data?.riskScore || 0)
  );

  return { maxScore: clamp01(maxScore), violations };
}

function extractGuardrailsViolations(result) {
  const violations = [];
  const handled = new Set(["moderation", "prompt_guard", "pii_filter", "keyword_filter", "topic_control"]);

  const moderation = asObject(result.moderation);
  if (moderation) {
    const moderationScore = parseScore(
      moderation.unsafe_score,
      moderation.unsafe_flag ? 1 : 0
    );
    const detectedCategories = [];
    const categories = asObject(moderation.categories);
    if (categories) {
      for (const [categoryName, categoryInfo] of Object.entries(categories)) {
        if (asObject(categoryInfo)?.detected) {
          detectedCategories.push(categoryName);
        }
      }
    }
    const reason = detectedCategories.length
      ? `detected: ${detectedCategories.join(", ")}`
      : moderation.unsafe_flag
        ? "unsafe_flag=true"
        : "";
    pushViolation(violations, "moderation", moderationScore, reason);
  }

  const promptGuard = asObject(result.prompt_guard);
  if (promptGuard) {
    const promptScore = parseScore(
      promptGuard.unsafe_score,
      promptGuard.unsafe_flag ? 1 : 0
    );
    const reason = promptGuard.unsafe_flag ? "unsafe_flag=true" : "";
    pushViolation(violations, "prompt_guard", promptScore, reason);
  }

  const piiFilter = asObject(result.pii_filter);
  if (piiFilter) {
    const detected = Array.isArray(piiFilter.detect_pii_result)
      ? piiFilter.detect_pii_result
      : [];
    if (detected.length > 0) {
      const piiTypes = Array.from(
        new Set(
          detected
            .map((item) => String(item?.type || "").trim())
            .filter(Boolean)
        )
      );
      const reason = piiTypes.length > 0 ? `types: ${piiTypes.join(", ")}` : "";
      pushViolation(violations, "pii_filter", 1, reason);
    }
  }

  const keywordFilter = asObject(result.keyword_filter);
  if (keywordFilter) {
    const matches = Array.isArray(keywordFilter.matches)
      ? keywordFilter.matches
      : [];
    const keywords = matches
      .map((match) => String(match?.keyword || "").trim())
      .filter(Boolean);
    const matched = Boolean(keywordFilter.matched) || keywords.length > 0;
    if (matched) {
      const reason = keywords.length > 0 ? `keywords: ${keywords.join(", ")}` : "";
      pushViolation(violations, "keyword_filter", 1, reason);
    }
  }

  const topicControl = asObject(result.topic_control);
  if (topicControl) {
    const classification = String(topicControl.classification || "").toLowerCase();
    const isDeny =
      classification === "deny" || topicControl.is_topic_compliant === false;
    if (isDeny) {
      const reason = classification ? `classification=${classification}` : "";
      pushViolation(violations, "topic_control", 1, reason);
    }
  }

  for (const [key, value] of Object.entries(result)) {
    if (handled.has(key)) {
      continue;
    }
    const item = asObject(value);
    if (!item || !item.unsafe_flag) {
      continue;
    }
    pushViolation(violations, key, parseScore(item.unsafe_score, 1), "unsafe_flag=true");
  }

  return violations;
}

function extractLegacyViolations(data) {
  const candidateArrays = [
    data?.output?.violations,
    data?.violations,
    data?.output?.evaluations,
    data?.evaluations,
    data?.output?.results,
    data?.results
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeLegacyViolation).filter(Boolean);
    }
  }

  return [];
}

function normalizeLegacyViolation(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const rawScore =
    item.riskScore ??
    item.score ??
    item.probability ??
    item.confidence ??
    item.value ??
    0;

  return {
    category:
      item.category ||
      item.categoryName ||
      item.name ||
      item.id ||
      "unknown_category",
    score: clamp01(Number(rawScore)),
    reason:
      item.reason ||
      item.explanation ||
      item.description ||
      item.message ||
      ""
  };
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function parseScore(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return num;
  }
  return fallback;
}

function pushViolation(violations, category, score, reason) {
  const normalizedScore = clamp01(Number(score));
  if (normalizedScore <= 0) {
    return;
  }

  violations.push({
    category,
    score: normalizedScore,
    reason: String(reason || "")
  });
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function truncate(text, maxLength) {
  if (typeof text !== "string") {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

async function loadSettings() {
  await ensureSettingsMigrated().catch(() => {});
  const raw = await SETTINGS_STORAGE.get(SETTINGS_KEYS);
  return mergeSettings(raw);
}

function mergeSettings(raw) {
  return {
    apiKey:
      typeof raw.apiKey === "string" ? raw.apiKey : DEFAULT_SETTINGS.apiKey,
    guardrailId:
      typeof raw.guardrailId === "string"
        ? raw.guardrailId
        : DEFAULT_SETTINGS.guardrailId,
    threshold: sanitizeNumber(raw.threshold, DEFAULT_SETTINGS.threshold, 0, 1),
    requestTimeoutMs: sanitizeNumber(
      raw.requestTimeoutMs,
      DEFAULT_SETTINGS.requestTimeoutMs,
      2000,
      60000
    )
  };
}

function sanitizeNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

function ensureSettingsMigrated() {
  if (!migrationPromise) {
    migrationPromise = migrateLegacySettings().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
}

async function migrateLegacySettings() {
  const [localRaw, legacyRaw] = await Promise.all([
    SETTINGS_STORAGE.get(SETTINGS_KEYS),
    LEGACY_STORAGE.get(LEGACY_SETTINGS_KEYS)
  ]);

  const merged = mergeSettings({ ...legacyRaw, ...localRaw });
  const shouldWriteLocal = SETTINGS_KEYS.some((key) => localRaw[key] !== merged[key]);
  if (shouldWriteLocal) {
    await SETTINGS_STORAGE.set(merged);
  }

  const hasLegacyData = LEGACY_SETTINGS_KEYS.some((key) => legacyRaw[key] !== undefined);
  if (hasLegacyData) {
    await LEGACY_STORAGE.remove(LEGACY_SETTINGS_KEYS).catch(() => {});
  }
}
