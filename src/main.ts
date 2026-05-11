import { MongoClient } from 'mongodb';
import { Notice, Plugin, TFile } from 'obsidian';
import { createAutoSync, type AutoSync, type AutoSyncEvent, type AutoSyncStatus } from './auto-sync';
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
  type DebugLogger,
  executeLocalSearch,
  executeSearch,
  type RerankConfig,
  type SearchFn,
  type SearchHit,
  VaultVectorSearchModal,
} from './search';
import { createVoyageClient, createVoyageReranker, type VoyageClient, type VoyageReranker } from './voyage';

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
  private reranker: VoyageReranker | null = null;
  private statusBarEl: HTMLElement | null = null;
  private autoSync: AutoSync | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new VaultVectorSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('vault-vector-status');
    this.statusBarEl.style.cursor = 'pointer';
    this.statusBarEl.onClickEvent(() => { void this.runSyncCommand(); });
    this.renderStatus({ kind: 'idle', lastSyncAt: null });

    this.autoSync = createAutoSync(this.buildAutoSyncDeps());
    this.autoSync.start();

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

  private renderStatus(status: AutoSyncStatus): void {
    if (!this.statusBarEl) return;
    const el = this.statusBarEl;
    switch (status.kind) {
      case 'idle': {
        const stamp = status.lastSyncAt
          ? new Date(status.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'never';
        el.setText('VV ✓');
        el.setAttr('title', `Vault Vector: index up to date (last sync ${stamp})`);
        el.style.color = '';
        break;
      }
      case 'pending':
        el.setText(`VV •${status.pendingCount}`);
        el.setAttr('title', `${status.pendingCount} changes queued, syncing soon`);
        el.style.color = '';
        break;
      case 'syncing':
        el.setText('VV ⟳');
        el.setAttr('title', `Syncing ${status.inFlightCount} notes…`);
        el.style.color = '';
        break;
      case 'error':
        el.setText('VV !');
        el.setAttr('title', `${status.message} (click to retry)`);
        el.style.color = 'var(--text-error)';
        break;
    }
  }

  async onunload(): Promise<void> {
    this.statusBarEl = null;
    if (this.autoSync) { this.autoSync.stop(); this.autoSync = null; }
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
    this.reranker = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
    this.reranker = null;
    if (this.autoSync) this.autoSync.stop();
    this.autoSync = createAutoSync(this.buildAutoSyncDeps());
    this.autoSync.start();
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

  private getReranker(): VoyageReranker {
    if (!this.reranker) {
      this.reranker = createVoyageReranker({
        apiKey: this.settings.voyageApiKey,
        model: this.settings.rerankModel,
      });
    }
    return this.reranker;
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

  private async runSyncPipeline(): Promise<import('./sync').SyncResult> {
    if (this.settings.embeddingProvider === 'voyage-local') {
      if (!this.settings.voyageApiKey.trim()) throw new Error('Voyage API key missing');
      const inputs = await this.collectInputs();
      const store = this.getLocalStore();
      await store.load();
      return runLocalSync(inputs, store, this.getVoyage());
    }
    if (validateUri(this.settings.uri) !== 'valid') throw new Error('Atlas connection not configured');
    const inputs = await this.collectInputs();
    const collection = await this.getAtlas().getCollection();
    return runSync(inputs, collection);
  }

  private async runSyncCommand(): Promise<void> {
    new Notice('Vault Vector: syncing…');
    try {
      if (this.autoSync) {
        await this.autoSync.flushNow();
        const s = this.autoSync.getStatus();
        if (s.kind === 'error') throw new Error(s.message);
      } else {
        await this.runSyncPipeline();
      }
      new Notice('Vault Vector: sync complete.');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector sync failed', err);
      new Notice(`Vault Vector sync failed: ${detail}`);
    }
  }

  private buildAutoSyncDeps() {
    return {
      subscribeVaultEvents: (onEvent: (e: AutoSyncEvent) => void) => {
        const refs = [
          this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.path.endsWith('.md')) onEvent({ kind: 'create', path: file.path });
          }),
          this.app.vault.on('modify', (file) => {
            if (file instanceof TFile && file.path.endsWith('.md')) onEvent({ kind: 'modify', path: file.path });
          }),
          this.app.vault.on('delete', (file) => {
            if (file.path.endsWith('.md')) onEvent({ kind: 'delete', path: file.path });
          }),
          this.app.vault.on('rename', (file, oldPath) => {
            if ((file instanceof TFile && file.path.endsWith('.md')) || oldPath.endsWith('.md')) {
              onEvent({ kind: 'rename', oldPath, newPath: file.path });
            }
          }),
        ];
        for (const ref of refs) this.registerEvent(ref);
        return () => { for (const ref of refs) this.app.vault.offref(ref); };
      },
      runFullSync: () => this.runSyncPipeline(),
      renameLocal: (oldPath: string, newPath: string) => {
        if (!this.localStore) return false;
        return this.localStore.renameEntry(oldPath, newPath);
      },
      isAutoSyncEnabled: () => this.settings.autoSyncEnabled,
      isLocalProvider: () => this.settings.embeddingProvider === 'voyage-local',
      now: () => Date.now(),
      setTimer: (cb: () => void, ms: number) => window.setTimeout(cb, ms),
      clearTimer: (id: number) => window.clearTimeout(id),
      setInterval: (cb: () => void, ms: number) => window.setInterval(cb, ms),
      clearInterval: (id: number) => window.clearInterval(id),
      updateStatus: (s: AutoSyncStatus) => this.renderStatus(s),
      notice: (m: string) => { new Notice(m); },
      logError: (label: string, err: unknown) => { console.error(label, err); },
    };
  }

  private async openSearchModal(): Promise<void> {
    const onPick = (path: string) => this.app.workspace.openLinkText(path, '', false);

    if (this.settings.rerankEnabled && !this.settings.voyageApiKey.trim()) {
      new Notice('Reranking is enabled but Voyage API key is missing. Configure it in Settings.');
      return;
    }

    const rerankCfg: RerankConfig | undefined = this.settings.rerankEnabled
      ? {
          reranker: this.getReranker(),
          instruction: this.settings.rerankInstruction,
          candidateCap: this.settings.rerankCandidateCap,
          docCharLimit: this.settings.rerankDocCharLimit,
        }
      : undefined;

    const debug: DebugLogger | undefined = this.settings.debugMode
      ? (label, ms) => console.log(`[Vault Vector] ${label}: ${ms.toFixed(1)}ms`)
      : undefined;

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
      const limit = this.settings.resultLimit;
      const search: SearchFn = rerankCfg
        ? async (query) => {
            try {
              return await executeLocalSearch(voyage, store, query, limit, rerankCfg, debug);
            } catch (err) {
              console.error('Vault Vector rerank failed', err);
              new Notice('Rerank failed, showing vector results.');
              return executeLocalSearch(voyage, store, query, limit, undefined, debug);
            }
          }
        : (query) => executeLocalSearch(voyage, store, query, limit, undefined, debug);
      new VaultVectorSearchModal(this.app, search, onPick).open();
      return;
    }

    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }

    try {
      const collection = await this.getAtlas().getCollection();
      const limit = this.settings.resultLimit;
      const indexName = this.settings.indexName;
      const search: SearchFn = rerankCfg
        ? async (query) => {
            try {
              return await executeSearch(
                collection,
                { index: indexName, query, limit },
                rerankCfg,
                debug,
              );
            } catch (err) {
              console.error('Vault Vector rerank failed', err);
              new Notice('Rerank failed, showing vector results.');
              return executeSearch(collection, { index: indexName, query, limit }, undefined, debug);
            }
          }
        : (query) => executeSearch(collection, { index: indexName, query, limit }, undefined, debug);
      new VaultVectorSearchModal(this.app, search, onPick).open();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector connect failed', err);
      new Notice(`Atlas connection failed: ${detail}`);
    }
  }
}

export type { SearchHit };
