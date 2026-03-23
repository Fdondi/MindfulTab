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
  quickLaunchItems: [],
  pendingTargetUrl: "",
  prefillReason: "",
  resumeContinueAnyway: false,
  continueDomain: "",
  timerWheel: null,
  isGateMode: false,
  gateDomain: "",
  gateScore: 0
};
const QUICK_LAUNCH_SURFACE_REASON = "Explicit selection required to avoid accidental auto-navigation while typing.";

const ui = {
  titleText: document.getElementById("title-text"),
  lastSessionSummary: document.getElementById("last-session-summary"),
  wheel: document.getElementById("duration-wheel"),
  reasonLabel: document.getElementById("reason-label"),
  reasonInput: document.getElementById("reason-input"),
  startBtn: document.getElementById("start-btn"),
  statusText: document.getElementById("status-text"),
  quickLaunchList: document.getElementById("quick-launch-list"),
  openSettingsBtn: document.getElementById("open-settings-btn"),
  openLogsBtn: document.getElementById("open-logs-btn")
};

function getNewtabParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    gate: params.get("gate") === "1",
    targetUrl: params.get("target") || "",
    domain: params.get("domain") || "",
    score: Number(params.get("score") || 0),
    prefillReason: params.get("reason") || "",
    resumeContinueAnyway: params.get("resumeContinueAnyway") === "1",
    continueDomain: params.get("continueDomain") || ""
  };
}

async function getCurrentTabId() {
  try {
    const current = await self.EXT_API.tabs.getCurrent();
    if (current?.id != null) return current.id;
  } catch (_) {}
  try {
    const tabs = await self.EXT_API.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.id ?? null;
  } catch (_) {}
  return null;
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

async function logInteraction(eventType, details = {}) {
  try {
    await sendMessage("mindfultab/log-interaction", { eventType, details });
  } catch (_) {
    // Best-effort logging only.
  }
}

async function traceBoundary(name, details = {}) {
  await logInteraction(`trace_boundary_${name}`, details);
}

async function traceDecision(name, details = {}) {
  await logInteraction(`trace_decision_${name}`, details);
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
  await traceBoundary("start_click", {
    isGateMode: state.isGateMode,
    selectedMinutes: state.selectedMinutes,
    hasReason: Boolean(reason),
    target: state.pendingTargetUrl || ""
  });
  if (state.isGateMode && !reason) {
    await traceDecision("reject_start_reason_required", { isGateMode: true });
    ui.statusText.textContent = "Please add a reason before continuing.";
    return;
  }

  let response;
  try {
    response = await sendMessage("mindfultab/start-timer", {
      durationMinutes: state.selectedMinutes,
      reason,
      tabUrl: state.pendingTargetUrl || ""
    });
  } catch (err) {
    await traceDecision("start_timer_message_error", { error: String(err) });
    ui.statusText.textContent = "Service worker not ready. Reload this tab and try again.";
    return;
  }

  if (!response?.ok) {
    await traceDecision("start_timer_response_not_ok", { responseError: String(response?.error || "") });
    ui.statusText.textContent = "Could not start timer. Try again.";
    return;
  }
  await traceDecision("start_timer_success", {
    selectedMinutes: state.selectedMinutes,
    hasReason: Boolean(reason),
    target: state.pendingTargetUrl || ""
  });

  state.activeSession = response.session;
  renderStatus();
  document.activeElement?.blur();

  if (state.resumeContinueAnyway) {
    try {
      const tabId = await getCurrentTabId();
      const continueResp = await sendMessage("mindfultab/continue-anyway", {
        targetUrl: state.pendingTargetUrl || "",
        domain: state.continueDomain || "",
        reflection: reason,
        tabId
      });
      if (!continueResp?.ok) throw new Error(continueResp?.error || "Continue failed");
    } catch (_) {
      await traceDecision("continue_anyway_resume_failed", {});
      ui.statusText.textContent = "Could not continue after timer. Try again.";
      return;
    }
    await traceDecision("continue_anyway_resume_success", {
      target: state.pendingTargetUrl || "",
      domain: state.continueDomain || ""
    });
    return;
  }

  if (state.pendingTargetUrl) {
    window.location.href = state.pendingTargetUrl;
  }
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
      await logInteraction("newtab_quick_launch_click", {
        url: item.url,
        label: item.label || labelFromUrl(item.url)
      });
      try { await sendMessage("mindfultab/bypass-timer", { reason: `Quick Launch: ${a.textContent}` }); } catch (_) {}
      window.location.href = item.url;
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "quick-launch-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${a.textContent}`);
    removeBtn.addEventListener("click", async () => {
      await logInteraction("newtab_quick_launch_remove", { url: item.url });
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
    logInteraction("newtab_quick_launch_add_open", {}).catch(() => {});
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
      if (!query) {
        datalist.innerHTML = "";
        if (!state.activeSession) ui.statusText.textContent = "";
        return;
      }
      ui.statusText.textContent = `Loading app list for "${query}"...`;
      try {
        const results = await self.EXT_API.history.search({ text: query, maxResults: 50, startTime: 0 });
        datalist.innerHTML = "";
        // Show root origins only until the user types a path segment
        const wantsPath = /^https?:\/\/[^/]+\/\S/.test(query) || (!/^https?:\/\//i.test(query) && query.includes("/"));
        let shownCount = 0;
        if (wantsPath) {
          for (const r of results.slice(0, 8)) {
            const opt = document.createElement("option");
            opt.value = r.url;
            if (r.title) opt.label = r.title;
            datalist.appendChild(opt);
            shownCount += 1;
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
              shownCount += 1;
              if (seen.size >= 8) break;
            } catch (_) {}
          }
        }
        await logInteraction("newtab_quick_launch_app_list_loaded", {
          query,
          rawResultCount: Number(results?.length || 0),
          shownCount,
          mode: wantsPath ? "path_results" : "origin_results"
        });
        if (shownCount > 0) {
          await logInteraction("newtab_quick_launch_surface_instead_of_auto_launch", {
            query,
            topCandidateUrl: String(results?.[0]?.url || ""),
            shownCount,
            reasonCode: "explicit_selection_required",
            reason: QUICK_LAUNCH_SURFACE_REASON
          });
        }
        if (!state.activeSession) {
          ui.statusText.textContent = shownCount > 0
            ? `Showing ${shownCount} suggestions for "${query}" (manual choice required).`
            : `No suggestions found for "${query}".`;
        }
      } catch (_) {
        if (!state.activeSession) {
          ui.statusText.textContent = `Could not load app list for "${query}".`;
        }
      }
    });

    let committed = false;
    async function commit() {
      if (committed) return;
      committed = true;
      const url = normalizeUrl(input.value);
      if (url && !state.quickLaunchItems.some(i => i.url === url)) {
        await logInteraction("newtab_quick_launch_add_commit", { url });
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
  ui.startBtn.addEventListener("click", () => {
    handleStartClick().catch(() => {
      ui.statusText.textContent = "Could not start timer. Try again.";
    });
  });
  ui.openSettingsBtn?.addEventListener("click", async () => {
    await logInteraction("newtab_open_settings_click", {});
    try {
      if (self.EXT_API.runtime.openOptionsPage) {
        await self.EXT_API.runtime.openOptionsPage();
      } else {
        window.location.href = self.EXT_API.runtime.getURL("src/settings/settings.html");
      }
    } catch (_) {
      window.location.href = self.EXT_API.runtime.getURL("src/settings/settings.html");
    }
  });
  ui.openLogsBtn?.addEventListener("click", async () => {
    await logInteraction("newtab_open_logs_click", {});
    window.location.href = `${self.EXT_API.runtime.getURL("src/settings/settings.html")}#interaction-review`;
  });
}

function applyGateModeUi() {
  if (!state.isGateMode) return;
  if (ui.titleText) {
    ui.titleText.textContent = `This website may be bad for you (karma: ${state.gateScore})`;
  }
  if (ui.reasonLabel) {
    ui.reasonLabel.textContent = "Is it really needed? (required)";
  }
  if (ui.reasonInput) {
    ui.reasonInput.placeholder = "Is it really needed? (required)";
    ui.reasonInput.maxLength = 240;
  }
  if (ui.startBtn) {
    ui.startBtn.textContent = "Start timer and continue";
  }
}

function prefillTimerFromActiveSession() {
  if (!state.timerWheel) return;
  if (!state.activeSession || state.activeSession.ended) return;
  const remainingMinutes = Math.max(1, Math.ceil((Number(state.activeSession.endsAt || 0) - Date.now()) / (60 * 1000)));
  state.timerWheel.setMinutes(remainingMinutes, true);
}

function startTicking() {
  window.setInterval(() => {
    renderStatus();
  }, 1000);
}

async function init() {
  await logInteraction("newtab_opened", {});
  const newtabParams = getNewtabParams();
  await traceBoundary("newtab_params_received", {
    gate: Boolean(newtabParams.gate),
    target: String(newtabParams.targetUrl || ""),
    domain: String(newtabParams.domain || ""),
    score: Number(newtabParams.score || 0),
    resumeContinueAnyway: Boolean(newtabParams.resumeContinueAnyway)
  });
  state.isGateMode = Boolean(newtabParams.gate);
  state.pendingTargetUrl = newtabParams.targetUrl || "";
  state.gateDomain = newtabParams.domain || "";
  state.gateScore = Number.isFinite(newtabParams.score) ? newtabParams.score : 0;
  state.prefillReason = newtabParams.prefillReason || "";
  state.resumeContinueAnyway = Boolean(newtabParams.resumeContinueAnyway);
  state.continueDomain = newtabParams.continueDomain || "";

  state.timerWheel = self.createTimerWheel({
    wheelElement: ui.wheel,
    minMinutes: 1,
    maxMinutes: 120,
    initialMinutes: 1,
    onChange: (minutes) => {
      state.selectedMinutes = minutes;
    }
  });
  applyGateModeUi();
  bindEvents();
  if (typeof initFidgetCube === "function") initFidgetCube();
  let previousSession = null;
  if (!state.isGateMode) {
    try {
      const resetResult = await sendMessage("mindfultab/reset-session-newtab");
      previousSession = resetResult?.previousSession || null;
    } catch (_) {
      // If worker is still waking up, continue with local UI.
    }
  }
  await refreshState();
  if (state.isGateMode) {
    await traceDecision("gate_mode_enabled", {
      domain: state.gateDomain,
      score: state.gateScore
    });
    prefillTimerFromActiveSession();
  }
  await loadQuickLaunch();
  if (!state.isGateMode) {
    state.activeSession = null;
  }
  ui.reasonInput.value = state.prefillReason;
  if (!state.isGateMode) {
    renderLastSessionSummary(previousSession);
  }
  startTicking();
}

init().catch(() => {
  ui.statusText.textContent = "MindfulTab could not initialize.";
});
