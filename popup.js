const statusEl = document.getElementById("status");
const openOptionsButton = document.getElementById("openOptions");
const SETTINGS_KEYS = ["apiKey", "guardrailId"];
const LEGACY_SETTINGS_KEYS = ["apiEndpoint", ...SETTINGS_KEYS];

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init().catch((error) => {
  statusEl.textContent = `状態取得エラー: ${error.message}`;
  statusEl.className = "status ng";
});

async function init() {
  const [localSettings, legacySettings] = await Promise.all([
    chrome.storage.local.get(SETTINGS_KEYS),
    chrome.storage.sync.get(LEGACY_SETTINGS_KEYS)
  ]);
  const settings = { ...legacySettings, ...localSettings };

  const shouldWriteLocal = SETTINGS_KEYS.some(
    (key) => localSettings[key] === undefined && typeof settings[key] === "string"
  );
  if (shouldWriteLocal) {
    await chrome.storage.local.set({
      apiKey: settings.apiKey || "",
      guardrailId: settings.guardrailId || ""
    });
  }

  const hasLegacyData = LEGACY_SETTINGS_KEYS.some((key) => legacySettings[key] !== undefined);
  if (hasLegacyData) {
    await chrome.storage.sync.remove(LEGACY_SETTINGS_KEYS).catch(() => {});
  }

  const configured =
    typeof settings.apiKey === "string" &&
    settings.apiKey.length > 0 &&
    typeof settings.guardrailId === "string" &&
    settings.guardrailId.length > 0;

  if (configured) {
    statusEl.textContent = "設定済みです。X で投稿時に自動チェックされます。";
    statusEl.className = "status ok";
    return;
  }

  statusEl.textContent = "初期設定が未完了です。設定画面で API 情報を入力してください。";
  statusEl.className = "status ng";
}
