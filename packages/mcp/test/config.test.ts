import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from '../src/config';
import { DEFAULT_SETTINGS } from '@vault-vector/core';

async function makeVault(tmpDir: string, dataJson?: Record<string, unknown>): Promise<string> {
  const pluginDir = path.join(tmpDir, '.obsidian', 'plugins', 'vault-vector');
  await fs.mkdir(pluginDir, { recursive: true });
  if (dataJson !== undefined) {
    await fs.writeFile(path.join(pluginDir, 'data.json'), JSON.stringify(dataJson));
  }
  return tmpDir;
}

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-vector-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('merges partial data.json over DEFAULT_SETTINGS', async () => {
    const vaultPath = await makeVault(tmpDir, { voyageApiKey: 'key123', resultLimit: 5 });
    const cfg = await loadConfig({ vaultPath });
    expect(cfg.settings.voyageApiKey).toBe('key123');
    expect(cfg.settings.resultLimit).toBe(5);
    // Other defaults are preserved
    expect(cfg.settings.voyageModel).toBe(DEFAULT_SETTINGS.voyageModel);
  });

  it('returns pluginDir and embeddingsPath', async () => {
    const vaultPath = await makeVault(tmpDir, {});
    const cfg = await loadConfig({ vaultPath });
    expect(cfg.pluginDir).toBe(path.join(vaultPath, '.obsidian', 'plugins', 'vault-vector'));
    expect(cfg.embeddingsPath).toBe(
      path.join(vaultPath, '.obsidian', 'plugins', 'vault-vector', 'embeddings.json')
    );
  });

  it('env VOYAGE_API_KEY overrides settings', async () => {
    const vaultPath = await makeVault(tmpDir, { voyageApiKey: 'fromfile' });
    const cfg = await loadConfig({ vaultPath, env: { VOYAGE_API_KEY: 'fromenv' } });
    expect(cfg.settings.voyageApiKey).toBe('fromenv');
  });

  it('env VAULT_VECTOR_MODEL overrides voyageModel', async () => {
    const vaultPath = await makeVault(tmpDir, {});
    const cfg = await loadConfig({ vaultPath, env: { VAULT_VECTOR_MODEL: 'voyage-3-turbo' } });
    expect(cfg.settings.voyageModel).toBe('voyage-3-turbo');
  });

  it('missing data.json uses defaults (no throw)', async () => {
    const vaultPath = await makeVault(tmpDir); // no data.json
    const cfg = await loadConfig({ vaultPath });
    expect(cfg.settings.resultLimit).toBe(DEFAULT_SETTINGS.resultLimit);
  });

  it('throws if vaultPath does not exist', async () => {
    await expect(loadConfig({ vaultPath: '/nonexistent/path/123' })).rejects.toThrow();
  });

  it('throws if .obsidian directory is missing', async () => {
    // tmpDir exists but has no .obsidian
    await expect(loadConfig({ vaultPath: tmpDir })).rejects.toThrow(/\.obsidian/);
  });
});
