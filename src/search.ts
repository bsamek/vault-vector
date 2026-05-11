import type { CollectionLike } from './atlas';
import { App, SuggestModal } from 'obsidian';
import type { LocalStore } from './local-store';
import { searchLocalStore } from './local-search';
import type { VoyageClient, VoyageReranker } from './voyage';

export const RERANK_CANDIDATE_MULTIPLIER = 5;
export const RERANK_CANDIDATE_CAP = 50;

export function candidateCount(limit: number, cap: number = RERANK_CANDIDATE_CAP): number {
  return Math.min(limit * RERANK_CANDIDATE_MULTIPLIER, cap);
}

export function renderSnippet(content: string, maxChars: number = 200): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars - 1) + '…';
}

export type SearchHit = { path: string; snippet: string; content: string; score: number };

export function buildVectorSearchPipeline(opts: {
  index: string;
  query: string;
  limit: number;
}): unknown[] {
  return [
    {
      $vectorSearch: {
        index: opts.index,
        path: 'content',
        query: opts.query,
        limit: opts.limit,
        numCandidates: opts.limit * 10,
      },
    },
    {
      $project: {
        _id: 0,
        path: 1,
        content: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

export type DebugLogger = (label: 'search' | 'rerank', ms: number) => void;

export async function executeSearch(
  collection: CollectionLike,
  opts: { index: string; query: string; limit: number },
  rerank?: RerankConfig,
  debug?: DebugLogger,
): Promise<SearchHit[]> {
  if (!opts.query.trim()) return [];
  const fetchLimit = rerank ? candidateCount(opts.limit, rerank.candidateCap) : opts.limit;
  const pipeline = buildVectorSearchPipeline({
    index: opts.index,
    query: opts.query,
    limit: fetchLimit,
  });
  const searchStart = performance.now();
  const docs = await collection.aggregate(pipeline).toArray();
  if (debug) debug('search', performance.now() - searchStart);
  const hits: SearchHit[] = docs.map(d => ({
    path: String(d.path),
    snippet: renderSnippet(String(d.content)),
    content: String(d.content),
    score: typeof d.score === 'number' ? d.score : 0,
  }));
  if (!rerank) return hits;
  const rerankStart = performance.now();
  const reranked = await applyRerank(hits, opts.query, rerank);
  if (debug) debug('rerank', performance.now() - rerankStart);
  return reranked.slice(0, opts.limit);
}

export async function executeLocalSearch(
  voyage: VoyageClient,
  store: LocalStore,
  query: string,
  limit: number,
  rerank?: RerankConfig,
  debug?: DebugLogger,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const fetchLimit = rerank ? candidateCount(limit, rerank.candidateCap) : limit;
  const searchStart = performance.now();
  const [queryEmbedding] = await voyage.embed([query], 'query');
  const hits = searchLocalStore(store, queryEmbedding, fetchLimit);
  if (debug) debug('search', performance.now() - searchStart);
  if (!rerank) return hits;
  const rerankStart = performance.now();
  const reranked = await applyRerank(hits, query, rerank);
  if (debug) debug('rerank', performance.now() - rerankStart);
  return reranked.slice(0, limit);
}

export interface RerankConfig {
  reranker: VoyageReranker;
  instruction: string;
  candidateCap?: number;
  docCharLimit?: number;
}

export async function applyRerank(
  hits: SearchHit[],
  query: string,
  cfg: RerankConfig
): Promise<SearchHit[]> {
  if (hits.length === 0) return [];
  const trimmed = cfg.instruction.trim();
  const effectiveQuery = trimmed ? `${trimmed}\n\n${query}` : query;
  const limit = cfg.docCharLimit ?? 0;
  const documents = hits.map(h =>
    limit > 0 && h.content.length > limit ? h.content.slice(0, limit) : h.content,
  );
  const results = await cfg.reranker.rerank(effectiveQuery, documents, hits.length);
  return results.map(r => ({
    ...hits[r.index],
    score: r.relevanceScore,
  }));
}

export type SearchFn = (query: string) => Promise<SearchHit[]>;

export class VaultVectorSearchModal extends SuggestModal<SearchHit> {
  private readonly search: SearchFn;
  private readonly onPick: (path: string) => void;
  private lastSearchId = 0;

  constructor(app: App, search: SearchFn, onPick: (path: string) => void) {
    super(app);
    this.search = search;
    this.onPick = onPick;
    this.setPlaceholder('Search your vault semantically…');
  }

  async getSuggestions(query: string): Promise<SearchHit[]> {
    const id = ++this.lastSearchId;
    await new Promise(resolve => setTimeout(resolve, 300));
    if (id !== this.lastSearchId) return [];
    try {
      return await this.search(query);
    } catch (err) {
      console.error('Vault Vector search failed', err);
      return [];
    }
  }

  renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    el.createEl('div', { text: hit.path });
    el.createEl('small', { text: hit.snippet });
  }

  onChooseSuggestion(hit: SearchHit): void {
    this.onPick(hit.path);
  }
}
