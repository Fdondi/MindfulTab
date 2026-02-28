const EMBEDDING_DIM = 128;

function tokenizeText(input) {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s:/._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedText(input) {
  const vector = new Float32Array(EMBEDDING_DIM);
  const tokens = tokenizeText(input);
  if (!tokens.length) return vector;

  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % EMBEDDING_DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[idx] += sign;
  }

  return normalizeVector(vector);
}

function normalizeVector(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function serializeVector(vec) {
  return Array.from(vec);
}

function deserializeVector(list) {
  return new Float32Array(Array.isArray(list) ? list : []);
}

self.EmbeddingUtils = {
  EMBEDDING_DIM,
  tokenizeText,
  embedText,
  cosineSimilarity,
  serializeVector,
  deserializeVector
};
