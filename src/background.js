const TIMER_ALARM_NAME = "mindfultab-timer-expired";
const GATE_BYPASS_WINDOW_MS = 5 * 60 * 1000;
const lastUrlByTabId = {};
const allowDomainUntilMs = {};

function nowIso() {
  return new Date().toISOString();
}

async function clearTimerAlarm() {
  await EXT_API.alarms.clear(TIMER_ALARM_NAME);
}

async function scheduleTimerAlarm(endEpochMs) {
  await clearTimerAlarm();
  EXT_API.alarms.create(TIMER_ALARM_NAME, {
    when: endEpochMs
  });
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

async function getCurrentActiveDomain() {
  try {
    const tabs = await EXT_API.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tabs?.[0]?.url || "";
    return getDomainFromUrl(url);
  } catch (_) {
    return "";
  }
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

  await setActiveSession(session);
  await scheduleTimerAlarm(endsAt);
  await appendHistory({ type: "session_started", atIso: nowIso(), session });

  return session;
}

async function finishTimerIfNeeded() {
  const session = await getActiveSession();
  if (!session || session.ended) return null;
  if (Date.now() < session.endsAt) return session;

  const activeDomain = await getCurrentActiveDomain();
  const targetDomain = activeDomain || session.domain;
  const endedSession = { ...session, domain: targetDomain, ended: true, nudgedAt: Date.now() };
  await setActiveSession(endedSession);
  const optOutDomains = await getOptOutDomains();
  if (!optOutDomains[targetDomain]) {
    await applyOverrunPenalty(targetDomain, 1);
  }
  await appendHistory({ type: "session_ended", atIso: nowIso(), session: endedSession });

  try {
    EXT_API.notifications.create({
      type: "basic",
      iconUrl: EXT_API.runtime.getURL("src/newtab/icon.svg"),
      title: "MindfulTab",
      message: "Timer ended. Pause and decide your next step."
    });
  } catch (_) {
    // Notifications can fail if browser has no icon configured.
  }

  return endedSession;
}

async function resetSessionForNewTab() {
  await clearTimerAlarm();
  await clearActiveSession();
  await appendHistory({ type: "session_reset_new_tab", atIso: nowIso() });
}

EXT_API.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM_NAME) return;
  await finishTimerIfNeeded();
});

EXT_API.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = tab?.url || "";
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
  if (optOutDomains[domain]) return;
  const score = karmaByDomain[domain] || 0;
  const karmaState = karmaStateForScore(score, settings.hideThresholds || DEFAULT_SETTINGS.hideThresholds);

  if (karmaState === "normal") return;
  if ((allowDomainUntilMs[domain] || 0) > Date.now()) return;
  if (url.includes("/src/gate/gate.html")) return;

  const gateUrl = EXT_API.runtime.getURL("src/gate/gate.html");
  const target = `${gateUrl}?target=${encodeURIComponent(url)}&domain=${encodeURIComponent(domain)}&score=${encodeURIComponent(String(score))}`;
  await EXT_API.tabs.update(tabId, { url: target });
  await appendHistory({ type: "reflection_gate_shown", atIso: nowIso(), domain, score, targetUrl: url });
});

EXT_API.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await EXT_API.tabs.get(activeInfo.tabId);
    await recordDomainVisit(tab?.url || "", activeInfo.tabId);
  } catch (_) {
    // Ignore race conditions around tab lifecycle.
  }
});

EXT_API.tabs.onRemoved.addListener(async (tabId) => {
  delete lastUrlByTabId[tabId];

  const session = await getActiveSession();
  if (!session || session.ended) return;
  if (session.tabId !== tabId) return;

  await clearTimerAlarm();
  await clearActiveSession();
  await appendHistory({
    type: "session_cancelled_tab_closed",
    atIso: nowIso(),
    session
  });
});

EXT_API.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await setStorageValues({ [STORAGE_KEYS.SETTINGS]: settings });
  await hydrateBrowserHistoryStore(200);
});

EXT_API.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "mindfultab/start-timer") {
      const tabUrl = message.payload?.tabUrl || sender?.tab?.url || "";
      const session = await startTimer({
        durationMinutes: message.payload?.durationMinutes,
        reason: message.payload?.reason,
        tabUrl,
        tabId: sender?.tab?.id
      });
      sendResponse({ ok: true, session });
      return;
    }

    if (message?.type === "mindfultab/get-state") {
      await finishTimerIfNeeded();
      const [session, karmaByDomain, domainVisits, settings] = await Promise.all([
        getActiveSession(),
        getKarmaByDomain(),
        getDomainVisits(),
        getSettings()
      ]);
      sendResponse({ ok: true, session, karmaByDomain, domainVisits, settings });
      return;
    }

    if (message?.type === "mindfultab/reset-session-newtab") {
      await resetSessionForNewTab();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "mindfultab/set-history-mode") {
      const mode = message.payload?.mode || "both_with_toggle";
      const settings = await getSettings();
      const next = {
        ...settings,
        historyMode: mode
      };
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
      sendResponse({ ok: true, karmaByDomain, optOutDomains, domainVisits });
      return;
    }

    if (message?.type === "mindfultab/forgive-karma") {
      const domain = String(message.payload?.domain || "").trim().toLowerCase();
      if (!domain) {
        sendResponse({ ok: false, error: "Domain is required" });
        return;
      }
      const score = await applyRecovery(domain, 1);
      await appendHistory({
        type: "karma_forgiven",
        atIso: nowIso(),
        domain
      });
      sendResponse({ ok: true, domain, score });
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
      if (optedOut) {
        optOutDomains[domain] = true;
      } else {
        delete optOutDomains[domain];
      }
      await setOptOutDomains(optOutDomains);
      await appendHistory({
        type: optedOut ? "domain_opt_out_enabled" : "domain_opt_out_disabled",
        atIso: nowIso(),
        domain
      });
      sendResponse({ ok: true, domain, optedOut });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
