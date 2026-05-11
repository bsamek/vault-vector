import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateUri } from '../src/settings';

describe('validateUri', () => {
  it('reports missing for empty or whitespace-only strings', () => {
    expect(validateUri('')).toBe('missing');
    expect(validateUri('   ')).toBe('missing');
  });

  it('reports malformed for strings without a mongodb scheme', () => {
    expect(validateUri('https://example.com')).toBe('malformed');
    expect(validateUri('cluster0.foo.mongodb.net')).toBe('malformed');
  });

  it('reports valid for mongodb:// and mongodb+srv:// URIs', () => {
    expect(validateUri('mongodb://user:pass@host:27017/db')).toBe('valid');
    expect(validateUri('mongodb+srv://user:pass@cluster/db')).toBe('valid');
  });

  it('trims leading and trailing whitespace before validating', () => {
    expect(validateUri('  mongodb+srv://x/db  ')).toBe('valid');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('uses sensible defaults', () => {
    expect(DEFAULT_SETTINGS.database).toBe('vault-vector');
    expect(DEFAULT_SETTINGS.collection).toBe('notes');
    expect(DEFAULT_SETTINGS.indexName).toBe('vault_vector');
    expect(DEFAULT_SETTINGS.resultLimit).toBe(10);
    expect(DEFAULT_SETTINGS.uri).toBe('');
  });

  it('defaults to atlas-auto provider for backward compatibility', () => {
    expect(DEFAULT_SETTINGS.embeddingProvider).toBe('atlas-auto');
  });

  it('defaults voyage credentials to empty and model to voyage-4', () => {
    expect(DEFAULT_SETTINGS.voyageApiKey).toBe('');
    expect(DEFAULT_SETTINGS.voyageModel).toBe('voyage-4');
  });

  it('defaults reranking off, with rerank-2.5-lite and empty instruction', () => {
    expect(DEFAULT_SETTINGS.rerankEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.rerankModel).toBe('rerank-2.5-lite');
    expect(DEFAULT_SETTINGS.rerankInstruction).toBe('');
  });

  it('defaults debug mode off', () => {
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });
});
