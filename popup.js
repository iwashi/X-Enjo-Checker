const statusEl = document.getElementById("status");
const openOptionsButton = document.getElementById("openOptions");

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init().catch((error) => {
  statusEl.textContent = `状態取得エラー: ${error.message}`;
  statusEl.className = "status ng";
});

async function init() {
  const settings = await chrome.storage.sync.get([
    "apiEndpoint",
    "apiKey",
    "guardrailId"
  ]);
  const configured =
    typeof settings.apiEndpoint === "string" &&
    settings.apiEndpoint.length > 0 &&
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
