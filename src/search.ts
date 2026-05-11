import type { CollectionLike } from './atlas';
import { App, SuggestModal } from 'obsidian';
import type { VaultVectorSettings } from './settings';

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

export class VaultVectorSearchModal extends SuggestModal<SearchHit> {
  private readonly collection: CollectionLike;
  private readonly settings: VaultVectorSettings;
  private readonly onPick: (path: string) => void;
  private lastSearchId = 0;

  constructor(
    app: App,
    settings: VaultVectorSettings,
    collection: CollectionLike,
    onPick: (path: string) => void
  ) {
    super(app);
    this.settings = settings;
    this.collection = collection;
    this.onPick = onPick;
    this.setPlaceholder('Search your vault semantically…');
  }

  async getSuggestions(query: string): Promise<SearchHit[]> {
    const id = ++this.lastSearchId;
    await new Promise(resolve => setTimeout(resolve, 300));
    if (id !== this.lastSearchId) return [];
    try {
      return await executeSearch(this.collection, {
        index: this.settings.indexName,
        query,
        limit: this.settings.resultLimit,
      });
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
