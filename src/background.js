if (typeof importScripts === "function") {
  importScripts("shared/storage.js", "shared/karma.js");
}

const BADGE_ALARM_NAME = "mindfultab-badge-tick";
const GATE_BYPASS_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_BYPASS_TIMER_MINUTES = 5;
const lastUrlByTabId = {};
const allowDomainUntilMs = {};
const timerPendingTabs = new Set(); // tabIds that opened newtab but haven't started a timer yet
let quickLaunchDomains = new Set(); // in-memory cache of unmonitored domains

const QUICK_LAUNCH_FOLDER = "Quick Launch";

async function refreshQuickLaunchCache() {
  try {
    const results = await EXT_API.bookmarks.search({ title: QUICK_LAUNCH_FOLDER });
    const folder = results.find(r => !r.url);
    if (!folder) { quickLaunchDomains = new Set(); return; }
    const children = await EXT_API.bookmarks.getChildren(folder.id);
    quickLaunchDomains = new Set(
      children.filter(b => b.url).map(b => getDomainFromUrl(b.url)).filter(Boolean)
    );
  } catch (_) {
    quickLaunchDomains = new Set();
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function isQuickLaunchDomain(domain) {
  return quickLaunchDomains.has(String(domain || "").trim().toLowerCase());
}

function isDomainAlwaysAllowed(domain, optOutDomains) {
  const key = String(domain || "").trim().toLowerCase();
  if (!key) return false;
  if (hasOwn(optOutDomains, key)) {
    return Boolean(optOutDomains[key]);
  }
  return isQuickLaunchDomain(key);
}

const BIRD_COUNT = 20;
const BIRD_INTERVAL_MS = 20_000;
const RAPTOR_BIRD_INDEX = 10;
const FIRST_KARMA_PENALTY_BIRD_INDEX = 11; // 10th is raptor, 11th triggers first penalty
const FORCED_CLOSE_BIRD_INDEX = 20; // forced closure on 20th bird
const RAPTOR_CHECKPOINT_MS = (RAPTOR_BIRD_INDEX - 1) * BIRD_INTERVAL_MS;
const FIRST_KARMA_PENALTY_MS = (FIRST_KARMA_PENALTY_BIRD_INDEX - 1) * BIRD_INTERVAL_MS;
const FORCED_CLOSE_MS = (FORCED_CLOSE_BIRD_INDEX - 1) * BIRD_INTERVAL_MS;
const BIRD_PHASE_MS = FORCED_CLOSE_MS;

function timerAlarmName(tabId) {
  return `mindfultab-timer-${tabId}`;
}

function birdsAlarmName(tabId) {
  return `mindfultab-birds-${tabId}`;
}

function birdsPenaltyAlarmName(tabId) {
  return `mindfultab-birds-penalty-${tabId}`;
}

function birdsRaptorAlarmName(tabId) {
  return `mindfultab-birds-raptor-${tabId}`;
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextLocalMidnightEpochMs(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

function dayDiffFromDateStamp(lastDateStamp, now = new Date()) {
  if (!lastDateStamp) return 0;
  const [y, m, d] = String(lastDateStamp).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const lastDate = new Date(y, m - 1, d);
  lastDate.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - lastDate.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function nowIso() {
  return new Date().toISOString();
}

async function logInteraction(eventType, details = {}, sender = null) {
  const tabId = sender?.tab?.id;
  const senderUrl = sender?.tab?.url || "";
  await appendInteraction({
    atIso: nowIso(),
    eventType: String(eventType || "unknown"),
    tabId: Number.isInteger(tabId) ? tabId : null,
    senderUrl,
    details: details || {}
  });
}

function cleanUrlForLog(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const trimmedPath = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${trimmedPath}`;
  } catch (_) {
    return "";
  }
}

async function updateBadge(tabId) {
  let effectiveTabId = tabId;
  if (effectiveTabId == null) {
    try {
      const tabs = await EXT_API.tabs.query({ active: true, lastFocusedWindow: true });
      effectiveTabId = tabs?.[0]?.id;
    } catch (_) {}
  }
  if (effectiveTabId == null) {
    EXT_API.action.setBadgeText({ text: "" });
    return;
  }
  const session = await getTabSession(effectiveTabId);
  if (!session) {
    EXT_API.action.setBadgeText({ text: "" });
    return;
  }
  if (session.ended) {
    EXT_API.action.setBadgeText({ text: "!" });
    EXT_API.action.setBadgeBackgroundColor({ color: "#c0392b" });
    return;
  }
  const msRemaining = session.endsAt - Date.now();
  if (msRemaining <= 0) {
    EXT_API.action.setBadgeText({ text: "!" });
    EXT_API.action.setBadgeBackgroundColor({ color: "#c0392b" });
    return;
  }
  const totalSeconds = Math.ceil(msRemaining / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const text = mins > 0 ? `${mins}m` : `${secs}s`;
  EXT_API.action.setBadgeText({ text });
  EXT_API.action.setBadgeBackgroundColor({ color: "#58609f" });
}

function startBadgeTick() {
  EXT_API.alarms.get(BADGE_ALARM_NAME).then(existing => {
    if (!existing) {
      EXT_API.alarms.create(BADGE_ALARM_NAME, { periodInMinutes: 0.5 });
    }
  }).catch(() => {
    EXT_API.alarms.create(BADGE_ALARM_NAME, { periodInMinutes: 0.5 });
  });
  updateBadge();
}

async function stopBadgeTickIfIdle() {
  const sessions = await getSessionsByTab();
  const hasActive = Object.values(sessions).some(s => s && !s.ended);
  if (!hasActive) {
    EXT_API.alarms.clear(BADGE_ALARM_NAME);
    EXT_API.action.setBadgeText({ text: "" });
  } else {
    await updateBadge();
  }
}

async function clearTimerAlarm(tabId) {
  await EXT_API.alarms.clear(timerAlarmName(tabId));
}

async function clearBirdsAlarm(tabId) {
  await EXT_API.alarms.clear(birdsAlarmName(tabId));
  await EXT_API.alarms.clear(birdsPenaltyAlarmName(tabId));
  await EXT_API.alarms.clear(birdsRaptorAlarmName(tabId));
}

async function scheduleTimerAlarm(tabId, endEpochMs) {
  await clearTimerAlarm(tabId);
  EXT_API.alarms.create(timerAlarmName(tabId), { when: endEpochMs });
}

function getDomainFromUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname || "";
  } catch (_) {
    return "";
  }
}

function shouldTrackUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function shouldNeverGateUrl(url) {
  if (!url || typeof url !== "string") return true;
  if (url.startsWith("moz-extension://") || url.startsWith("chrome-extension://")) return true;
  return !/^https?:\/\//i.test(url);
}

async function recordDomainVisit(rawUrl, tabId) {
  if (!shouldTrackUrl(rawUrl)) return;
  if (typeof tabId === "number" && lastUrlByTabId[tabId] === rawUrl) return;

  const domain = getDomainFromUrl(rawUrl);
  if (!domain) return;

  const domainVisits = await getDomainVisits();
  domainVisits[domain] = (domainVisits[domain] || 0) + 1;
  await setDomainVisits(domainVisits);
  await upsertVisitedLink({
    url: rawUrl,
    title: domain,
    visitCount: (domainVisits[domain] || 1),
    lastVisit: Date.now(),
    source: "extension"
  });

  if (typeof tabId === "number") {
    lastUrlByTabId[tabId] = rawUrl;
  }
}

async function setDomainKarmaToNeutral(domain) {
  const key = String(domain || "").trim().toLowerCase();
  if (!key) return null;
  const karmaByDomain = await getKarmaByDomain();
  karmaByDomain[key] = 0;
  await setKarmaByDomain(karmaByDomain);
  return karmaByDomain[key];
}

async function forgiveAllDomainKarma() {
  const karmaByDomain = await getKarmaByDomain();
  const domains = Object.keys(karmaByDomain);
  for (const domain of domains) {
    karmaByDomain[domain] = 0;
  }
  await setKarmaByDomain(karmaByDomain);
  return domains.length;
}

async function fetchBrowserHistoryLinks(limit) {
  if (!EXT_API.history?.search) return [];
  const items = await EXT_API.history.search({
    text: "",
    maxResults: Math.max(20, Number(limit || 300)),
    startTime: 0
  });

  const normalized = [];
  for (const item of items || []) {
    if (!shouldTrackUrl(item.url)) continue;
    normalized.push({
      url: item.url,
      title: item.title || item.url,
      visitCount: Number(item.visitCount || 0),
      lastVisit: Number(item.lastVisitTime || 0),
      source: "browser"
    });
  }
  return normalized;
}

async function hydrateBrowserHistoryStore(limit) {
  const links = await fetchBrowserHistoryLinks(limit);
  for (const link of links) {
    await upsertVisitedLink(link);
  }
  return links.length;
}

async function getVisitedLinksByMode(mode) {
  const visitedMap = await getVisitedLinks();
  const all = Object.values(visitedMap);
  if (mode === "extension_only_history") {
    return all.filter((item) => String(item.source || "").includes("extension"));
  }
  if (mode === "browser_history_api") {
    return all.filter((item) => String(item.source || "").includes("browser"));
  }
  return all;
}

async function startTimer({ durationMinutes, reason, tabUrl, tabId }) {
  const startedAt = Date.now();
  const durationMs = Math.max(1, Number(durationMinutes)) * 60 * 1000;
  const endsAt = startedAt + durationMs;
  const ownerTabId = Number.isInteger(tabId) ? tabId : null;
  const session = {
    startedAt,
    endsAt,
    durationMinutes: Math.max(1, Number(durationMinutes)),
    reason: reason || "",
    tabUrl: tabUrl || "",
    tabId: ownerTabId,
    domain: getDomainFromUrl(tabUrl),
    ended: false,
    nudgedAt: null,
    createdAtIso: nowIso()
  };

  await setTabSession(ownerTabId, session);
  await scheduleTimerAlarm(ownerTabId, endsAt);
  startBadgeTick();
  await appendHistory({ type: "session_started", atIso: nowIso(), session });
  await logInteraction("session_started", {
    durationMinutes: session.durationMinutes,
    intent: session.reason || "",
    domain: session.domain || ""
  });

  return session;
}

async function startBypassTimerIfNeeded(tabUrl, tabId) {
  if (!shouldTrackUrl(tabUrl)) return null;
  if (!timerPendingTabs.has(tabId)) return null;

  const currentSession = await getTabSession(tabId);
  if (currentSession && !currentSession.ended) {
    timerPendingTabs.delete(tabId);
    return currentSession;
  }

  const session = await startTimer({
    durationMinutes: DEFAULT_BYPASS_TIMER_MINUTES,
    reason: "Auto-started after bypassing timer selection",
    tabUrl,
    tabId
  });
  timerPendingTabs.delete(tabId);
  await appendHistory({
    type: "session_auto_started_bypass",
    atIso: nowIso(),
    triggerUrl: tabUrl,
    session
  });
  return session;
}

async function finishTimerIfNeeded(tabId) {
  const session = await getTabSession(tabId);
  if (!session || session.ended) return null;
  if (Date.now() < session.endsAt) return session;

  const endedSession = { ...session, ended: true, nudgedAt: Date.now() };
  await setTabSession(tabId, endedSession);
  await appendHistory({ type: "session_ended", atIso: nowIso(), session: endedSession });
  await logInteraction("session_ended", {
    durationMinutes: endedSession.durationMinutes,
    intent: endedSession.reason || "",
    domain: endedSession.domain || "",
    overrunPenaltyApplied: false
  });

  EXT_API.notifications.create({
    type: "basic",
    iconUrl: EXT_API.runtime.getURL("src/newtab/icon.svg"),
    title: "MindfulTab",
    message: "Timer ended. Pause and decide your next step."
  }).catch(() => {});

  return endedSession;
}

async function applyBirdMilestonePenalty(tabId, points, reason) {
  const session = await getTabSession(tabId);
  if (!session?.ended) return false;
  if (!session.domain) return false;

  const optOutDomains = await getOptOutDomains();
  if (isDomainAlwaysAllowed(session.domain, optOutDomains)) return false;

  const score = await applyOverrunPenalty(session.domain, points);
  await appendHistory({
    type: "karma_penalty_bird_milestone",
    atIso: nowIso(),
    tabId,
    domain: session.domain,
    points,
    reason,
    score
  });
  await logInteraction("karma_penalty_bird_milestone", {
    tabId,
    domain: session.domain,
    points,
    reason,
    score
  });
  return true;
}

async function logBirdMilestone(tabId, milestone, details = {}) {
  const session = await getTabSession(tabId);
  if (!session?.ended) return false;
  if (!session.domain) return false;

  await appendHistory({
    type: "bird_milestone",
    atIso: nowIso(),
    tabId,
    domain: session.domain,
    milestone,
    ...details
  });
  await logInteraction("bird_milestone", {
    tabId,
    domain: session.domain,
    milestone,
    ...details
  });
  return true;
}

async function recoverUnderwaterKarmaCatchUp() {
  const today = localDateStamp();
  const storage = await getStorageValues([STORAGE_KEYS.KARMA_LAST_DAILY_RECOVERY_DATE, STORAGE_KEYS.KARMA_BY_DOMAIN]);
  const lastRecoveryDate = storage[STORAGE_KEYS.KARMA_LAST_DAILY_RECOVERY_DATE];
  if (lastRecoveryDate === today) return { recoveredDomains: 0, daysElapsed: 0 };

  const karmaByDomain = storage[STORAGE_KEYS.KARMA_BY_DOMAIN] || {};
  const daysElapsed = dayDiffFromDateStamp(lastRecoveryDate);
  if (!lastRecoveryDate) {
    await setStorageValues({ [STORAGE_KEYS.KARMA_LAST_DAILY_RECOVERY_DATE]: today });
    return { recoveredDomains: 0, daysElapsed: 0 };
  }
  if (daysElapsed < 1) return { recoveredDomains: 0, daysElapsed: 0 };
  let recoveredDomains = 0;

  for (const domain of Object.keys(karmaByDomain)) {
    const score = Number(karmaByDomain[domain] || 0);
    if (score < 0) {
      karmaByDomain[domain] = Math.min(0, score + daysElapsed);
      recoveredDomains += 1;
    }
  }

  await setStorageValues({
    [STORAGE_KEYS.KARMA_BY_DOMAIN]: karmaByDomain,
    [STORAGE_KEYS.KARMA_LAST_DAILY_RECOVERY_DATE]: today
  });

  if (recoveredDomains > 0) {
    await appendHistory({
      type: "karma_daily_recovery",
      atIso: nowIso(),
      recoveredDomains,
      daysElapsed
    });
    await logInteraction("karma_daily_recovery", { recoveredDomains, daysElapsed });
  }

  return { recoveredDomains, daysElapsed };
}

async function resetSessionForNewTab(tabId) {
  const previousSession = await getTabSession(tabId);
  if (tabId != null) {
    await clearTimerAlarm(tabId);
    await clearBirdsAlarm(tabId);
    await clearTabSession(tabId);
  }
  timerPendingTabs.add(tabId);
  await appendHistory({ type: "session_reset_new_tab", atIso: nowIso() });
  await stopBadgeTickIfIdle();
  return previousSession;
}

async function injectBirds(tabId) {
  await EXT_API.scripting.insertCSS({ target: { tabId }, files: ["src/birds/birds.css"] });
  await EXT_API.scripting.executeScript({ target: { tabId }, files: ["src/birds/birds.js"] });
}

EXT_API.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BADGE_ALARM_NAME) {
    await updateBadge();
    return;
  }
  if (alarm.name.startsWith("mindfultab-timer-")) {
    const tabId = Number(alarm.name.replace("mindfultab-timer-", ""));
    if (!Number.isNaN(tabId)) {
      const finished = await finishTimerIfNeeded(tabId);
      await updateBadge(tabId);
      if (finished) {
        await appendHistory({
          type: "bird_phase_started",
          atIso: nowIso(),
          tabId,
          domain: finished.domain || "",
          milestones: {
            raptorBird: RAPTOR_BIRD_INDEX,
            firstPenaltyBird: FIRST_KARMA_PENALTY_BIRD_INDEX,
            forcedCloseBird: FORCED_CLOSE_BIRD_INDEX
          }
        });
        await logInteraction("bird_phase_started", {
          tabId,
          domain: finished.domain || "",
          milestones: {
            raptorBird: RAPTOR_BIRD_INDEX,
            firstPenaltyBird: FIRST_KARMA_PENALTY_BIRD_INDEX,
            forcedCloseBird: FORCED_CLOSE_BIRD_INDEX
          }
        });
        EXT_API.alarms.create(birdsRaptorAlarmName(tabId), { when: Date.now() + RAPTOR_CHECKPOINT_MS });
        EXT_API.alarms.create(birdsPenaltyAlarmName(tabId), { when: Date.now() + FIRST_KARMA_PENALTY_MS });
        EXT_API.alarms.create(birdsAlarmName(tabId), { when: Date.now() + BIRD_PHASE_MS });
        injectBirds(tabId).catch(() => {});
      }
    }
    return;
  }
  if (alarm.name.startsWith("mindfultab-birds-penalty-")) {
    const tabId = Number(alarm.name.replace("mindfultab-birds-penalty-", ""));
    if (!Number.isNaN(tabId)) {
      await applyBirdMilestonePenalty(tabId, 1, "passed_raptor_without_closing");
    }
    return;
  }
  if (alarm.name.startsWith("mindfultab-birds-raptor-")) {
    const tabId = Number(alarm.name.replace("mindfultab-birds-raptor-", ""));
    if (!Number.isNaN(tabId)) {
      await logBirdMilestone(tabId, "raptor_checkpoint_reached", { birdIndex: RAPTOR_BIRD_INDEX });
    }
    return;
  }
  if (alarm.name.startsWith("mindfultab-birds-")) {
    const tabId = Number(alarm.name.replace("mindfultab-birds-", ""));
    if (!Number.isNaN(tabId)) {
      await logBirdMilestone(tabId, "forced_closure", { birdIndex: FORCED_CLOSE_BIRD_INDEX });
      await applyBirdMilestonePenalty(tabId, 1, "forced_closure_bird_20");
      try {
        await EXT_API.tabs.update(tabId, { url: EXT_API.runtime.getURL("src/newtab/newtab.html") });
      } catch (_) {}
    }
  }
});

EXT_API.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  await recoverUnderwaterKarmaCatchUp();
  const url = tab?.url || "";
  const urlDomain = getDomainFromUrl(url);
  if (urlDomain && quickLaunchDomains.has(urlDomain)) {
    const optOutDomains = await getOptOutDomains();
    // Quick Launch domains are always-allow by default, unless manually disabled in settings.
    if (!hasOwn(optOutDomains, urlDomain) || Boolean(optOutDomains[urlDomain])) {
      timerPendingTabs.delete(tabId);
      await recordDomainVisit(url, tabId);
      return;
    }
  }

  await startBypassTimerIfNeeded(url, tabId);

  if (shouldTrackUrl(url)) {
    const session = await getTabSession(tabId);
    if (session?.ended) {
      const birdPhaseEnds = session.endsAt + BIRD_PHASE_MS;
      if (Date.now() < birdPhaseEnds) {
        injectBirds(tabId).catch(() => {});
      } else {
        try {
          await EXT_API.tabs.update(tabId, { url: EXT_API.runtime.getURL("src/newtab/newtab.html") });
        } catch (_) {}
      }
      return;
    }
  }

  await recordDomainVisit(url, tabId);
  if (shouldTrackUrl(url)) {
    await upsertVisitedLink({
      url,
      title: tab?.title || getDomainFromUrl(url),
      visitCount: 1,
      lastVisit: Date.now(),
      source: "extension"
    });
  }

  if (shouldNeverGateUrl(url)) return;
  const domain = getDomainFromUrl(url);
  if (!domain) return;

  const [karmaByDomain, settings, optOutDomains] = await Promise.all([
    getKarmaByDomain(),
    getSettings(),
    getOptOutDomains()
  ]);
  if (isDomainAlwaysAllowed(domain, optOutDomains)) return;
  const score = karmaByDomain[domain] || 0;
  const karmaState = karmaStateForScore(score, settings.hideThresholds || DEFAULT_SETTINGS.hideThresholds);

  if (karmaState === "normal") return;
  if ((allowDomainUntilMs[domain] || 0) > Date.now()) return;
  if (url.includes("/src/gate/gate.html")) return;

  const gateUrl = EXT_API.runtime.getURL("src/gate/gate.html");
  const target = `${gateUrl}?target=${encodeURIComponent(url)}&domain=${encodeURIComponent(domain)}&score=${encodeURIComponent(String(score))}`;
  await EXT_API.tabs.update(tabId, { url: target });
  await appendHistory({ type: "reflection_gate_shown", atIso: nowIso(), domain, score, targetUrl: url });
  await logInteraction("reflection_gate_shown", {
    domain,
    karmaScore: score,
    target: cleanUrlForLog(url)
  });
});

EXT_API.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId) return;
  const parentSession = await getTabSession(tab.openerTabId);
  if (!parentSession || parentSession.ended || Date.now() >= parentSession.endsAt) return;
  const childSession = { ...parentSession, tabId: tab.id };
  await setTabSession(tab.id, childSession);
  await scheduleTimerAlarm(tab.id, childSession.endsAt);
});

EXT_API.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await recoverUnderwaterKarmaCatchUp();
    const tab = await EXT_API.tabs.get(activeInfo.tabId);
    await recordDomainVisit(tab?.url || "", activeInfo.tabId);
    await updateBadge(activeInfo.tabId);
  } catch (_) {
    // Ignore race conditions around tab lifecycle.
  }
});

EXT_API.tabs.onRemoved.addListener(async (tabId) => {
  delete lastUrlByTabId[tabId];
  timerPendingTabs.delete(tabId);
  await clearBirdsAlarm(tabId);

  const session = await getTabSession(tabId);
  if (!session || session.ended) return;

  await clearTimerAlarm(tabId);
  await clearTabSession(tabId);
  await appendHistory({
    type: "session_cancelled_tab_closed",
    atIso: nowIso(),
    session
  });
  await stopBadgeTickIfIdle();
});

EXT_API.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await setStorageValues({ [STORAGE_KEYS.SETTINGS]: settings });
  await hydrateBrowserHistoryStore(200);
  await refreshQuickLaunchCache();
  await setStorageValues({ [STORAGE_KEYS.KARMA_LAST_DAILY_RECOVERY_DATE]: localDateStamp() });
});

// Warm the cache whenever the service worker starts
refreshQuickLaunchCache().catch(() => {});
recoverUnderwaterKarmaCatchUp().catch(() => {});

// Keep cache in sync with bookmark changes
EXT_API.bookmarks.onCreated.addListener(() => refreshQuickLaunchCache().catch(() => {}));
EXT_API.bookmarks.onRemoved.addListener(() => refreshQuickLaunchCache().catch(() => {}));
EXT_API.bookmarks.onChanged.addListener(() => refreshQuickLaunchCache().catch(() => {}));
EXT_API.bookmarks.onMoved.addListener(() => refreshQuickLaunchCache().catch(() => {}));

EXT_API.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const senderTabId = sender?.tab?.id;

    if (message?.type === "mindfultab/start-timer") {
      try {
        const tabUrl = message.payload?.tabUrl || sender?.tab?.url || "";
        timerPendingTabs.delete(senderTabId);
        const session = await startTimer({
          durationMinutes: message.payload?.durationMinutes,
          reason: message.payload?.reason,
          tabUrl,
          tabId: senderTabId
        });
        sendResponse({ ok: true, session });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return;
    }

    if (message?.type === "mindfultab/get-state") {
      await recoverUnderwaterKarmaCatchUp();
      if (senderTabId != null) await finishTimerIfNeeded(senderTabId);
      const session = senderTabId != null ? await getTabSession(senderTabId) : null;
      const [karmaByDomain, domainVisits, settings] = await Promise.all([
        getKarmaByDomain(),
        getDomainVisits(),
        getSettings()
      ]);
      sendResponse({ ok: true, session, karmaByDomain, domainVisits, settings });
      return;
    }

    if (message?.type === "mindfultab/reset-session-newtab") {
      const previousSession = await resetSessionForNewTab(senderTabId);
      sendResponse({ ok: true, previousSession });
      return;
    }

    if (message?.type === "mindfultab/set-history-mode") {
      const mode = message.payload?.mode || "both_with_toggle";
      const settings = await getSettings();
      const next = { ...settings, historyMode: mode };
      await setStorageValues({ [STORAGE_KEYS.SETTINGS]: next });
      sendResponse({ ok: true, settings: next });
      return;
    }

    if (message?.type === "mindfultab/get-visited-links") {
      const settings = await getSettings();
      const mode = message.payload?.mode || settings.historyMode || "both_with_toggle";
      if (mode !== "extension_only_history") {
        await hydrateBrowserHistoryStore(300);
      }
      const links = await getVisitedLinksByMode(mode);
      sendResponse({ ok: true, links, mode });
      return;
    }

    if (message?.type === "mindfultab/log-interaction") {
      const eventType = String(message.payload?.eventType || "").trim();
      if (!eventType) {
        sendResponse({ ok: false, error: "eventType is required" });
        return;
      }
      await logInteraction(eventType, message.payload?.details || {}, sender);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "mindfultab/get-interactions") {
      const interactions = await getInteractions();
      sendResponse({ ok: true, interactions });
      return;
    }

    if (message?.type === "mindfultab/clear-interactions") {
      await clearInteractions();
      await appendHistory({ type: "interactions_cleared", atIso: nowIso() });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "mindfultab/continue-anyway") {
      const { domain, reflection, targetUrl, tabId } = message.payload || {};
      await appendReflection({
        atIso: nowIso(),
        domain: domain || "",
        reflection: reflection || ""
      });
      await appendHistory({
        type: "continue_anyway",
        atIso: nowIso(),
        domain: domain || "",
        targetUrl: targetUrl || ""
      });
      await logInteraction("reflection_continue_anyway", {
        domain: domain || "",
        target: cleanUrlForLog(targetUrl || ""),
        wroteReflection: Boolean(String(reflection || "").trim()),
        reflectionText: String(reflection || "").trim()
      }, sender);
      if (domain) {
        allowDomainUntilMs[domain] = Date.now() + GATE_BYPASS_WINDOW_MS;
      }
      if (targetUrl && typeof tabId === "number") {
        await EXT_API.tabs.update(tabId, { url: targetUrl });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "mindfultab/get-karma-settings") {
      const [karmaByDomain, optOutDomains, domainVisits] = await Promise.all([
        getKarmaByDomain(),
        getOptOutDomains(),
        getDomainVisits()
      ]);
      sendResponse({
        ok: true,
        karmaByDomain,
        optOutDomains,
        domainVisits,
        quickLaunchDomains: Array.from(quickLaunchDomains)
      });
      return;
    }

    if (message?.type === "mindfultab/forgive-karma") {
      const domain = String(message.payload?.domain || "").trim().toLowerCase();
      if (!domain) {
        sendResponse({ ok: false, error: "Domain is required" });
        return;
      }
      const score = await setDomainKarmaToNeutral(domain);
      await appendHistory({ type: "karma_forgiven", atIso: nowIso(), domain });
      await logInteraction("karma_forgiven", { domain }, sender);
      sendResponse({ ok: true, domain, score });
      return;
    }

    if (message?.type === "mindfultab/forgive-all-karma") {
      const updatedDomains = await forgiveAllDomainKarma();
      await appendHistory({ type: "karma_forgiven_all", atIso: nowIso(), updatedDomains });
      await logInteraction("karma_forgiven_all", { updatedDomains }, sender);
      sendResponse({ ok: true, updatedDomains });
      return;
    }

    if (message?.type === "mindfultab/set-domain-opt-out") {
      const domain = String(message.payload?.domain || "").trim().toLowerCase();
      const optedOut = Boolean(message.payload?.optedOut);
      if (!domain) {
        sendResponse({ ok: false, error: "Domain is required" });
        return;
      }
      const optOutDomains = await getOptOutDomains();
      if (optedOut || isQuickLaunchDomain(domain)) {
        // Keep explicit false for Quick Launch domains so users can disable default always-allow.
        optOutDomains[domain] = optedOut;
      } else {
        delete optOutDomains[domain];
      }
      await setOptOutDomains(optOutDomains);
      await appendHistory({
        type: optedOut ? "domain_opt_out_enabled" : "domain_opt_out_disabled",
        atIso: nowIso(),
        domain
      });
      await logInteraction(optedOut ? "always_allow_enabled" : "always_allow_disabled", { domain }, sender);
      sendResponse({ ok: true, domain, optedOut });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
