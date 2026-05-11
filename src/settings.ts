export interface VaultVectorSettings {
  uri: string;
  database: string;
  collection: string;
  indexName: string;
  resultLimit: number;
}

export const DEFAULT_SETTINGS: VaultVectorSettings = {
  uri: '',
  database: 'vault-vector',
  collection: 'notes',
  indexName: 'vault_vector',
  resultLimit: 10,
};

export type UriValidation = 'missing' | 'malformed' | 'valid';

export function validateUri(uri: string): UriValidation {
  const trimmed = uri.trim();
  if (trimmed === '') return 'missing';
  if (!/^mongodb(\+srv)?:\/\//.test(trimmed)) return 'malformed';
  return 'valid';
}

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultVectorPlugin from './main';

interface VaultVectorPluginForSettings {
  settings: VaultVectorSettings;
  saveSettings(): Promise<void>;
}

export class VaultVectorSettingTab extends PluginSettingTab {
  plugin: VaultVectorPluginForSettings;

  constructor(app: App, plugin: VaultVectorPluginForSettings) {
    super(app, plugin as any);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Connection URI')
      .setDesc('MongoDB Atlas connection string (mongodb+srv://...)')
      .addText(text =>
        text
          .setPlaceholder('mongodb+srv://user:pass@cluster/...')
          .setValue(this.plugin.settings.uri)
          .onChange(async (value: string) => {
            this.plugin.settings.uri = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Database')
      .setDesc('Atlas database name')
      .addText(text =>
        text.setValue(this.plugin.settings.database).onChange(async (value: string) => {
          this.plugin.settings.database = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Collection')
      .setDesc('Atlas collection name')
      .addText(text =>
        text.setValue(this.plugin.settings.collection).onChange(async (value: string) => {
          this.plugin.settings.collection = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Index name')
      .setDesc('Vector Search index name (must match Atlas)')
      .addText(text =>
        text.setValue(this.plugin.settings.indexName).onChange(async (value: string) => {
          this.plugin.settings.indexName = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Result limit')
      .setDesc('Number of search results to return')
      .addText(text =>
        text.setValue(String(this.plugin.settings.resultLimit)).onChange(async (value: string) => {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            this.plugin.settings.resultLimit = n;
            await this.plugin.saveSettings();
          }
        })
      );
  }
}
