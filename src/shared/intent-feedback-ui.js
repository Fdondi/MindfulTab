/**
 * Shared AI intent feedback UI (reject / confirm / notice + reply field).
 * Use the same element ids on newtab and gate HTML.
 */
function createMindfulTabIntentFeedback(config) {
  const hiddenClass = config.hiddenClass || "hidden";
  const getMainReason =
    typeof config.getMainReason === "function"
      ? config.getMainReason
      : () => "";

  const id = (name) => (config.ids && config.ids[name]) || name;
  const $ = (name) => document.getElementById(id(name));

  const panel = $("ai-intent-panel");
  const messageEl = $("ai-intent-message");
  const replyBlock = $("ai-intent-reply-block");
  const replyLabel = $("ai-intent-reply-label");
  const replyInput = $("ai-intent-reply-input");
  const confirmActions = $("ai-intent-confirm-actions");
  const noticeActions = $("ai-intent-notice-actions");

  let mode = null;

  function hide() {
    mode = null;
    panel?.classList.add(hiddenClass);
    confirmActions?.classList.add(hiddenClass);
    noticeActions?.classList.add(hiddenClass);
    if (replyInput) replyInput.value = "";
  }

  function scrollPanelIntoView() {
    requestAnimationFrame(() => {
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function getEffectiveReason() {
    const main = String(getMainReason() || "").trim();
    const reply = String(replyInput?.value || "").trim();
    if (mode === "confirm") {
      if (!reply) return main;
      return main ? `${main} (${reply})` : reply;
    }
    if (reply) return reply;
    return main;
  }

  function showReject(message) {
    mode = "reject";
    if (messageEl) messageEl.textContent = message || "";
    if (replyInput) {
      replyInput.value = "";
      replyInput.placeholder = "Revise or explain your intent…";
    }
    if (replyLabel) replyLabel.textContent = "Your reply";
    replyBlock?.classList.remove(hiddenClass);
    confirmActions?.classList.add(hiddenClass);
    noticeActions?.classList.add(hiddenClass);
    panel?.classList.remove(hiddenClass);
    scrollPanelIntoView();
    replyInput?.focus();
  }

  function showConfirm(message) {
    mode = "confirm";
    if (messageEl) messageEl.textContent = message || "";
    if (replyInput) {
      replyInput.value = "";
      replyInput.placeholder = "Add context (optional)…";
    }
    if (replyLabel) replyLabel.textContent = "Optional detail";
    replyBlock?.classList.remove(hiddenClass);
    confirmActions?.classList.remove(hiddenClass);
    noticeActions?.classList.add(hiddenClass);
    panel?.classList.remove(hiddenClass);
    scrollPanelIntoView();
  }

  function showNotice(message) {
    mode = "notice";
    if (messageEl) messageEl.textContent = message || "";
    if (replyInput) replyInput.value = "";
    replyBlock?.classList.add(hiddenClass);
    confirmActions?.classList.add(hiddenClass);
    noticeActions?.classList.remove(hiddenClass);
    panel?.classList.remove(hiddenClass);
    scrollPanelIntoView();
  }

  /**
   * @param {object} response - mindfultab/start-timer response
   * @param {{ traceDecision?: (name: string, details?: object) => Promise<void> }} [trace]
   * @returns {Promise<{ ok: true, session: object } | { ok: false }>}
   */
  async function handleStartTimerResponse(response, trace) {
    const traceDecision = trace?.traceDecision || (async () => {});
    if (response?.ok) {
      hide();
      return { ok: true, session: response.session };
    }
    if (response?.needsConfirmation && response?.message) {
      await traceDecision("intent_confirmation_shown", { message: response.message });
      showConfirm(response.message);
      return { ok: false };
    }
    if (response?.aiRejected && response?.message) {
      await traceDecision("intent_rejected_ui", { message: response.message });
      showReject(response.message);
      return { ok: false };
    }
    if (response?.code === "need_google_sign_in" || response?.code === "missing_ai_token") {
      await traceDecision("start_timer_need_google_sign_in", { code: response.code });
      showNotice(
        response.error || "Open MindfulTab settings → AI and sign in with Google."
      );
      return { ok: false };
    }
    await traceDecision("start_timer_response_not_ok", { responseError: String(response?.error || "") });
    showNotice(response?.error || "Could not start timer. Try again.");
    return { ok: false };
  }

  return {
    hide,
    getEffectiveReason,
    showReject,
    showConfirm,
    showNotice,
    handleStartTimerResponse,
    getMode: () => mode
  };
}

self.MINDFULTAB_INTENT_FEEDBACK = { createMindfulTabIntentFeedback };
