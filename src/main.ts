import { MongoClient } from 'mongodb';
import { Notice, Plugin } from 'obsidian';
import {
  type AtlasFactory,
  type Connector,
  createAtlasFactory,
  type MongoClientLike,
} from './atlas';
import {
  createLocalStore,
  type FileAdapter,
  type LocalStore,
} from './local-store';
import {
  DEFAULT_SETTINGS,
  validateUri,
  type VaultVectorSettings,
  VaultVectorSettingTab,
} from './settings';
import { type NoteInput, runLocalSync, runSync } from './sync';
import {
  executeLocalSearch,
  executeSearch,
  type SearchFn,
  type SearchHit,
  VaultVectorSearchModal,
} from './search';
import { createVoyageClient, type VoyageClient } from './voyage';

const realConnector: Connector = async (uri) => {
  const client = new MongoClient(uri);
  await client.connect();
  return client as unknown as MongoClientLike;
};

export default class VaultVectorPlugin extends Plugin {
  settings: VaultVectorSettings = DEFAULT_SETTINGS;
  private atlas: AtlasFactory | null = null;
  private localStore: LocalStore | null = null;
  private voyage: VoyageClient | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new VaultVectorSettingTab(this.app, this));

    this.addCommand({
      id: 'vault-vector-sync',
      name: 'Vault Vector: Sync',
      callback: () => this.runSyncCommand(),
    });

    this.addCommand({
      id: 'vault-vector-search',
      name: 'Vault Vector: Search',
      callback: () => this.openSearchModal(),
    });
  }

  async onunload(): Promise<void> {
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
  }

  private getAtlas(): AtlasFactory {
    if (!this.atlas) {
      this.atlas = createAtlasFactory(this.settings, realConnector);
    }
    return this.atlas;
  }

  private fileAdapter(): FileAdapter {
    const adapter = this.app.vault.adapter;
    return {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, d) => adapter.write(p, d),
    };
  }

  private cachePath(): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/embeddings.json`;
  }

  private getLocalStore(): LocalStore {
    if (!this.localStore) {
      this.localStore = createLocalStore({
        adapter: this.fileAdapter(),
        path: this.cachePath(),
        model: this.settings.voyageModel,
      });
    }
    return this.localStore;
  }

  private getVoyage(): VoyageClient {
    if (!this.voyage) {
      this.voyage = createVoyageClient({
        apiKey: this.settings.voyageApiKey,
        model: this.settings.voyageModel,
      });
    }
    return this.voyage;
  }

  private async collectInputs(): Promise<NoteInput[]> {
    const files = this.app.vault.getMarkdownFiles();
    const inputs: NoteInput[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      inputs.push({ path: file.path, content, mtime: file.stat.mtime });
    }
    return inputs;
  }

  private async runSyncCommand(): Promise<void> {
    if (this.settings.embeddingProvider === 'voyage-local') {
      if (!this.settings.voyageApiKey.trim()) {
        new Notice('Configure Voyage API key in Settings.');
        return;
      }
      new Notice('Vault Vector: starting sync…');
      try {
        const inputs = await this.collectInputs();
        const store = this.getLocalStore();
        await store.load();
        const result = await runLocalSync(inputs, store, this.getVoyage());
        let msg = `Vault Vector: synced ${result.upserted}, deleted ${result.deleted}.`;
        if (result.rejected.length > 0) {
          msg += ` ${result.rejected.length} rejected (see console).`;
        }
        new Notice(msg);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Vault Vector local sync failed', err);
        new Notice(`Voyage sync failed: ${detail}`);
      }
      return;
    }

    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }
    new Notice('Vault Vector: starting sync…');

    try {
      const inputs = await this.collectInputs();
      const collection = await this.getAtlas().getCollection();
      const result = await runSync(inputs, collection);

      let msg = `Vault Vector: synced ${result.upserted}, deleted ${result.deleted}.`;
      if (result.rejected.length > 0) {
        msg += ` ${result.rejected.length} rejected (see console).`;
      }
      new Notice(msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector sync failed', err);
      new Notice(`Atlas error: ${detail}`);
    }
  }

  private async openSearchModal(): Promise<void> {
    const onPick = (path: string) => this.app.workspace.openLinkText(path, '', false);

    if (this.settings.embeddingProvider === 'voyage-local') {
      if (!this.settings.voyageApiKey.trim()) {
        new Notice('Configure Voyage API key in Settings.');
        return;
      }
      const store = this.getLocalStore();
      const voyage = this.getVoyage();
      try {
        await store.load();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Vault Vector load cache failed', err);
        new Notice(`Local cache load failed: ${detail}`);
        return;
      }
      const search: SearchFn = (query) =>
        executeLocalSearch(voyage, store, query, this.settings.resultLimit);
      new VaultVectorSearchModal(this.app, search, onPick).open();
      return;
    }

    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }

    try {
      const collection = await this.getAtlas().getCollection();
      const search: SearchFn = (query) =>
        executeSearch(collection, {
          index: this.settings.indexName,
          query,
          limit: this.settings.resultLimit,
        });
      new VaultVectorSearchModal(this.app, search, onPick).open();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector connect failed', err);
      new Notice(`Atlas connection failed: ${detail}`);
    }
  }
}

export type { SearchHit };
