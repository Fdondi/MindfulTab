const EXT_API = typeof browser !== "undefined" ? browser : chrome;
const AUTO_BYPASS_TIMER_REASON = "Auto-started after bypassing timer selection";
let timerWheel = null;

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
  const reflection = document.getElementById("reflection-input").value.trim();
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

async function startTimerIfNeeded() {
  const { targetUrl, requireTimer } = getParams();
  if (!requireTimer) return false;

  // Only skip timer start when there is already a user-managed active timer.
  const stateResp = await EXT_API.runtime.sendMessage({ type: "mindfultab/get-state" }).catch(() => null);
  const session = stateResp?.session;
  const hasActiveTimer = Boolean(session && !session.ended);
  const sessionReason = String(session?.reason || "").trim();
  const hasUserManagedTimer =
    hasActiveTimer && Boolean(sessionReason) && sessionReason !== AUTO_BYPASS_TIMER_REASON;
  if (hasUserManagedTimer) return false;

  const reflection = document.getElementById("reflection-input").value.trim();
  await EXT_API.runtime.sendMessage({
    type: "mindfultab/start-timer",
    payload: {
      durationMinutes: getTimerMinutes(),
      reason: reflection,
      tabUrl: targetUrl
    }
  });
  return true;
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
  continueBtn.addEventListener("click", () => {
    (async () => {
      await startTimerIfNeeded();
      await continueAnyway();
    })().catch(() => {
      continueBtn.textContent = "Try again";
    });
  });
}

init();
