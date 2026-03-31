const EXT_API = typeof browser !== "undefined" ? browser : chrome;
const OAUTH = self.MINDFULTAB_GOOGLE_OAUTH;

const ui = {
  tabKarma: document.getElementById("tab-karma"),
  tabAi: document.getElementById("tab-ai"),
  tabLogs: document.getElementById("tab-logs"),
  karmaPanel: document.getElementById("karma-panel"),
  aiPanel: document.getElementById("ai-panel"),
  logsPanel: document.getElementById("logs-panel"),
  aiAccountStatus: document.getElementById("ai-account-status"),
  aiGoogleAuthBtn: document.getElementById("ai-google-auth-btn"),
  aiRedirectPreview: document.getElementById("ai-redirect-uri-preview"),
  aiBaseUrl: document.getElementById("ai-base-url"),
  aiValidate: document.getElementById("ai-validate-intents"),
  aiSaveBtn: document.getElementById("ai-save-btn"),
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
  const name = tabName === "logs" || tabName === "ai" || tabName === "karma" ? tabName : "karma";
  ui.tabKarma.classList.toggle("active", name === "karma");
  ui.tabKarma.setAttribute("aria-selected", name === "karma" ? "true" : "false");
  ui.tabAi.classList.toggle("active", name === "ai");
  ui.tabAi.setAttribute("aria-selected", name === "ai" ? "true" : "false");
  ui.tabLogs.classList.toggle("active", name === "logs");
  ui.tabLogs.setAttribute("aria-selected", name === "logs" ? "true" : "false");
  ui.karmaPanel.classList.toggle("hidden", name !== "karma");
  ui.aiPanel.classList.toggle("hidden", name !== "ai");
  ui.logsPanel.classList.toggle("hidden", name !== "logs");
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
    case "bird_phase_started":
      return `[${ts}] Bird phase started${details.domain ? ` on ${details.domain}` : ""} (raptor: #${Number(details.milestones?.raptorBird || 10)}, first penalty: #${Number(details.milestones?.firstPenaltyBird || 11)}, forced close: #${Number(details.milestones?.forcedCloseBird || 20)})`;
    case "bird_milestone":
      if (details.milestone === "raptor_checkpoint_reached") {
        return `[${ts}] Raptor checkpoint reached${details.domain ? ` on ${details.domain}` : ""}${details.birdIndex ? ` (bird #${Number(details.birdIndex)})` : ""}`;
      }
      if (details.milestone === "forced_closure") {
        return `[${ts}] Forced closure milestone reached${details.domain ? ` on ${details.domain}` : ""}${details.birdIndex ? ` (bird #${Number(details.birdIndex)})` : ""}`;
      }
      return `[${ts}] Bird milestone: ${details.milestone || "unknown"}${details.domain ? ` on ${details.domain}` : ""}`;
    case "karma_penalty_bird_milestone":
      if (details.reason === "passed_raptor_without_closing") {
        return `[${ts}] Karma -${Math.max(1, Number(details.points || 1))}${details.domain ? ` on ${details.domain}` : ""} (did not close before bird #11)`;
      }
      if (details.reason === "forced_closure_bird_20") {
        return `[${ts}] Karma -${Math.max(1, Number(details.points || 1))}${details.domain ? ` on ${details.domain}` : ""} (forced closure at bird #20)`;
      }
      return `[${ts}] Karma penalty -${Math.max(1, Number(details.points || 1))}${details.domain ? ` on ${details.domain}` : ""}`;
    case "karma_daily_recovery":
      return `[${ts}] Karma catch-up recovery applied to ${Math.max(0, Number(details.recoveredDomains || 0))} domain(s) after ${Math.max(0, Number(details.daysElapsed || 0))} day(s)`;
    case "reflection_gate_shown":
      return `[${ts}] Reflection gate shown for ${details.domain || "domain"}${details.karmaScore != null ? ` (karma ${details.karmaScore})` : ""}`;
    case "reflection_continue_anyway":
      return `[${ts}] Continued anyway${details.domain ? ` on ${details.domain}` : ""}${details.reflectionText ? ` with reflection: "${details.reflectionText}"` : (details.wroteReflection || details.hasReflection ? " after writing reflection" : "")}`;
    case "newtab_open_settings_click":
      return `[${ts}] Opened settings`;
    case "newtab_open_logs_click":
      return `[${ts}] Opened logs`;
    case "newtab_open_ai_settings_click":
      return `[${ts}] Opened AI settings`;
    case "newtab_google_sign_in_success":
      return `[${ts}] Signed in with Google from new tab`;
    case "newtab_google_sign_out_click":
      return `[${ts}] Signed out from AI (new tab)`;
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
    case "session_extended":
      return `[${ts}] Timer extended by ${Math.max(1, Number(details.extraMinutes || 0))} min${details.domain ? ` (${details.domain})` : ""}`;
    case "ai_time_extension_granted":
      return `[${ts}] AI granted ${Math.max(1, Number(details.minutes || 0))} extra min${details.domain ? ` (${details.domain})` : ""}`;
    case "settings_ai_saved":
      return `[${ts}] AI settings saved${details.validateIntents ? " (intent validation on)" : ""}`;
    case "google_sign_in_completed":
      return `[${ts}] Signed in with Google for AI backend`;
    case "google_sign_out":
      return `[${ts}] Signed out from AI backend`;
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

function renderAiAccountLine(settings) {
  if (!ui.aiAccountStatus) return;
  const email = String(settings?.aiGoogleEmail || "").trim();
  const usable = OAUTH && OAUTH.mindfultabAiAuthUsable(settings);
  const exp = Number(settings?.aiBackendTokenExpiresAtMs || 0);
  if (usable && email) {
    const expHint = exp > 0 && Number.isFinite(exp) ? ` — session until ${new Date(exp).toLocaleString()}` : "";
    ui.aiAccountStatus.textContent = `Signed in as ${email}${expHint}.`;
    return;
  }
  if (usable) {
    ui.aiAccountStatus.textContent = "Signed in (backend session active).";
    return;
  }
  ui.aiAccountStatus.textContent = "Not signed in. Use the button below to enable AI features.";
}

function renderAiGoogleAuthButton(settings) {
  if (!ui.aiGoogleAuthBtn || !OAUTH) return;
  const signedIn = OAUTH.mindfultabAiAuthUsable(settings);
  ui.aiGoogleAuthBtn.textContent = signedIn ? "Sign out" : "Sign in with Google";
  ui.aiGoogleAuthBtn.classList.toggle("primary", !signedIn);
  ui.aiGoogleAuthBtn.setAttribute(
    "aria-label",
    signedIn ? "Sign out from AI backend" : "Sign in with Google for AI features"
  );
}

async function loadAiSettings() {
  const response = await sendMessage("mindfultab/get-raw-settings");
  if (!response?.ok) return;
  const s = response.settings || {};
  if (ui.aiBaseUrl) ui.aiBaseUrl.value = String(s.aiBackendBaseUrl || "");
  if (ui.aiValidate) ui.aiValidate.checked = Boolean(s.aiIntentValidationEnabled);
  renderAiAccountLine(s);
  renderAiGoogleAuthButton(s);
}

async function handleSaveAiSettings() {
  if (!ui.aiSaveBtn) return;
  ui.aiSaveBtn.disabled = true;
  try {
    const patch = {
      aiBackendBaseUrl: ui.aiBaseUrl?.value?.trim() || "",
      aiIntentValidationEnabled: Boolean(ui.aiValidate?.checked)
    };
    const response = await sendMessage("mindfultab/patch-raw-settings", { patch });
    if (response?.ok) {
      setStatusMessage("AI settings saved.");
      await logInteraction("settings_ai_saved", { validateIntents: patch.aiIntentValidationEnabled });
      await loadAiSettings();
    } else {
      setStatusMessage(response?.error || "Could not save AI settings.");
    }
  } finally {
    ui.aiSaveBtn.disabled = false;
  }
}

async function handleGoogleAuthBtn() {
  if (!OAUTH) {
    setStatusMessage("Google OAuth helper failed to load. Reload the page.");
    return;
  }
  const current = await sendMessage("mindfultab/get-raw-settings");
  const s = current?.settings || {};
  const signedIn = OAUTH.mindfultabAiAuthUsable(s);
  ui.aiGoogleAuthBtn.disabled = true;
  setStatusMessage("");
  try {
    if (signedIn) {
      await OAUTH.mindfultabGoogleSignOut(sendMessage);
      setStatusMessage("Signed out from AI backend.");
    } else {
      const out = await OAUTH.mindfultabCompleteGoogleSignIn(EXT_API, sendMessage);
      setStatusMessage(out.email ? `Signed in as ${out.email}.` : "Signed in.");
    }
    await loadAiSettings();
  } catch (err) {
    setStatusMessage(String(err));
  } finally {
    ui.aiGoogleAuthBtn.disabled = false;
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
  const hash = window.location.hash;
  const wantsLogs = hash === "#interaction-review";
  const wantsAi = hash === "#ai";
  const initialTab = wantsAi ? "ai" : wantsLogs ? "logs" : "karma";
  setActiveTab(initialTab);
  if (initialTab === "ai") {
    loadAiSettings().catch(() => {});
  }
  ui.tabKarma.addEventListener("click", () => {
    setActiveTab("karma");
    history.replaceState(null, "", "#karma");
  });
  ui.tabAi.addEventListener("click", () => {
    setActiveTab("ai");
    history.replaceState(null, "", "#ai");
    loadAiSettings().catch(() => {});
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
  ui.aiSaveBtn?.addEventListener("click", () => {
    handleSaveAiSettings().catch(() => {});
  });
  ui.aiGoogleAuthBtn?.addEventListener("click", () => {
    handleGoogleAuthBtn().catch(() => {});
  });
  if (ui.aiRedirectPreview && EXT_API.identity?.getRedirectURL) {
    ui.aiRedirectPreview.textContent = EXT_API.identity.getRedirectURL();
  }
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
