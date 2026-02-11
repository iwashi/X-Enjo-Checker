const POST_BUTTON_SELECTORS = [
  'button[data-testid="tweetButton"]',
  'button[data-testid="tweetButtonInline"]'
];

const TEXTBOX_SELECTORS = [
  'div[data-testid^="tweetTextarea_"][role="textbox"]',
  'div[data-testid^="tweetTextarea_"]',
  'div[role="textbox"][contenteditable="true"]'
];

const INLINE_CHECK_BUTTON_CLASS = "enjo-guardrails-inline-check";
const INLINE_CHECK_LABEL = "🍵";
const INLINE_CHECK_BUSY_LABEL = "…";
const INLINE_CHECK_TOOLTIP = "chakoshi 炎上チェック";
const INLINE_CHECK_BUSY_TOOLTIP = "チェック中...";
const VIOLATION_LABELS = {
  moderation: "モデレーションリスクスコア",
  prompt_guard: "プロンプトガード危険度",
  pii_filter: "個人情報検知",
  keyword_filter: "キーワード検知",
  topic_control: "トピック判定"
};

let bypassNextClick = false;
let modalRoot = null;
let toastRoot = null;
let toastTimerId = null;
let observer = null;
let injectScheduled = false;

setupInlineCheckButtons();

document.addEventListener(
  "click",
  async (event) => {
    if (bypassNextClick) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const postButton = findPostButton(target);
    if (!postButton) {
      return;
    }

    if (postButton.dataset.enjoChecking === "1") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const text = readComposerText(postButton);
    if (!text) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    postButton.dataset.enjoChecking = "1";
    const previousOpacity = postButton.style.opacity;
    postButton.style.opacity = "0.7";

    try {
      const result = await sendAnalyzeRequest(text);
      if (!result.ok) {
        const shouldProceed = window.confirm(
          `炎上チェックに失敗しました。\n${result.error}\n\nこのまま投稿しますか？`
        );
        if (shouldProceed) {
          triggerPost(postButton);
        }
        return;
      }

      if (result.shouldBlock) {
        showRiskModal(result, () => triggerPost(postButton));
      } else {
        triggerPost(postButton);
      }
    } finally {
      postButton.dataset.enjoChecking = "0";
      postButton.style.opacity = previousOpacity;
    }
  },
  true
);

function setupInlineCheckButtons() {
  injectInlineCheckButtons();

  observer = new MutationObserver(() => {
    scheduleInlineButtonInjection();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function scheduleInlineButtonInjection() {
  if (injectScheduled) {
    return;
  }
  injectScheduled = true;
  requestAnimationFrame(() => {
    injectScheduled = false;
    injectInlineCheckButtons();
  });
}

function injectInlineCheckButtons() {
  const selector = POST_BUTTON_SELECTORS.join(",");
  const postButtons = document.querySelectorAll(selector);
  for (const postButton of postButtons) {
    if (!(postButton instanceof HTMLButtonElement)) {
      continue;
    }
    if (postButton.dataset.enjoInlineCheckAttached === "1") {
      continue;
    }

    const container = postButton.parentElement;
    if (!container) {
      continue;
    }

    const checkButton = document.createElement("button");
    checkButton.type = "button";
    checkButton.className = INLINE_CHECK_BUTTON_CLASS;
    checkButton.textContent = INLINE_CHECK_LABEL;
    checkButton.dataset.tip = INLINE_CHECK_TOOLTIP;
    checkButton.setAttribute("aria-label", "chakoshi 炎上チェック");
    checkButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleInlineCheck(postButton, checkButton);
    });

    container.insertBefore(checkButton, postButton);
    postButton.dataset.enjoInlineCheckAttached = "1";
  }
}

async function handleInlineCheck(postButton, checkButton) {
  if (checkButton.dataset.enjoBusy === "1") {
    return;
  }

  const text = readComposerText(postButton);
  if (!text) {
    showToast("投稿文を入力してからチェックしてください。", false);
    return;
  }

  checkButton.dataset.enjoBusy = "1";
  checkButton.disabled = true;
  checkButton.textContent = INLINE_CHECK_BUSY_LABEL;
  checkButton.dataset.tip = INLINE_CHECK_BUSY_TOOLTIP;
  checkButton.setAttribute("aria-label", "チェック中...");

  try {
    const result = await sendAnalyzeRequest(text);
    if (!result.ok) {
      showToast(`チェック失敗: ${result.error}`, false);
      return;
    }

    if (result.shouldBlock) {
      showRiskModal(result, () => triggerPost(postButton));
      showToast(
        `要確認: 炎上リスクスコア ${formatScore(result.maxScore)}`,
        false
      );
      return;
    }

    showToast(
      `チェックOK: 炎上リスクスコア ${formatScore(result.maxScore)}`,
      true
    );
  } finally {
    checkButton.dataset.enjoBusy = "0";
    checkButton.disabled = false;
    checkButton.textContent = INLINE_CHECK_LABEL;
    checkButton.dataset.tip = INLINE_CHECK_TOOLTIP;
    checkButton.setAttribute("aria-label", "chakoshi 炎上チェック");
  }
}

function findPostButton(element) {
  return element.closest(POST_BUTTON_SELECTORS.join(","));
}

function readComposerText(referenceButton) {
  const scopedCandidates = collectScopedComposerTextCandidates(referenceButton);
  const scopedText = pickBestVisibleText(scopedCandidates);
  if (scopedText) {
    return scopedText;
  }

  const globalCandidates = queryComposerTextCandidates(document);
  return pickBestVisibleText(globalCandidates);
}

function collectScopedComposerTextCandidates(referenceButton) {
  if (!(referenceButton instanceof Element)) {
    return [];
  }

  const roots = [];
  const form = referenceButton.closest("form");
  if (form) {
    roots.push(form);
  }

  const dialog = referenceButton.closest('[role="dialog"]');
  if (dialog && !roots.includes(dialog)) {
    roots.push(dialog);
  }

  const article = referenceButton.closest("article");
  if (article && !roots.includes(article)) {
    roots.push(article);
  }

  const candidates = [];
  for (const root of roots) {
    candidates.push(...queryComposerTextCandidates(root));
  }
  return candidates;
}

function queryComposerTextCandidates(root) {
  return Array.from(root.querySelectorAll(TEXTBOX_SELECTORS.join(",")));
}

function pickBestVisibleText(candidates) {
  const visibleCandidates = candidates.filter(isVisible);
  let bestText = "";
  for (const candidate of visibleCandidates) {
    const text = extractText(candidate);
    if (text.length > bestText.length) {
      bestText = text;
    }
  }
  return bestText;
}

function extractText(element) {
  return String(element.innerText || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function sendAnalyzeRequest(text) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "ANALYZE_POST", text }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Unknown runtime error"
        });
        return;
      }
      resolve(response || { ok: false, error: "No response from background" });
    });
  });
}

function triggerPost(button) {
  bypassNextClick = true;
  const dataTestId = button.getAttribute("data-testid");
  const latestButton =
    (dataTestId &&
      document.querySelector(`button[data-testid="${CSS.escape(dataTestId)}"]`)) ||
    button;
  latestButton.click();
  setTimeout(() => {
    bypassNextClick = false;
  }, 0);
}

function showRiskModal(result, onProceed) {
  destroyRiskModal();

  modalRoot = document.createElement("div");
  modalRoot.className = "enjo-guardrails-overlay";

  const panel = document.createElement("div");
  panel.className = "enjo-guardrails-panel";

  const title = document.createElement("h2");
  title.textContent = "炎上リスクが高い可能性があります";

  const metrics = document.createElement("div");
  metrics.className = "enjo-guardrails-metrics";
  metrics.appendChild(
    createMetricLine(`炎上リスクスコア: ${formatScore(result.maxScore)}`)
  );

  const violations = Array.isArray(result.violations) ? result.violations : [];
  const visibleViolations = violations.filter(
    (violation) => violation?.category !== "topic_control"
  );
  const topicControlViolation = violations.find(
    (violation) => violation?.category === "topic_control"
  );

  if (visibleViolations.length > 0) {
    for (const violation of visibleViolations.slice(0, 5)) {
      metrics.appendChild(createMetricLine(formatViolationText(violation)));
    }
  } else if (topicControlViolation) {
    metrics.appendChild(createMetricLine("トピック判定: 拒否に該当しました。"));
  } else {
    metrics.appendChild(createMetricLine("詳細カテゴリ情報は返されませんでした。"));
  }

  const buttons = document.createElement("div");
  buttons.className = "enjo-guardrails-buttons";

  const cancelButton = document.createElement("button");
  cancelButton.className = "enjo-guardrails-btn secondary";
  cancelButton.textContent = "編集に戻る";
  cancelButton.addEventListener("click", destroyRiskModal);

  const proceedButton = document.createElement("button");
  proceedButton.className = "enjo-guardrails-btn primary";
  proceedButton.textContent = "このまま投稿";
  proceedButton.addEventListener("click", () => {
    destroyRiskModal();
    onProceed();
  });

  buttons.append(cancelButton, proceedButton);
  panel.append(title, metrics, buttons);
  modalRoot.appendChild(panel);
  document.body.appendChild(modalRoot);
}

function destroyRiskModal() {
  if (modalRoot && modalRoot.isConnected) {
    modalRoot.remove();
  }
  modalRoot = null;
}

function showToast(message, ok) {
  if (!toastRoot || !toastRoot.isConnected) {
    toastRoot = document.createElement("div");
    toastRoot.className = "enjo-guardrails-toast";
    document.body.appendChild(toastRoot);
  }

  toastRoot.textContent = message;
  toastRoot.classList.remove("ok", "ng", "show");
  toastRoot.classList.add(ok ? "ok" : "ng");

  requestAnimationFrame(() => {
    if (toastRoot) {
      toastRoot.classList.add("show");
    }
  });

  if (toastTimerId !== null) {
    clearTimeout(toastTimerId);
  }
  toastTimerId = setTimeout(() => {
    if (toastRoot) {
      toastRoot.classList.remove("show");
    }
  }, 3500);
}

function formatScore(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) {
    return "0.00";
  }
  return num.toFixed(2);
}

function formatViolationText(violation) {
  const key = String(violation?.category || "");
  const label = VIOLATION_LABELS[key] || key || "判定";
  const reason = formatViolationReason(violation);
  const reasonSuffix = reason ? ` (${reason})` : "";
  return `${label}: ${formatScore(violation?.score)}${reasonSuffix}`;
}

function formatViolationReason(violation) {
  const raw = String(violation?.reason || "").trim();
  if (!raw) {
    return "";
  }
  if (raw === "unsafe_flag=true") {
    return "危険判定";
  }
  if (raw.startsWith("detected:")) {
    return `検知: ${raw.slice("detected:".length).trim()}`;
  }
  if (raw.startsWith("keywords:")) {
    return `キーワード: ${raw.slice("keywords:".length).trim()}`;
  }
  if (raw.startsWith("types:")) {
    return `種別: ${raw.slice("types:".length).trim()}`;
  }
  if (raw.startsWith("classification=")) {
    const value = raw.slice("classification=".length).toLowerCase();
    if (value === "deny") {
      return "拒否トピック";
    }
    if (value === "allow") {
      return "許可トピック";
    }
    if (value === "compliant") {
      return "トピック準拠";
    }
  }
  return raw;
}

function createMetricLine(text) {
  const line = document.createElement("p");
  line.className = "enjo-guardrails-metric";
  line.textContent = text;
  return line;
}
