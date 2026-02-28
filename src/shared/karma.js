function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedDomain(domain) {
  return (domain || "").trim().toLowerCase();
}

async function applyOverrunPenalty(domain, minutesOver) {
  const key = normalizedDomain(domain);
  if (!key) return null;

  const karmaByDomain = await getKarmaByDomain();
  const current = karmaByDomain[key] || 0;
  const penalty = Math.max(1, Number(minutesOver) || 1);
  const updated = clamp(current - penalty, -100, 100);

  karmaByDomain[key] = updated;
  await setKarmaByDomain(karmaByDomain);
  return updated;
}

async function applyRecovery(domain, points) {
  const key = normalizedDomain(domain);
  if (!key) return null;

  const karmaByDomain = await getKarmaByDomain();
  const current = karmaByDomain[key] || 0;
  const gain = Math.max(1, Number(points) || 1);
  const updated = clamp(current + gain, -100, 100);

  karmaByDomain[key] = updated;
  await setKarmaByDomain(karmaByDomain);
  return updated;
}

function karmaStateForScore(score, thresholds) {
  if (score <= thresholds.hidden) return "hidden";
  if (score <= thresholds.warning) return "warning";
  return "normal";
}

self.applyOverrunPenalty = applyOverrunPenalty;
self.applyRecovery = applyRecovery;
self.karmaStateForScore = karmaStateForScore;
