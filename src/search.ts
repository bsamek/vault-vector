import type { CollectionLike } from './atlas';
import { App, SuggestModal } from 'obsidian';
import type { LocalStore } from './local-store';
import { searchLocalStore } from './local-search';
import type { VoyageClient } from './voyage';

export function renderSnippet(content: string, maxChars: number = 200): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars - 1) + '…';
}

export type SearchHit = { path: string; snippet: string; score: number };

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

export async function executeSearch(
  collection: CollectionLike,
  opts: { index: string; query: string; limit: number }
): Promise<SearchHit[]> {
  if (!opts.query.trim()) return [];
  const pipeline = buildVectorSearchPipeline(opts);
  const docs = await collection.aggregate(pipeline).toArray();
  return docs.map(d => ({
    path: String(d.path),
    snippet: renderSnippet(String(d.content)),
    score: typeof d.score === 'number' ? d.score : 0,
  }));
}

export async function executeLocalSearch(
  voyage: VoyageClient,
  store: LocalStore,
  query: string,
  limit: number
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const [queryEmbedding] = await voyage.embed([query], 'query');
  return searchLocalStore(store, queryEmbedding, limit);
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
