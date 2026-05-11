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
