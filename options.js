const DEFAULT_SETTINGS = {
  apiEndpoint: "https://api.beta.chakoshi.ntt.com",
  apiKey: "",
  guardrailId: "",
  threshold: 0.7,
  requestTimeoutMs: 10000
};

const el = {
  apiEndpoint: document.getElementById("apiEndpoint"),
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
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const settings = normalizeSettings(raw);
  renderSettings(settings);
  bindEvents();
}

function bindEvents() {
  el.save.addEventListener("click", handleSave);
  el.test.addEventListener("click", handleTest);
}

function renderSettings(settings) {
  el.apiEndpoint.value = settings.apiEndpoint;
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

  await chrome.storage.sync.set(settings);
  setStatus("保存しました。", true);
}

async function handleTest() {
  const settings = collectSettings();
  const validationError = validateSettings(settings);
  if (validationError) {
    setStatus(validationError, false);
    return;
  }

  await chrome.storage.sync.set(settings);
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
    apiEndpoint: el.apiEndpoint.value.trim(),
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
  if (!settings.apiEndpoint) {
    return "Chakoshi API Endpoint を入力してください。";
  }

  try {
    const url = new URL(settings.apiEndpoint);
    if (!url.protocol.startsWith("http")) {
      return "Chakoshi API Endpoint は http/https を指定してください。";
    }
  } catch (_error) {
    return "Chakoshi API Endpoint の形式が不正です。";
  }

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
    apiEndpoint:
      typeof raw.apiEndpoint === "string"
        ? raw.apiEndpoint
        : DEFAULT_SETTINGS.apiEndpoint,
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
