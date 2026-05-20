import { App, SuggestModal } from 'obsidian';
import type { SearchFn, SearchHit } from '@vault-vector/core';

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
