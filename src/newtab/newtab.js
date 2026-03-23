const DEFAULTS = self.DEFAULT_SETTINGS || {
  quickDurationsMinutes: [1, 2, 3],
  nudgeCooldownMinutes: 5,
  historyMode: "both_with_toggle",
  hideThresholds: {
    warning: -5,
    hidden: -15
  }
};

const state = {
  selectedMinutes: 1,
  activeSession: null,
  settings: DEFAULTS
};

const ui = {
  lastSessionSummary: document.getElementById("last-session-summary"),
  wheel: document.getElementById("duration-wheel"),
  reasonInput: document.getElementById("reason-input"),
  startBtn: document.getElementById("start-btn"),
  statusText: document.getElementById("status-text")
};

function buildWheel() {
  ui.wheel.innerHTML = "";
  for (let i = 1; i <= 120; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wheel-option";
    button.dataset.minutes = String(i);
    button.role = "option";
    button.textContent = `${i} min`;
    button.addEventListener("click", () => setSelectedMinutes(i, true));
    ui.wheel.appendChild(button);
  }
}

function formatDuration(msRemaining) {
  const seconds = Math.max(0, Math.floor(msRemaining / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTimeAgo(epochMs) {
  if (!epochMs || Number.isNaN(epochMs)) return "just now";
  const deltaMs = Math.max(0, Date.now() - epochMs);
  const deltaMinutes = Math.floor(deltaMs / (60 * 1000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h ago` : `${days}d ago`;
}

function renderLastSessionSummary(previousSession) {
  if (!ui.lastSessionSummary) return;
  if (!previousSession?.startedAt) {
    ui.lastSessionSummary.textContent = "";
    ui.lastSessionSummary.classList.add("hidden");
    ui.lastSessionSummary.classList.remove("warning");
    return;
  }

  const wasBypassed = (previousSession.reason || "").includes("bypassing timer selection");

  if (wasBypassed) {
    ui.lastSessionSummary.textContent = "You skipped setting a timer last time. Take a moment — what are you actually here to do?";
    ui.lastSessionSummary.classList.remove("hidden");
    ui.lastSessionSummary.classList.add("warning");
    return;
  }

  if (previousSession.ended) {
    const declaredMinutes = Math.max(1, Number(previousSession.durationMinutes || 1));
    const intent = (previousSession.reason || "").trim() || "No intent declared";
    const declaredAgo = formatTimeAgo(Number(previousSession.startedAt));
    ui.lastSessionSummary.textContent = `Your timer ran out. Previous plan: ${declaredMinutes} min — "${intent}", started ${declaredAgo}.`;
    ui.lastSessionSummary.classList.remove("hidden");
    ui.lastSessionSummary.classList.add("warning");
    return;
  }

  const declaredMinutes = Math.max(1, Number(previousSession.durationMinutes || 1));
  const intent = (previousSession.reason || "").trim() || "No intent declared";
  const declaredAgo = formatTimeAgo(Number(previousSession.startedAt));
  ui.lastSessionSummary.textContent = `Previous plan: ${declaredMinutes} min, intent "${intent}", declared ${declaredAgo}.`;
  ui.lastSessionSummary.classList.remove("hidden", "warning");
}

function setSelectedMinutes(minutes, shouldScroll) {
  const next = Math.max(1, Math.min(120, Number(minutes || 1)));
  state.selectedMinutes = next;
  const options = Array.from(ui.wheel.querySelectorAll(".wheel-option"));
  for (const option of options) {
    const selected = Number(option.dataset.minutes) === next;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected && shouldScroll) {
      option.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

function updateSelectedFromWheelScroll() {
  const options = Array.from(ui.wheel.querySelectorAll(".wheel-option"));
  if (!options.length) return;
  const centerY = ui.wheel.getBoundingClientRect().top + ui.wheel.clientHeight / 2;
  let closest = options[0];
  let minDistance = Number.POSITIVE_INFINITY;

  for (const option of options) {
    const rect = option.getBoundingClientRect();
    const optionCenter = rect.top + rect.height / 2;
    const distance = Math.abs(optionCenter - centerY);
    if (distance < minDistance) {
      minDistance = distance;
      closest = option;
    }
  }

  setSelectedMinutes(Number(closest.dataset.minutes), false);
}

function renderStatus() {
  if (!state.activeSession) {
    ui.statusText.textContent = "";
    return;
  }

  const msRemaining = state.activeSession.endsAt - Date.now();
  const isExpired = state.activeSession.ended || msRemaining <= 0;

  if (isExpired) {
    const declaredMinutes = Math.max(1, Number(state.activeSession.durationMinutes || 1));
    const intent = (state.activeSession.reason || "").trim() || "No intent declared";
    if (ui.lastSessionSummary) {
      ui.lastSessionSummary.textContent = `Time's up. Your ${declaredMinutes}-min timer for "${intent}" just ended. What's next?`;
      ui.lastSessionSummary.classList.remove("hidden");
      ui.lastSessionSummary.classList.add("warning");
    }
    ui.statusText.textContent = "Timer ended. Check in before continuing.";
    return;
  }

  ui.statusText.textContent = `${formatDuration(msRemaining)} remaining`;
}

async function sendMessage(type, payload = {}) {
  return self.EXT_API.runtime.sendMessage({ type, payload });
}

async function refreshState() {
  let response;
  try {
    response = await sendMessage("mindfultab/get-state");
  } catch (_) {
    return;
  }
  if (!response?.ok) return;
  state.activeSession = response.session || null;
  state.settings = { ...DEFAULTS, ...(response.settings || {}) };
  renderStatus();
}

async function handleStartClick() {
  const reason = (ui.reasonInput.value || "").trim();

  let response;
  try {
    response = await sendMessage("mindfultab/start-timer", {
      durationMinutes: state.selectedMinutes,
      reason,
      tabUrl: ""
    });
  } catch (err) {
    ui.statusText.textContent = "Service worker not ready. Reload this tab and try again.";
    return;
  }

  if (!response?.ok) {
    ui.statusText.textContent = "Could not start timer. Try again.";
    return;
  }

  state.activeSession = response.session;
  renderStatus();
  document.activeElement?.blur();
}

function bindEvents() {
  ui.wheel.addEventListener("scroll", () => {
    window.requestAnimationFrame(updateSelectedFromWheelScroll);
  });
  ui.startBtn.addEventListener("click", () => {
    handleStartClick().catch(() => {
      ui.statusText.textContent = "Could not start timer. Try again.";
    });
  });
}

function startTicking() {
  window.setInterval(() => {
    renderStatus();
  }, 1000);
}

async function init() {
  buildWheel();
  bindEvents();
  setSelectedMinutes(1, true);
  if (typeof initFidgetCube === "function") initFidgetCube();
  let previousSession = null;
  try {
    const resetResult = await sendMessage("mindfultab/reset-session-newtab");
    previousSession = resetResult?.previousSession || null;
  } catch (_) {
    // If worker is still waking up, continue with local UI.
  }
  await refreshState();
  state.activeSession = null;
  ui.reasonInput.value = "";
  renderLastSessionSummary(previousSession);
  startTicking();
}

init().catch(() => {
  ui.statusText.textContent = "MindfulTab could not initialize.";
});
