const EXT_API = typeof browser !== "undefined" ? browser : chrome;
const AUTO_BYPASS_TIMER_REASON = "Auto-started after bypassing timer selection";
let timerWheel = null;

function getReflectionEl() {
  return document.getElementById("reflection-input");
}

function clearGateAuthHint() {
  const el = document.getElementById("gate-auth-hint");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function showGateAuthHint(message) {
  const el = document.getElementById("gate-auth-hint");
  if (!el) return;
  el.textContent = message || "";
  if (message) el.classList.remove("hidden");
  else el.classList.add("hidden");
}

function gateAuthHintForStartTimer(detail) {
  const err = String(detail?.error || "");
  if (/expired/i.test(err)) {
    showGateAuthHint("AI session expired — sign in again from the MindfulTab new tab page or Settings → AI.");
    return;
  }
  showGateAuthHint("AI sign-in required — use Sign in with Google on the MindfulTab new tab page, or Settings → AI.");
}

const intentFeedback = self.MINDFULTAB_INTENT_FEEDBACK.createMindfulTabIntentFeedback({
  getMainReason: () => String(getReflectionEl()?.value || "").trim(),
  onAuthSessionRequired: gateAuthHintForStartTimer
});

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    targetUrl: params.get("target") || "",
    domain: params.get("domain") || "",
    score: Number(params.get("score") || 0),
    requireTimer: params.get("requireTimer") === "1"
  };
}

async function logInteraction(eventType, details = {}) {
  try {
    await EXT_API.runtime.sendMessage({
      type: "mindfultab/log-interaction",
      payload: { eventType, details }
    });
  } catch (_) {
    // Best-effort logging only.
  }
}

async function continueAnyway() {
  const { targetUrl, domain } = getParams();
  const reflection = String(getReflectionEl()?.value || "").trim();
  const current = await EXT_API.tabs.getCurrent();
  const tab = current || (await EXT_API.tabs.query({ active: true, currentWindow: true }))[0];

  await EXT_API.runtime.sendMessage({
    type: "mindfultab/continue-anyway",
    payload: {
      targetUrl,
      domain,
      reflection,
      tabId: tab?.id
    }
  });
}

function getTimerMinutes() {
  if (!timerWheel) return 5;
  return timerWheel.getMinutes();
}

/**
 * @returns {Promise<boolean>} true if OK to continue navigation
 */
async function startTimerIfNeeded(confirmedLongSession = false) {
  clearGateAuthHint();
  const { targetUrl, requireTimer } = getParams();
  if (!requireTimer) return true;

  const stateResp = await EXT_API.runtime.sendMessage({ type: "mindfultab/get-state" }).catch(() => null);
  const session = stateResp?.session;
  const hasActiveTimer = Boolean(session && !session.ended);
  const sessionReason = String(session?.reason || "").trim();
  const hasUserManagedTimer =
    hasActiveTimer && Boolean(sessionReason) && sessionReason !== AUTO_BYPASS_TIMER_REASON;
  if (hasUserManagedTimer) return true;

  const reason = intentFeedback.getEffectiveReason();
  const resp = await EXT_API.runtime.sendMessage({
    type: "mindfultab/start-timer",
    payload: {
      durationMinutes: getTimerMinutes(),
      reason,
      tabUrl: targetUrl,
      confirmedLongSession: Boolean(confirmedLongSession)
    }
  });

  const result = await intentFeedback.handleStartTimerResponse(resp);
  return result.ok;
}

function bindIntentButtons(continueBtn) {
  document.getElementById("ai-intent-proceed")?.addEventListener("click", () => {
    (async () => {
      const ok = await startTimerIfNeeded(true);
      if (!ok) return;
      await continueAnyway();
    })().catch(() => {
      intentFeedback.showNotice("Could not continue. Try again.");
      continueBtn.textContent = "Try again";
    });
  });
  document.getElementById("ai-intent-dismiss")?.addEventListener("click", () => {
    intentFeedback.hide();
  });
  document.getElementById("ai-intent-notice-dismiss")?.addEventListener("click", () => {
    intentFeedback.hide();
  });
}

function init() {
  const { domain, score, requireTimer } = getParams();
  const pill = document.getElementById("domain-pill");
  pill.textContent = `${domain} (karma ${score})`;

  const timerRequiredPanel = document.getElementById("timer-required");
  if (requireTimer) {
    timerRequiredPanel?.classList.remove("hidden");
    timerWheel = self.createTimerWheel({
      wheelElement: document.getElementById("timer-minutes-wheel"),
      minMinutes: 1,
      maxMinutes: 120,
      initialMinutes: 5
    });
  }

  const continueBtn = document.getElementById("continue-btn");
  if (requireTimer) {
    continueBtn.textContent = "Start timer and continue";
  }

  bindIntentButtons(continueBtn);

  continueBtn.addEventListener("click", () => {
    (async () => {
      const ok = await startTimerIfNeeded(false);
      if (!ok) return;
      await continueAnyway();
    })().catch(() => {
      continueBtn.textContent = "Try again";
    });
  });
}

init();
