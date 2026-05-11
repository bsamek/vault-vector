import type { LocalStore } from './local-store';
import { renderSnippet, type SearchHit } from './search';

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function searchLocalStore(
  store: LocalStore,
  queryEmbedding: number[],
  limit: number
): SearchHit[] {
  const scored = store.all().map(({ path, entry }) => ({
    path,
    content: entry.content,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => ({
    path: s.path,
    snippet: renderSnippet(s.content),
    content: s.content,
    score: s.score,
  }));
}
