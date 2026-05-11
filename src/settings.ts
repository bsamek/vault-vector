import { App, PluginSettingTab, Setting } from 'obsidian';

export type EmbeddingProvider = 'atlas-auto' | 'voyage-local';

export interface VaultVectorSettings {
  uri: string;
  database: string;
  collection: string;
  indexName: string;
  resultLimit: number;
  embeddingProvider: EmbeddingProvider;
  voyageApiKey: string;
  voyageModel: string;
  rerankEnabled: boolean;
  rerankModel: string;
  rerankInstruction: string;
}

export const DEFAULT_SETTINGS: VaultVectorSettings = {
  uri: '',
  database: 'vault-vector',
  collection: 'notes',
  indexName: 'vault_vector',
  resultLimit: 10,
  embeddingProvider: 'atlas-auto',
  voyageApiKey: '',
  voyageModel: 'voyage-4',
  rerankEnabled: false,
  rerankModel: 'rerank-2.5-lite',
  rerankInstruction: '',
};

export type UriValidation = 'missing' | 'malformed' | 'valid';

export function validateUri(uri: string): UriValidation {
  const trimmed = uri.trim();
  if (trimmed === '') return 'missing';
  if (!/^mongodb(\+srv)?:\/\//.test(trimmed)) return 'malformed';
  return 'valid';
}

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
      .setName('Embedding provider')
      .setDesc('Atlas auto-embed uses MongoDB to generate and search embeddings server-side. Voyage direct calls Voyage AI and stores vectors locally.')
      .addDropdown(drop =>
        drop
          .addOption('atlas-auto', 'Atlas auto-embed')
          .addOption('voyage-local', 'Voyage direct (local)')
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.embeddingProvider = value as EmbeddingProvider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName('Connection URI')
      .setDesc('MongoDB Atlas connection string (mongodb+srv://...). Used only in Atlas auto-embed mode.')
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
      .setName('Voyage API key')
      .setDesc('Voyage AI API key. Used only in Voyage direct mode.')
      .addText(text => {
        text
          .setPlaceholder('pa-...')
          .setValue(this.plugin.settings.voyageApiKey)
          .onChange(async (value: string) => {
            this.plugin.settings.voyageApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        (text.inputEl as HTMLInputElement).type = 'password';
      });

    new Setting(containerEl)
      .setName('Voyage model')
      .setDesc('Voyage embedding model. Changing this invalidates the local cache on next sync.')
      .addText(text =>
        text.setValue(this.plugin.settings.voyageModel).onChange(async (value: string) => {
          this.plugin.settings.voyageModel = value.trim();
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
