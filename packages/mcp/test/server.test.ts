import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildServer } from '../src/server';
import { DEFAULT_SETTINGS, createLocalStore } from '@vault-vector/core';
import { NodeFileAdapter } from '../src/node-file-adapter';
import type { VaultVectorSettings } from '@vault-vector/core';

// Helper: build a minimal embeddings.json for a set of entries
function makeEmbeddingsJson(
  model: string,
  entries: Record<string, { mtime: number; embedding: number[]; content: string }>
): string {
  return JSON.stringify({ version: 1, model, entries });
}

// Stub voyage client that returns a fixed embedding
function makeVoyageStub(embedding: number[]) {
  return {
    embed: vi.fn().mockResolvedValue([embedding]),
  };
}

// 2D unit vectors for testing cosine similarity
const VEC_A = [1, 0]; // points to entry-a
const VEC_B = [0, 1]; // points to entry-b
const VEC_C = [0.6, 0.8]; // between A and B, closer to B

describe('buildServer – voyage-local path', () => {
  let tmpDir: string;
  let embeddingsPath: string;
  let settings: VaultVectorSettings;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-vector-server-test-'));
    embeddingsPath = path.join(tmpDir, 'embeddings.json');

    settings = {
      ...DEFAULT_SETTINGS,
      embeddingProvider: 'voyage-local',
      voyageApiKey: 'test-key',
      voyageModel: 'voyage-4',
      resultLimit: 5,
      rerankEnabled: false,
    };

    // Write initial embeddings file with two entries
    const data = makeEmbeddingsJson('voyage-4', {
      'note-a.md': { mtime: 1000, embedding: VEC_A, content: 'Content of note A' },
      'note-b.md': { mtime: 1000, embedding: VEC_B, content: 'Content of note B' },
    });
    await fs.writeFile(embeddingsPath, data);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns hits sorted by score (top hit for VEC_A query is note-a)', async () => {
    // Query embedding aligns with VEC_A, so note-a should be top hit
    const voyageStub = makeVoyageStub(VEC_A);
    const fileAdapter = new NodeFileAdapter();

    const { server, callTool } = buildServer({
      settings,
      embeddingsPath,
      fileAdapter,
      voyageFactory: () => voyageStub,
    });

    const result = await callTool({ query: 'find note A' });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // First content block should mention note-a.md
    expect(result.content[0].text).toContain('note-a.md');
  });

  it('limit arg overrides settings.resultLimit', async () => {
    const voyageStub = makeVoyageStub(VEC_A);
    const fileAdapter = new NodeFileAdapter();

    const { callTool } = buildServer({
      settings: { ...settings, resultLimit: 10 },
      embeddingsPath,
      fileAdapter,
      voyageFactory: () => voyageStub,
    });

    // Only 2 entries exist, limit: 1 should return 1
    const result = await callTool({ query: 'test', limit: 1 });
    expect(result.content.length).toBe(1);
  });

  it('mtime reload: detects updated embeddings and returns new entry', async () => {
    const voyageStub = makeVoyageStub(VEC_C); // VEC_C is closer to VEC_B
    const fileAdapter = new NodeFileAdapter();

    const { callTool } = buildServer({
      settings,
      embeddingsPath,
      fileAdapter,
      voyageFactory: () => voyageStub,
    });

    // First call – note-b should be top (VEC_C closer to VEC_B)
    const result1 = await callTool({ query: 'test' });
    expect(result1.content[0].text).toContain('note-b.md');

    // Wait a tick then write a new embeddings file with an additional entry note-c
    // that aligns perfectly with VEC_C
    await new Promise(r => setTimeout(r, 10));
    const newData = makeEmbeddingsJson('voyage-4', {
      'note-a.md': { mtime: 1000, embedding: VEC_A, content: 'Content of note A' },
      'note-b.md': { mtime: 1000, embedding: VEC_B, content: 'Content of note B' },
      'note-c.md': { mtime: 1000, embedding: VEC_C, content: 'Content of note C – exact match' },
    });
    // Touch the file (update mtime)
    await fs.writeFile(embeddingsPath, newData);

    // Second call should reload and return note-c as top hit
    const result2 = await callTool({ query: 'test' });
    expect(result2.content[0].text).toContain('note-c.md');
  });

  it('structuredContent contains raw hit array', async () => {
    const voyageStub = makeVoyageStub(VEC_A);
    const fileAdapter = new NodeFileAdapter();

    const { callTool } = buildServer({
      settings,
      embeddingsPath,
      fileAdapter,
      voyageFactory: () => voyageStub,
    });

    const result = await callTool({ query: 'test' });
    expect(result.structuredContent).toBeDefined();
    expect(Array.isArray(result.structuredContent.hits)).toBe(true);
    expect(result.structuredContent.hits[0]).toHaveProperty('path');
    expect(result.structuredContent.hits[0]).toHaveProperty('score');
    expect(result.structuredContent.hits[0]).toHaveProperty('snippet');
  });
});

describe('buildServer – atlas-auto path', () => {
  let tmpDir: string;
  let embeddingsPath: string;
  let settings: VaultVectorSettings;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-vector-server-atlas-test-'));
    embeddingsPath = path.join(tmpDir, 'embeddings.json');
    settings = {
      ...DEFAULT_SETTINGS,
      embeddingProvider: 'atlas-auto',
      voyageApiKey: 'test-key',
      uri: 'mongodb://localhost:27017',
      database: 'test-db',
      collection: 'test-notes',
      indexName: 'vault_vector',
      resultLimit: 5,
      rerankEnabled: false,
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('atlas path: returns hits from fake collection aggregate', async () => {
    const cannedDocs = [
      { path: 'atlas-note-1.md', content: 'Atlas content one', score: 0.95 },
      { path: 'atlas-note-2.md', content: 'Atlas content two', score: 0.80 },
    ];

    const fakeCollection = {
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(cannedDocs),
      }),
    };

    const fakeMongoClient = {
      db: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue(fakeCollection),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const voyageStub = makeVoyageStub([0.1, 0.9]);
    const fileAdapter = new NodeFileAdapter();

    const { callTool } = buildServer({
      settings,
      embeddingsPath,
      fileAdapter,
      voyageFactory: () => voyageStub,
      atlasFactory: () => fakeMongoClient as never,
    });

    const result = await callTool({ query: 'atlas search' });

    expect(result.content.length).toBe(2);
    expect(result.content[0].text).toContain('atlas-note-1.md');
    expect(result.content[1].text).toContain('atlas-note-2.md');
  });
});
