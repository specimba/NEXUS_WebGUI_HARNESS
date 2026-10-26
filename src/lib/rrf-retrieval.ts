/**
 * RRF hybrid retrieval shim — P3 experiment (hermes-zvec-memory lane, r579).
 *
 * Two independent ranking legs over a small in-memory corpus:
 *   1. BM25 — exact-term lexical relevance (light stemming, stopwords dropped).
 *   2. Hashed token-trigram cosine — a LOCAL, DIAL-FREE stand-in for dense
 *      embeddings (SakanaAI-style hashing trick): deterministic, no API, no
 *      model. Catches morphological/paraphrase overlap ("bundle" vs "bundler",
 *      "component" vs "components-ui") that exact-term BM25 misses.
 * The legs are fused with reciprocal rank fusion (RRF, k=60).
 *
 * The fuse layer is embedder-agnostic: when a keyed embedder lands, swap the
 * `embed()` implementation for real vectors — BM25 + RRF stay untouched.
 *
 * Fully isomorphic (no node/bun APIs) so it can run server-side or be imported
 * straight into a client component for client-side ranking.
 */

export interface RetrievalDoc {
  id: string;
  text: string;
}

/** One fused result: per-leg ranks (1-based; null = absent from that leg) + RRF score. */
export interface RankedDoc {
  id: string;
  bm25Rank: number | null;
  vecRank: number | null;
  rrfScore: number;
}

export const RRF_K = 60;
export const EMBED_DIM = 512;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "it", "its", "this", "that", "these",
  "those", "as", "at", "by", "from", "not", "no", "but", "if", "then", "than",
  "so", "do", "does", "did", "has", "have", "had", "will", "would", "can",
  "could", "should", "what", "which", "who", "when", "where", "how", "all",
  "any", "each", "into", "over", "under", "out", "up", "down", "your", "you",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Deliberately light stemming (plural/progressive suffixes): BM25 is
 * exact-token, so bucketing bundle/bundles/bundling under one term is worth
 * the crudeness. The trigram leg adds fuzz on top; heavy stemming not needed.
 */
function stripLight(t: string): string {
  for (const suf of ["ingly", "edly", "ing", "ed", "es", "s"]) {
    if (t.length > suf.length + 3 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

/** FNV-1a 32-bit — fast, deterministic, good spread for trigram hashing. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed token-trigram embedding: deterministic, L2-normalized, dial-free. */
export function embed(text: string): Map<number, number> {
  const vec = new Map<number, number>();
  for (const tok of tokenize(text)) {
    const padded = `<${tok}>`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const h = fnv1a(padded.slice(i, i + 3));
      const idx = h % EMBED_DIM;
      const sign = (h & 1) === 0 ? 1 : -1;
      vec.set(idx, (vec.get(idx) ?? 0) + sign);
    }
  }
  let norm = 0;
  for (const v of vec.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of vec) vec.set(k, v / norm);
  return vec;
}

function cosine(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  return dot; // both legs L2-normalized → dot = cosine
}

interface IndexedDoc {
  id: string;
  tf: Map<string, number>;
  len: number;
  vec: Map<number, number>;
}

interface ScoredDoc {
  id: string;
  score: number;
}

export class HybridRetriever {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private N = 0;
  private avgLen = 1;

  constructor(corpus: RetrievalDoc[]) {
    let totalLen = 0;
    for (const d of corpus) {
      const toks = tokenize(d.text).map(stripLight);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length, vec: embed(d.text) });
      totalLen += toks.length;
    }
    this.N = this.docs.length;
    this.avgLen = this.N ? Math.max(1, totalLen / this.N) : 1;
  }

  get size(): number {
    return this.N;
  }

  /** Leg 1 — BM25 (Okapi, Lucene-style always-positive idf). */
  bm25(query: string, topN = 10): ScoredDoc[] {
    const qset = [...new Set(tokenize(query).map(stripLight))];
    if (!qset.length || !this.N) return [];
    const k1 = 1.2;
    const b = 0.75;
    const scores: ScoredDoc[] = [];
    for (const d of this.docs) {
      let s = 0;
      for (const t of qset) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / this.avgLen))));
      }
      if (s > 0) scores.push({ id: d.id, score: s });
    }
    return scores.sort((x, y) => y.score - x.score).slice(0, topN);
  }

  /** Leg 2 — hashed-trigram cosine (local semantic stand-in). */
  vector(query: string, topN = 10): ScoredDoc[] {
    const qv = embed(query);
    if (!qv.size) return [];
    return this.docs
      .map((d) => ({ id: d.id, score: cosine(qv, d.vec) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, topN);
  }

  /** RRF fusion of both legs (each leg contributes 1/(k + rank), k=60). */
  hybrid(query: string, topN = 10): RankedDoc[] {
    if (!tokenize(query).length) return [];
    const legDepth = topN * 2;
    const fused = new Map<string, RankedDoc>();
    for (const [i, r] of this.bm25(query, legDepth).entries()) {
      fused.set(r.id, { id: r.id, bm25Rank: i + 1, vecRank: null, rrfScore: 1 / (RRF_K + i + 1) });
    }
    for (const [i, r] of this.vector(query, legDepth).entries()) {
      const cur = fused.get(r.id) ?? { id: r.id, bm25Rank: null, vecRank: null, rrfScore: 0 };
      cur.vecRank = i + 1;
      cur.rrfScore += 1 / (RRF_K + i + 1);
      fused.set(r.id, cur);
    }
    return [...fused.values()].sort((x, y) => y.rrfScore - x.rrfScore).slice(0, topN);
  }
}
