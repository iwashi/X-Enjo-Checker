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

const el = {
  apiKey: document.getElementById("apiKey"),
  guardrailId: document.getElementById("guardrailId"),
  threshold: document.getElementById("threshold"),
  requestTimeoutMs: document.getElementById("requestTimeoutMs"),
  save: document.getElementById("save"),
  test: document.getElementById("test"),
  status: document.getElementById("status")
};

init().catch((error) => setStatus(`初期化エラー: ${error.message}`, false));

async function init() {
  await ensureSettingsMigrated().catch(() => {});
  const raw = await SETTINGS_STORAGE.get(SETTINGS_KEYS);
  const settings = normalizeSettings(raw);
  renderSettings(settings);
  bindEvents();
}

function bindEvents() {
  el.save.addEventListener("click", handleSave);
  el.test.addEventListener("click", handleTest);
}

function renderSettings(settings) {
  el.apiKey.value = settings.apiKey;
  el.guardrailId.value = settings.guardrailId;
  el.threshold.value = String(settings.threshold);
  el.requestTimeoutMs.value = String(settings.requestTimeoutMs);
}

async function handleSave() {
  const settings = collectSettings();
  const validationError = validateSettings(settings);
  if (validationError) {
    setStatus(validationError, false);
    return;
  }

  await SETTINGS_STORAGE.set(settings);
  setStatus("保存しました。", true);
}

async function handleTest() {
  const settings = collectSettings();
  const validationError = validateSettings(settings);
  if (validationError) {
    setStatus(validationError, false);
    return;
  }

  await SETTINGS_STORAGE.set(settings);
  setStatus("接続テスト中...", true);

  const response = await sendAnalyzeTestMessage("これは接続テスト用の投稿文です。");
  if (!response?.ok) {
    setStatus(`接続テスト失敗: ${response?.error || "unknown error"}`, false);
    return;
  }

  setStatus(
    `接続テスト成功。最大スコア: ${Number(response.maxScore || 0).toFixed(2)}`,
    true
  );
}

function collectSettings() {
  return {
    apiKey: el.apiKey.value.trim(),
    guardrailId: el.guardrailId.value.trim(),
    threshold: clamp(Number(el.threshold.value), 0, 1, DEFAULT_SETTINGS.threshold),
    requestTimeoutMs: clamp(
      Number(el.requestTimeoutMs.value),
      2000,
      60000,
      DEFAULT_SETTINGS.requestTimeoutMs
    )
  };
}

function validateSettings(settings) {
  if (!settings.apiKey) {
    return "API Key を入力してください。";
  }
  if (!settings.guardrailId) {
    return "Guardrail ID を入力してください。";
  }

  return "";
}

function normalizeSettings(raw) {
  return {
    apiKey:
      typeof raw.apiKey === "string" ? raw.apiKey : DEFAULT_SETTINGS.apiKey,
    guardrailId:
      typeof raw.guardrailId === "string"
        ? raw.guardrailId
        : DEFAULT_SETTINGS.guardrailId,
    threshold: clamp(raw.threshold, 0, 1, DEFAULT_SETTINGS.threshold),
    requestTimeoutMs: clamp(
      raw.requestTimeoutMs,
      2000,
      60000,
      DEFAULT_SETTINGS.requestTimeoutMs
    )
  };
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num < min) {
    return min;
  }
  if (num > max) {
    return max;
  }
  return num;
}

function setStatus(message, ok) {
  el.status.textContent = message;
  el.status.classList.remove("ok", "ng");
  el.status.classList.add(ok ? "ok" : "ng");
}

function sendAnalyzeTestMessage(text) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        error:
          "バックグラウンド処理から応答がありません。拡張を再読み込みして再実行してください。"
      });
    }, 15000);

    try {
      chrome.runtime.sendMessage({ type: "ANALYZE_POST", text }, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unknown runtime error"
          });
          return;
        }

        resolve(response || { ok: false, error: "No response from background" });
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });
}

async function ensureSettingsMigrated() {
  const [localRaw, legacyRaw] = await Promise.all([
    SETTINGS_STORAGE.get(SETTINGS_KEYS),
    LEGACY_STORAGE.get(LEGACY_SETTINGS_KEYS)
  ]);

  const merged = normalizeSettings({ ...legacyRaw, ...localRaw });
  const shouldWriteLocal = SETTINGS_KEYS.some((key) => localRaw[key] !== merged[key]);
  if (shouldWriteLocal) {
    await SETTINGS_STORAGE.set(merged);
  }

  const hasLegacyData = LEGACY_SETTINGS_KEYS.some((key) => legacyRaw[key] !== undefined);
  if (hasLegacyData) {
    await LEGACY_STORAGE.remove(LEGACY_SETTINGS_KEYS).catch(() => {});
  }
}
