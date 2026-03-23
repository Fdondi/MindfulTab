const EXT_API = typeof browser !== "undefined" ? browser : chrome;

const ui = {
  tabKarma: document.getElementById("tab-karma"),
  tabLogs: document.getElementById("tab-logs"),
  karmaPanel: document.getElementById("karma-panel"),
  logsPanel: document.getElementById("logs-panel"),
  refreshBtn: document.getElementById("refresh-btn"),
  refreshInteractionsBtn: document.getElementById("refresh-interactions-btn"),
  clearInteractionsBtn: document.getElementById("clear-interactions-btn"),
  forgiveAllBtn: document.getElementById("forgive-all-btn"),
  domainList: document.getElementById("domain-list"),
  interactionList: document.getElementById("interaction-list"),
  interactionEmptyState: document.getElementById("interaction-empty-state"),
  emptyState: document.getElementById("empty-state"),
  statDomains: document.getElementById("stat-domains"),
  statNegative: document.getElementById("stat-negative"),
  statTotal: document.getElementById("stat-total"),
  statusMessage: document.getElementById("status-message")
};

async function sendMessage(type, payload = {}) {
  return EXT_API.runtime.sendMessage({ type, payload });
}

async function logInteraction(eventType, details = {}) {
  try {
    await sendMessage("mindfultab/log-interaction", { eventType, details });
  } catch (_) {
    // Ignore logging errors in settings UI.
  }
}

function setActiveTab(tabName) {
  const isLogs = tabName === "logs";
  ui.tabKarma.classList.toggle("active", !isLogs);
  ui.tabKarma.setAttribute("aria-selected", isLogs ? "false" : "true");
  ui.tabLogs.classList.toggle("active", isLogs);
  ui.tabLogs.setAttribute("aria-selected", isLogs ? "true" : "false");
  ui.karmaPanel.classList.toggle("hidden", isLogs);
  ui.logsPanel.classList.toggle("hidden", !isLogs);
}

function rowTemplate(domain, score, visits, optedOut) {
  return `
    <span class="domain">${domain}</span>
    <span class="num">${score > 0 ? `+${score}` : score}</span>
    <span class="num">${visits}</span>
    <span>${optedOut ? "Yes" : "No"}</span>
    <div class="actions">
      <button type="button" data-action="forgive" data-domain="${domain}">Forgive (reset)</button>
      <button type="button" class="${optedOut ? "" : "primary"}" data-action="toggle-optout" data-domain="${domain}" data-optedout="${optedOut ? "true" : "false"}">
        ${optedOut ? "Disable always allow" : "Always allow"}
      </button>
    </div>
  `;
}

function setStatusMessage(message) {
  if (!message) {
    ui.statusMessage.textContent = "";
    ui.statusMessage.classList.add("hidden");
    return;
  }
  ui.statusMessage.textContent = message;
  ui.statusMessage.classList.remove("hidden");
}

function formatInteractionTime(atIso) {
  if (!atIso) return "unknown time";
  const date = new Date(atIso);
  if (Number.isNaN(date.getTime())) return atIso;
  return date.toLocaleString();
}

function buildSessionFileName(startAtIso, indexFromNewest) {
  const date = new Date(startAtIso || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const yyyy = String(safe.getFullYear());
  const mm = String(safe.getMonth() + 1).padStart(2, "0");
  const dd = String(safe.getDate()).padStart(2, "0");
  const hh = String(safe.getHours()).padStart(2, "0");
  const min = String(safe.getMinutes()).padStart(2, "0");
  const ss = String(safe.getSeconds()).padStart(2, "0");
  return `session-${yyyy}${mm}${dd}-${hh}${min}${ss}-${String(indexFromNewest + 1).padStart(3, "0")}.log`;
}

function buildSessions(interactions) {
  const chronological = [...interactions].reverse();
  const sessions = [];
  let current = null;
  let orphanCount = 0;

  for (const item of chronological) {
    if (item?.eventType === "newtab_opened") {
      if (current) sessions.push(current);
      current = { startedAtIso: item.atIso, items: [item] };
      continue;
    }
    if (!current) {
      orphanCount += 1;
      current = { startedAtIso: item?.atIso || new Date().toISOString(), items: [] };
    }
    current.items.push(item);
  }
  if (current) sessions.push(current);

  const newestFirst = sessions.reverse();
  return newestFirst.map((session, index) => ({
    ...session,
    isOrphan: orphanCount > 0 && index === newestFirst.length - 1 && session.items[0]?.eventType !== "newtab_opened",
    fileName: buildSessionFileName(session.startedAtIso, index)
  }));
}

function humanEventLine(item) {
  const eventType = String(item?.eventType || "unknown");
  const details = item?.details || {};
  const ts = formatInteractionTime(item?.atIso);

  switch (eventType) {
    case "newtab_opened":
      return `[${ts}] Opened MindfulTab new tab`;
    case "session_started":
      return `[${ts}] Timer started for ${Number(details.durationMinutes || 0)} min${details.intent ? ` ("${details.intent}")` : ""}${details.domain ? ` on ${details.domain}` : ""}`;
    case "session_ended":
      return `[${ts}] Timer ended${details.domain ? ` on ${details.domain}` : ""}${details.overrunPenaltyApplied ? " (karma penalty applied)" : ""}`;
    case "reflection_gate_shown":
      return `[${ts}] Reflection gate shown for ${details.domain || "domain"}${details.karmaScore != null ? ` (karma ${details.karmaScore})` : ""}`;
    case "reflection_continue_anyway":
      return `[${ts}] Continued anyway${details.domain ? ` on ${details.domain}` : ""}${details.reflectionText ? ` with reflection: "${details.reflectionText}"` : (details.wroteReflection || details.hasReflection ? " after writing reflection" : "")}`;
    case "newtab_open_settings_click":
      return `[${ts}] Opened settings`;
    case "newtab_open_logs_click":
      return `[${ts}] Opened logs`;
    case "settings_opened":
      return `[${ts}] Opened settings page`;
    case "settings_refresh_domains_click":
      return `[${ts}] Refreshed karma data`;
    case "settings_refresh_interactions_click":
      return `[${ts}] Refreshed logs`;
    case "settings_forgive_click":
    case "karma_forgiven":
      return `[${ts}] Forgave karma for ${details.domain || "domain"}`;
    case "settings_forgive_all_click":
    case "karma_forgiven_all":
      return `[${ts}] Forgave karma for all domains`;
    case "settings_toggle_optout_click":
    case "always_allow_enabled":
      return `[${ts}] Enabled always allow for ${details.domain || "domain"}`;
    case "always_allow_disabled":
      return `[${ts}] Disabled always allow for ${details.domain || "domain"}`;
    case "settings_clear_interactions_click":
      return `[${ts}] Cleared logs`;
    case "newtab_quick_launch_click":
      return `[${ts}] Opened Quick Launch: ${details.label || details.url || "item"}`;
    case "newtab_quick_launch_add_commit":
      return `[${ts}] Added Quick Launch item: ${details.url || "url"}`;
    case "newtab_quick_launch_remove":
      return `[${ts}] Removed Quick Launch item: ${details.url || "url"}`;
    default:
      return `[${ts}] ${eventType}`;
  }
}

function sessionRowTemplate(session) {
  const lines = [];
  for (const item of session.items) {
    lines.push(humanEventLine(item));
  }
  const content = lines.join("\n");
  return `
    <div class="session-file-head">
      <span class="session-file-name">${session.fileName}</span>
      <span class="session-file-count">${session.items.length} entr${session.items.length === 1 ? "y" : "ies"}</span>
    </div>
    <pre class="interaction-details">${content}</pre>
  `;
}

async function loadDomainSettings() {
  const response = await sendMessage("mindfultab/get-karma-settings");
  if (!response?.ok) return;

  const karmaByDomain = response.karmaByDomain || {};
  const optOutDomains = response.optOutDomains || {};
  const domainVisits = response.domainVisits || {};
  const quickLaunchDomains = new Set(response.quickLaunchDomains || []);
  const domainSet = new Set([
    ...Object.keys(karmaByDomain),
    ...Object.keys(optOutDomains),
    ...Object.keys(domainVisits),
    ...quickLaunchDomains
  ]);
  const domains = Array.from(domainSet).sort((a, b) => {
    const visitsDiff = Number(domainVisits[b] || 0) - Number(domainVisits[a] || 0);
    if (visitsDiff !== 0) return visitsDiff;
    return a.localeCompare(b);
  });
  const totalScore = domains.reduce((sum, domain) => sum + Number(karmaByDomain[domain] || 0), 0);
  const negativeDomains = domains.filter((domain) => Number(karmaByDomain[domain] || 0) < 0).length;
  ui.statDomains.textContent = String(domains.length);
  ui.statNegative.textContent = String(negativeDomains);
  ui.statTotal.textContent = totalScore > 0 ? `+${totalScore}` : String(totalScore);

  ui.domainList.innerHTML = "";
  if (!domains.length) {
    ui.emptyState.classList.remove("hidden");
    return;
  }
  ui.emptyState.classList.add("hidden");

  for (const domain of domains) {
    const hasOverride = Object.prototype.hasOwnProperty.call(optOutDomains, domain);
    const optedOut = hasOverride ? Boolean(optOutDomains[domain]) : quickLaunchDomains.has(domain);
    const row = document.createElement("li");
    row.className = "domain-row";
    row.innerHTML = rowTemplate(
      domain,
      Number(karmaByDomain[domain] || 0),
      Number(domainVisits[domain] || 0),
      optedOut
    );
    ui.domainList.appendChild(row);
  }
}

async function loadInteractions() {
  const response = await sendMessage("mindfultab/get-interactions");
  if (!response?.ok) return;

  const interactions = Array.isArray(response.interactions) ? response.interactions : [];
  ui.interactionList.innerHTML = "";
  if (!interactions.length) {
    ui.interactionEmptyState.classList.remove("hidden");
    return;
  }
  ui.interactionEmptyState.classList.add("hidden");

  const sessions = buildSessions(interactions);
  for (const session of sessions) {
    const row = document.createElement("li");
    row.className = "interaction-row";
    row.innerHTML = sessionRowTemplate(session);
    ui.interactionList.appendChild(row);
  }
}

async function handleListClick(target) {
  const button = target?.closest?.("button[data-action][data-domain]");
  if (!button) return;

  const domain = String(button.dataset.domain || "").trim().toLowerCase();
  const action = button.dataset.action;
  if (!domain || !action) return;

  button.disabled = true;
  try {
    if (action === "forgive") {
      await logInteraction("settings_forgive_click", { domain });
      await sendMessage("mindfultab/forgive-karma", { domain });
    } else if (action === "toggle-optout") {
      const currentlyOptedOut = button.dataset.optedout === "true";
      await logInteraction("settings_toggle_optout_click", { domain, optedOut: !currentlyOptedOut });
      await sendMessage("mindfultab/set-domain-opt-out", {
        domain,
        optedOut: !currentlyOptedOut
      });
    }
    await loadDomainSettings();
  } finally {
    button.disabled = false;
  }
}

async function handleForgiveAll() {
  ui.forgiveAllBtn.disabled = true;
  try {
    await logInteraction("settings_forgive_all_click", {});
    const response = await sendMessage("mindfultab/forgive-all-karma");
    if (response?.ok) {
      setStatusMessage(`Forgiven karma across ${response.updatedDomains} domain(s).`);
    }
    await loadDomainSettings();
  } finally {
    ui.forgiveAllBtn.disabled = false;
  }
}

async function handleClearInteractions() {
  ui.clearInteractionsBtn.disabled = true;
  try {
    await sendMessage("mindfultab/clear-interactions");
    await logInteraction("settings_clear_interactions_click", {});
    setStatusMessage("Interaction log cleared.");
    await loadInteractions();
  } finally {
    ui.clearInteractionsBtn.disabled = false;
  }
}

function init() {
  logInteraction("settings_opened", {}).catch(() => {});
  const wantsLogs = window.location.hash === "#interaction-review";
  setActiveTab(wantsLogs ? "logs" : "karma");
  ui.tabKarma.addEventListener("click", () => {
    setActiveTab("karma");
    history.replaceState(null, "", "#karma");
  });
  ui.tabLogs.addEventListener("click", () => {
    setActiveTab("logs");
    history.replaceState(null, "", "#interaction-review");
  });
  ui.refreshBtn.addEventListener("click", () => {
    setStatusMessage("");
    logInteraction("settings_refresh_domains_click", {}).catch(() => {});
    loadDomainSettings().catch(() => {});
  });
  ui.refreshInteractionsBtn.addEventListener("click", () => {
    setStatusMessage("");
    logInteraction("settings_refresh_interactions_click", {}).catch(() => {});
    loadInteractions().catch(() => {});
  });
  ui.clearInteractionsBtn.addEventListener("click", () => {
    handleClearInteractions().catch(() => {});
  });
  ui.forgiveAllBtn.addEventListener("click", () => {
    handleForgiveAll().catch(() => {});
  });
  ui.domainList.addEventListener("click", (event) => {
    handleListClick(event.target).catch(() => {});
  });
  loadDomainSettings().catch(() => {});
  loadInteractions().catch(() => {});
  if (wantsLogs) {
    const review = document.getElementById("interaction-review");
    review?.scrollIntoView({ block: "start", behavior: "auto" });
  }
}

init();
