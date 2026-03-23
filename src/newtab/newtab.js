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
  settings: DEFAULTS,
  quickLaunchItems: []
};

const ui = {
  lastSessionSummary: document.getElementById("last-session-summary"),
  wheel: document.getElementById("duration-wheel"),
  reasonInput: document.getElementById("reason-input"),
  startBtn: document.getElementById("start-btn"),
  statusText: document.getElementById("status-text"),
  quickLaunchList: document.getElementById("quick-launch-list")
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

const QUICK_LAUNCH_FOLDER = "Quick Launch";

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function labelFromUrl(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}

async function getOrCreateQuickLaunchFolder() {
  const results = await self.EXT_API.bookmarks.search({ title: QUICK_LAUNCH_FOLDER });
  const folder = results.find(r => !r.url);
  if (folder) return folder.id;
  const created = await self.EXT_API.bookmarks.create({ title: QUICK_LAUNCH_FOLDER });
  return created.id;
}

function renderQuickLaunch() {
  ui.quickLaunchList.innerHTML = "";

  for (const item of state.quickLaunchItems) {
    const li = document.createElement("li");
    li.className = "quick-launch-item";

    const a = document.createElement("a");
    a.className = "quick-launch-link";
    a.href = item.url;

    const favicon = document.createElement("img");
    favicon.className = "quick-launch-favicon";
    favicon.width = 16;
    favicon.height = 16;
    try {
      const hostname = new URL(item.url).hostname;
      favicon.src = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}/&size=32`;
      favicon.onerror = () => {
        favicon.src = `https://${hostname}/favicon.ico`;
        favicon.onerror = () => { favicon.style.display = "none"; };
      };
    } catch (_) {
      favicon.style.display = "none";
    }
    favicon.onerror = () => { favicon.style.display = "none"; };
    a.appendChild(favicon);
    a.appendChild(document.createTextNode(item.label || labelFromUrl(item.url)));
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await sendMessage("mindfultab/bypass-timer", { reason: `Quick Launch: ${a.textContent}` }); } catch (_) {}
      window.location.href = item.url;
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "quick-launch-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${a.textContent}`);
    removeBtn.addEventListener("click", async () => {
      await self.EXT_API.bookmarks.remove(item.id);
      await loadQuickLaunch();
    });

    li.appendChild(a);
    li.appendChild(removeBtn);
    ui.quickLaunchList.appendChild(li);
  }

  // + button
  const addLi = document.createElement("li");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "quick-launch-add-btn";
  addBtn.textContent = "+";
  addBtn.setAttribute("aria-label", "Add Quick Launch item");
  addBtn.addEventListener("click", () => {
    addLi.removeChild(addBtn);
    const datalist = document.createElement("datalist");
    datalist.id = "ql-history-suggestions";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "quick-launch-inline-input";
    input.placeholder = "e.g. calendar.google.com";
    input.setAttribute("list", "ql-history-suggestions");
    addLi.appendChild(datalist);
    addLi.appendChild(input);
    input.focus();

    input.addEventListener("input", async () => {
      const query = input.value.trim();
      if (!query) { datalist.innerHTML = ""; return; }
      try {
        const results = await self.EXT_API.history.search({ text: query, maxResults: 50, startTime: 0 });
        datalist.innerHTML = "";
        // Show root origins only until the user types a path segment
        const wantsPath = /^https?:\/\/[^/]+\/\S/.test(query) || (!/^https?:\/\//i.test(query) && query.includes("/"));
        if (wantsPath) {
          for (const r of results.slice(0, 8)) {
            const opt = document.createElement("option");
            opt.value = r.url;
            if (r.title) opt.label = r.title;
            datalist.appendChild(opt);
          }
        } else {
          const seen = new Set();
          for (const r of results) {
            try {
              const origin = new URL(r.url).origin;
              if (seen.has(origin)) continue;
              seen.add(origin);
              const opt = document.createElement("option");
              opt.value = origin;
              opt.label = r.title ? `${new URL(r.url).hostname} — ${r.title}` : new URL(r.url).hostname;
              datalist.appendChild(opt);
              if (seen.size >= 8) break;
            } catch (_) {}
          }
        }
      } catch (_) {}
    });

    let committed = false;
    async function commit() {
      if (committed) return;
      committed = true;
      const url = normalizeUrl(input.value);
      if (url && !state.quickLaunchItems.some(i => i.url === url)) {
        const folderId = await getOrCreateQuickLaunchFolder();
        await self.EXT_API.bookmarks.create({ parentId: folderId, title: labelFromUrl(url), url });
      }
      await loadQuickLaunch();
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") loadQuickLaunch();
    });
    input.addEventListener("blur", () => commit());
  });

  addLi.appendChild(addBtn);
  ui.quickLaunchList.appendChild(addLi);
}

async function loadQuickLaunch() {
  try {
    const folderId = await getOrCreateQuickLaunchFolder();
    const children = await self.EXT_API.bookmarks.getChildren(folderId);
    state.quickLaunchItems = children
      .filter(b => b.url)
      .map(b => ({ id: b.id, url: b.url, label: b.title || labelFromUrl(b.url) }));
    renderQuickLaunch();
  } catch (_) {}
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
  await loadQuickLaunch();
  state.activeSession = null;
  ui.reasonInput.value = "";
  renderLastSessionSummary(previousSession);
  startTicking();
}

init().catch(() => {
  ui.statusText.textContent = "MindfulTab could not initialize.";
});
