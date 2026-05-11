import { MongoClient } from 'mongodb';
import { Notice, Plugin } from 'obsidian';
import {
  type AtlasFactory,
  type Connector,
  createAtlasFactory,
  type MongoClientLike,
} from './atlas';
import {
  DEFAULT_SETTINGS,
  validateUri,
  type VaultVectorSettings,
  VaultVectorSettingTab,
} from './settings';
import { type NoteInput, runSync } from './sync';
import { VaultVectorSearchModal } from './search';

const realConnector: Connector = async (uri) => {
  const client = new MongoClient(uri);
  await client.connect();
  return client as unknown as MongoClientLike;
};

export default class VaultVectorPlugin extends Plugin {
  settings: VaultVectorSettings = DEFAULT_SETTINGS;
  private atlas: AtlasFactory | null = null;

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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
  }

  private getAtlas(): AtlasFactory {
    if (!this.atlas) {
      this.atlas = createAtlasFactory(this.settings, realConnector);
    }
    return this.atlas;
  }

  private async runSyncCommand(): Promise<void> {
    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }
    new Notice('Vault Vector: starting sync…');

    try {
      const files = this.app.vault.getMarkdownFiles();
      const inputs: NoteInput[] = [];
      for (const file of files) {
        const content = await this.app.vault.cachedRead(file);
        inputs.push({ path: file.path, content, mtime: file.stat.mtime });
      }
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
    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }

    try {
      const collection = await this.getAtlas().getCollection();
      new VaultVectorSearchModal(
        this.app,
        this.settings,
        collection,
        (path) => this.app.workspace.openLinkText(path, '', false)
      ).open();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector connect failed', err);
      new Notice(`Atlas connection failed: ${detail}`);
    }
  }
}
