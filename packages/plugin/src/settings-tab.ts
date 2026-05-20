import { App, PluginSettingTab, Setting } from 'obsidian';
import type { EmbeddingProvider, VaultVectorPluginForSettings } from '@vault-vector/core';

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
      .setDesc('Voyage direct calls Voyage AI and stores vectors locally (just needs an API key). Atlas auto-embed uses MongoDB to generate and search embeddings server-side (requires a configured Atlas cluster and vector index).')
      .addDropdown(drop =>
        drop
          .addOption('voyage-local', 'Voyage direct (local)')
          .addOption('atlas-auto', 'Atlas auto-embed')
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.embeddingProvider = value as EmbeddingProvider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.embeddingProvider === 'voyage-local') {
      containerEl.createEl('h3', { text: 'Voyage direct (local)' });

      new Setting(containerEl)
        .setName('Voyage API key')
        .setDesc('Your Voyage AI API key.')
        .addText(text => {
          text
            .setPlaceholder('pa-...')
            .setValue(this.plugin.settings.voyageApiKey)
            .onChange(async (value: string) => {
              this.plugin.settings.voyageApiKey = value.trim();
              await this.plugin.saveSettings();
              this.display();
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
    } else {
      containerEl.createEl('h3', { text: 'Atlas auto-embed' });

      new Setting(containerEl)
        .setName('Connection URI')
        .setDesc('MongoDB Atlas connection string (mongodb+srv://...).')
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
    }

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

    containerEl.createEl('h3', { text: 'Reranking' });

    new Setting(containerEl)
      .setName('Enable reranking')
      .setDesc('After initial retrieval, ask Voyage to reorder the top candidates. Applies to both providers. Requires a Voyage API key.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.rerankEnabled)
          .onChange(async (value: boolean) => {
            this.plugin.settings.rerankEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (
      this.plugin.settings.rerankEnabled &&
      this.plugin.settings.embeddingProvider === 'atlas-auto'
    ) {
      new Setting(containerEl)
        .setName('Voyage API key')
        .setDesc('Required for reranking, even when Atlas auto-embed is the provider.')
        .addText(text => {
          text
            .setPlaceholder('pa-...')
            .setValue(this.plugin.settings.voyageApiKey)
            .onChange(async (value: string) => {
              this.plugin.settings.voyageApiKey = value.trim();
              await this.plugin.saveSettings();
              this.display();
            });
          (text.inputEl as HTMLInputElement).type = 'password';
        });
    }

    if (this.plugin.settings.rerankEnabled && !this.plugin.settings.voyageApiKey.trim()) {
      const warn = containerEl.createEl('div', {
        text: 'Reranking requires a Voyage API key.',
      });
      warn.style.color = 'var(--text-error)';
      warn.style.marginBottom = '0.75em';
    }

    new Setting(containerEl)
      .setName('Rerank model')
      .setDesc('Voyage reranker model. Lite is faster; the full model is more accurate.')
      .addDropdown(drop =>
        drop
          .addOption('rerank-2.5-lite', 'rerank-2.5-lite')
          .addOption('rerank-2.5', 'rerank-2.5')
          .setValue(this.plugin.settings.rerankModel)
          .onChange(async (value: string) => {
            this.plugin.settings.rerankModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Rerank candidate cap')
      .setDesc('Maximum number of candidates sent to the reranker. Lower is faster; default 50.')
      .addText(text =>
        text.setValue(String(this.plugin.settings.rerankCandidateCap)).onChange(async (value: string) => {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            this.plugin.settings.rerankCandidateCap = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Rerank document char limit')
      .setDesc('Truncate each candidate to this many characters before reranking. 0 disables truncation. Lower is faster; rerankers are prefix-biased so quality usually holds.')
      .addText(text =>
        text.setValue(String(this.plugin.settings.rerankDocCharLimit)).onChange(async (value: string) => {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n) && n >= 0) {
            this.plugin.settings.rerankDocCharLimit = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Rerank instruction (optional)')
      .setDesc('Prepended to the query when reranking. Use it to steer the reranker, e.g. "Prefer notes that explain why over notes that list how." Adds latency; leave blank for faster reranking.')
      .addTextArea(text =>
        text
          .setPlaceholder('e.g. Prefer notes that explain why over notes that list how.')
          .setValue(this.plugin.settings.rerankInstruction)
          .onChange(async (value: string) => {
            this.plugin.settings.rerankInstruction = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Auto-sync' });

    new Setting(containerEl)
      .setName('Auto-sync on file changes')
      .setDesc('When on, Vault Vector reindexes notes shortly after you edit, create, rename, or delete them. When off, only the manual Vault Vector: Sync command updates the index.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value: boolean) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Debug' });

    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Log search and rerank timings to the Obsidian developer console (cmd-option-i).')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value: boolean) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
