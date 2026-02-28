const SEARCH_INDEX_VERSION = 1;

function buildDocumentText(link) {
  return `${link.title || ""} ${link.url || ""} ${link.intent || ""}`.trim();
}

function createEmbeddingIndex(links) {
  const records = [];
  for (const link of links || []) {
    if (!link?.url) continue;
    const text = buildDocumentText(link);
    if (!text) continue;
    records.push({
      url: link.url,
      title: link.title || link.url,
      visitCount: Number(link.visitCount || 0),
      lastVisit: Number(link.lastVisit || 0),
      source: link.source || "unknown",
      embedding: self.EmbeddingUtils.serializeVector(self.EmbeddingUtils.embedText(text))
    });
  }
  return { version: SEARCH_INDEX_VERSION, records, builtAt: Date.now() };
}

function searchEmbeddingIndex(query, index, limit) {
  const records = index?.records || [];
  const queryVec = self.EmbeddingUtils.embedText(query || "");
  const ranked = [];

  for (const item of records) {
    const docVec = self.EmbeddingUtils.deserializeVector(item.embedding);
    const similarity = self.EmbeddingUtils.cosineSimilarity(queryVec, docVec);
    const recencyBoost = item.lastVisit ? Math.min(0.25, (Date.now() - item.lastVisit) < 86400000 ? 0.25 : 0) : 0;
    const visitBoost = Math.min(0.2, (item.visitCount || 0) / 100);
    ranked.push({
      ...item,
      score: similarity + recencyBoost + visitBoost
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, limit || 8));
}

function keywordFallbackSearch(query, links, limit) {
  const tokens = self.EmbeddingUtils.tokenizeText(query);
  if (!tokens.length) return [];

  const results = [];
  for (const link of links || []) {
    const text = buildDocumentText(link).toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (text.includes(token)) score += 1;
    }
    if (score > 0) {
      results.push({ ...link, score: score + Math.min(0.2, (link.visitCount || 0) / 100) });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.max(1, limit || 8));
}

self.SearchIndex = {
  SEARCH_INDEX_VERSION,
  createEmbeddingIndex,
  searchEmbeddingIndex,
  keywordFallbackSearch
};
