const EXT_API = typeof browser !== "undefined" ? browser : chrome;
self.EXT_API = EXT_API;

const STORAGE_KEYS = {
  SETTINGS: "settings",
  ACTIVE_SESSION: "activeSession",
  KARMA_BY_DOMAIN: "karmaByDomain",
  DOMAIN_VISITS: "domainVisits",
  VISITED_LINKS: "visitedLinks",
  SEARCH_INDEX: "searchIndex",
  REFLECTIONS: "reflections",
  HISTORY: "history"
};

const DEFAULT_SETTINGS = {
  quickDurationsMinutes: [1, 2, 3],
  nudgeCooldownMinutes: 5,
  historyMode: "both_with_toggle",
  hideThresholds: {
    warning: -5,
    hidden: -15
  }
};

async function getStorageValues(keys) {
  return EXT_API.storage.local.get(keys);
}

async function setStorageValues(values) {
  return EXT_API.storage.local.set(values);
}

async function getSettings() {
  const result = await getStorageValues(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

async function getActiveSession() {
  const result = await getStorageValues(STORAGE_KEYS.ACTIVE_SESSION);
  return result[STORAGE_KEYS.ACTIVE_SESSION] || null;
}

async function setActiveSession(session) {
  return setStorageValues({ [STORAGE_KEYS.ACTIVE_SESSION]: session });
}

async function clearActiveSession() {
  return EXT_API.storage.local.remove(STORAGE_KEYS.ACTIVE_SESSION);
}

async function getKarmaByDomain() {
  const result = await getStorageValues(STORAGE_KEYS.KARMA_BY_DOMAIN);
  return result[STORAGE_KEYS.KARMA_BY_DOMAIN] || {};
}

async function setKarmaByDomain(karmaByDomain) {
  return setStorageValues({ [STORAGE_KEYS.KARMA_BY_DOMAIN]: karmaByDomain });
}

async function getDomainVisits() {
  const result = await getStorageValues(STORAGE_KEYS.DOMAIN_VISITS);
  return result[STORAGE_KEYS.DOMAIN_VISITS] || {};
}

async function setDomainVisits(domainVisits) {
  return setStorageValues({ [STORAGE_KEYS.DOMAIN_VISITS]: domainVisits });
}

async function getVisitedLinks() {
  const result = await getStorageValues(STORAGE_KEYS.VISITED_LINKS);
  return result[STORAGE_KEYS.VISITED_LINKS] || {};
}

async function setVisitedLinks(visitedLinks) {
  return setStorageValues({ [STORAGE_KEYS.VISITED_LINKS]: visitedLinks });
}

async function upsertVisitedLink(link) {
  if (!link?.url) return;
  const visitedLinks = await getVisitedLinks();
  const current = visitedLinks[link.url] || {
    url: link.url,
    title: "",
    visitCount: 0,
    lastVisit: 0,
    source: "extension"
  };

  const mergedSourceSet = new Set(
    `${current.source || ""},${link.source || ""}`
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );

  visitedLinks[link.url] = {
    ...current,
    ...link,
    title: link.title || current.title || link.url,
    visitCount: Math.max(Number(current.visitCount || 0), Number(link.visitCount || 0)),
    lastVisit: Math.max(Number(current.lastVisit || 0), Number(link.lastVisit || 0)),
    source: Array.from(mergedSourceSet).join(",")
  };

  return setVisitedLinks(visitedLinks);
}

async function getSearchIndex() {
  const result = await getStorageValues(STORAGE_KEYS.SEARCH_INDEX);
  return result[STORAGE_KEYS.SEARCH_INDEX] || null;
}

async function setSearchIndex(searchIndex) {
  return setStorageValues({ [STORAGE_KEYS.SEARCH_INDEX]: searchIndex });
}

async function appendHistory(item) {
  const result = await getStorageValues(STORAGE_KEYS.HISTORY);
  const history = result[STORAGE_KEYS.HISTORY] || [];
  history.unshift(item);
  return setStorageValues({ [STORAGE_KEYS.HISTORY]: history.slice(0, 1000) });
}

async function appendReflection(item) {
  const result = await getStorageValues(STORAGE_KEYS.REFLECTIONS);
  const reflections = result[STORAGE_KEYS.REFLECTIONS] || [];
  reflections.unshift(item);
  return setStorageValues({ [STORAGE_KEYS.REFLECTIONS]: reflections.slice(0, 500) });
}

self.STORAGE_KEYS = STORAGE_KEYS;
self.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
self.getStorageValues = getStorageValues;
self.setStorageValues = setStorageValues;
self.getSettings = getSettings;
self.getActiveSession = getActiveSession;
self.setActiveSession = setActiveSession;
self.clearActiveSession = clearActiveSession;
self.getKarmaByDomain = getKarmaByDomain;
self.setKarmaByDomain = setKarmaByDomain;
self.getDomainVisits = getDomainVisits;
self.setDomainVisits = setDomainVisits;
self.getVisitedLinks = getVisitedLinks;
self.setVisitedLinks = setVisitedLinks;
self.upsertVisitedLink = upsertVisitedLink;
self.getSearchIndex = getSearchIndex;
self.setSearchIndex = setSearchIndex;
self.appendHistory = appendHistory;
self.appendReflection = appendReflection;
