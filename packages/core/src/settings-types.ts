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
  rerankCandidateCap: number;
  rerankDocCharLimit: number;
  debugMode: boolean;
  autoSyncEnabled: boolean;
}

export const DEFAULT_SETTINGS: VaultVectorSettings = {
  uri: '',
  database: 'vault-vector',
  collection: 'notes',
  indexName: 'vault_vector',
  resultLimit: 10,
  embeddingProvider: 'voyage-local',
  voyageApiKey: '',
  voyageModel: 'voyage-4',
  rerankEnabled: false,
  rerankModel: 'rerank-2.5-lite',
  rerankInstruction: '',
  rerankCandidateCap: 50,
  rerankDocCharLimit: 0,
  debugMode: false,
  autoSyncEnabled: true,
};

export type UriValidation = 'missing' | 'malformed' | 'valid';

export function validateUri(uri: string): UriValidation {
  const trimmed = uri.trim();
  if (trimmed === '') return 'missing';
  if (!/^mongodb(\+srv)?:\/\//.test(trimmed)) return 'malformed';
  return 'valid';
}

export interface VaultVectorPluginForSettings {
  settings: VaultVectorSettings;
  saveSettings(): Promise<void>;
}
