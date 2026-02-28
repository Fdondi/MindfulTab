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
  view: "timer",
  activeSession: null,
  intentSeed: "",
  karmaByDomain: {},
  domainVisits: {},
  settings: DEFAULTS,
  visitedLinks: [],
  searchIndex: null
};

const ui = {
  timerView: document.getElementById("timer-view"),
  homeView: document.getElementById("home-view"),
  wheel: document.getElementById("duration-wheel"),
  reasonInput: document.getElementById("reason-input"),
  startBtn: document.getElementById("start-btn"),
  statusText: document.getElementById("status-text"),
  homeTimerStatus: document.getElementById("home-timer-status"),
  urlInput: document.getElementById("url-input"),
  goBtn: document.getElementById("go-btn"),
  historyModeSelect: document.getElementById("history-mode-select"),
  settingsBtn: document.getElementById("settings-btn"),
  shortcutsSection: document.getElementById("shortcuts-section"),
  shortcutsList: document.getElementById("shortcuts-list"),
  suggestionsSection: document.getElementById("suggestions-section"),
  suggestionsList: document.getElementById("suggestions-list")
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
    ui.homeTimerStatus.textContent = "No active timer";
    return;
  }

  if (state.activeSession.ended) {
    ui.statusText.textContent = "Timer ended. Check in before continuing.";
    ui.homeTimerStatus.textContent = "Timer ended";
    return;
  }

  const msRemaining = state.activeSession.endsAt - Date.now();
  if (msRemaining <= 0) {
    ui.statusText.textContent = "Timer ended. Check in before continuing.";
    ui.homeTimerStatus.textContent = "Timer ended";
    return;
  }

  ui.statusText.textContent = `Session running: ${formatDuration(msRemaining)} remaining`;
  ui.homeTimerStatus.textContent = `${formatDuration(msRemaining)} remaining`;
}

function getTopDomains() {
  return Object.entries(state.domainVisits || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain]) => domain);
}

function renderShortcuts() {
  const topDomains = getTopDomains();
  if (!topDomains.length) {
    ui.shortcutsSection.classList.add("hidden");
    ui.shortcutsList.innerHTML = "";
    return;
  }

  const thresholds = state.settings.hideThresholds || DEFAULTS.hideThresholds;
  ui.shortcutsList.innerHTML = "";
  let shownCount = 0;

  for (const domain of topDomains) {
    const score = state.karmaByDomain[domain] || 0;
    const karmaState = self.karmaStateForScore(score, thresholds);
    if (karmaState === "hidden") {
      continue;
    }

    shownCount += 1;
    const row = document.createElement("li");
    row.className = "shortcut-row";

    const link = document.createElement("a");
    link.className = `shortcut-link${karmaState === "warning" ? " warning" : ""}`;
    link.href = `https://${domain}`;
    link.textContent = karmaState === "warning" ? `${domain} (reflect first)` : domain;
    row.appendChild(link);
    ui.shortcutsList.appendChild(row);
  }

  if (!shownCount) {
    ui.shortcutsSection.classList.add("hidden");
    return;
  }
  ui.shortcutsSection.classList.remove("hidden");
}

async function sendMessage(type, payload = {}) {
  return self.EXT_API.runtime.sendMessage({ type, payload });
}

function setView(view) {
  state.view = view;
  const showTimer = view === "timer";
  ui.timerView.classList.toggle("hidden", !showTimer);
  ui.homeView.classList.toggle("hidden", showTimer);
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
  state.intentSeed = response.session?.reason || "";
  state.karmaByDomain = response.karmaByDomain || {};
  state.domainVisits = response.domainVisits || {};
  state.settings = { ...DEFAULTS, ...(response.settings || {}) };
  ui.historyModeSelect.value = state.settings.historyMode || "both_with_toggle";
  renderStatus();
  renderShortcuts();
}

async function refreshVisitedLinks() {
  const mode = ui.historyModeSelect.value || state.settings.historyMode || "both_with_toggle";
  const response = await sendMessage("mindfultab/get-visited-links", { mode });
  if (!response?.ok) return;
  state.visitedLinks = response.links || [];
}

async function rebuildSearchIndex() {
  const cache = await self.getSearchIndex();
  const fingerprint = `${state.visitedLinks.length}:${state.visitedLinks.map((l) => l.url).join("|").length}`;
  if (cache?.version === self.SearchIndex.SEARCH_INDEX_VERSION && cache.fingerprint === fingerprint) {
    state.searchIndex = cache;
    return;
  }

  const built = self.SearchIndex.createEmbeddingIndex(state.visitedLinks);
  built.fingerprint = fingerprint;
  state.searchIndex = built;
  await self.setSearchIndex(built);
}

function isUrlLike(value) {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value);
}

function ensureUrl(value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function renderSuggestions(items) {
  const list = items || [];
  if (!list.length) {
    ui.suggestionsSection.classList.add("hidden");
    ui.suggestionsList.innerHTML = "";
    return;
  }

  ui.suggestionsSection.classList.remove("hidden");
  ui.suggestionsList.innerHTML = "";
  for (const item of list.slice(0, 10)) {
    const li = document.createElement("li");
    li.className = "suggestion-row";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `${item.title || item.url}<span class="suggestion-url">${item.url}</span>`;
    button.addEventListener("click", () => {
      window.location.href = item.url;
    });
    li.appendChild(button);
    ui.suggestionsList.appendChild(li);
  }
}

async function searchByIntent(query) {
  if (!query.trim()) {
    renderSuggestions([]);
    return;
  }
  if (!state.searchIndex) {
    await rebuildSearchIndex();
  }
  let results = [];
  try {
    results = self.SearchIndex.searchEmbeddingIndex(query, state.searchIndex, 10);
  } catch (_) {
    results = self.SearchIndex.keywordFallbackSearch(query, state.visitedLinks, 10);
  }
  if (!results.length) {
    results = self.SearchIndex.keywordFallbackSearch(query, state.visitedLinks, 10);
  }
  renderSuggestions(results);
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
  state.intentSeed = reason;
  setView("home");
  await refreshVisitedLinks();
  await rebuildSearchIndex();
  ui.urlInput.value = reason;
  if (reason) {
    await searchByIntent(reason);
  } else {
    renderSuggestions([]);
  }
  ui.urlInput.focus();
  if (reason) {
    ui.urlInput.setSelectionRange(reason.length, reason.length);
  }
  renderStatus();
}

async function handleGoAction() {
  const value = (ui.urlInput.value || "").trim();
  const query = value || state.intentSeed;
  if (!query) return;
  if (isUrlLike(value)) {
    window.location.href = ensureUrl(value);
    return;
  }
  await searchByIntent(query);
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
  ui.goBtn.addEventListener("click", () => {
    handleGoAction().catch(() => {});
  });
  ui.urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleGoAction().catch(() => {});
    }
  });
  ui.urlInput.addEventListener("input", () => {
    const q = (ui.urlInput.value || "").trim();
    if (!q) {
      renderSuggestions([]);
      return;
    }
    searchByIntent(q).catch(() => {});
  });
  ui.historyModeSelect.addEventListener("change", () => {
    const mode = ui.historyModeSelect.value;
    sendMessage("mindfultab/set-history-mode", { mode })
      .then(() => refreshVisitedLinks())
      .then(() => rebuildSearchIndex())
      .then(() => searchByIntent(ui.urlInput.value || ""))
      .catch(() => {});
  });
  ui.settingsBtn.addEventListener("click", () => {
    self.EXT_API.runtime.openOptionsPage().catch(() => {});
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
  try {
    await sendMessage("mindfultab/reset-session-newtab");
  } catch (_) {
    // If worker is still waking up, continue with local UI.
  }
  await refreshState();
  state.activeSession = null;
  state.intentSeed = "";
  ui.reasonInput.value = "";
  ui.urlInput.value = "";
  renderSuggestions([]);
  setView("timer");
  startTicking();
}

init().catch(() => {
  ui.statusText.textContent = "MindfulTab could not initialize.";
});
