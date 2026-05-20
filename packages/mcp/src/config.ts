import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_SETTINGS, type VaultVectorSettings } from '@vault-vector/core';

export interface LoadConfigResult {
  settings: VaultVectorSettings;
  pluginDir: string;
  embeddingsPath: string;
}

export async function loadConfig(opts: {
  vaultPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LoadConfigResult> {
  const { vaultPath, env = {} } = opts;

  // Validate vault path exists
  try {
    await fs.access(vaultPath);
  } catch {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  // Validate .obsidian directory
  const obsidianDir = path.join(vaultPath, '.obsidian');
  try {
    await fs.access(obsidianDir);
  } catch {
    throw new Error(`Not a valid Obsidian vault (missing .obsidian directory): ${vaultPath}`);
  }

  const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'vault-vector');
  const embeddingsPath = path.join(pluginDir, 'embeddings.json');
  const dataJsonPath = path.join(pluginDir, 'data.json');

  let fileSettings: Partial<VaultVectorSettings> = {};
  let raw: string | null = null;
  try {
    raw = await fs.readFile(dataJsonPath, 'utf8');
  } catch {
    process.stderr.write(
      `vault-vector-mcp: warning: ${dataJsonPath} not found, using defaults\n`
    );
  }
  if (raw !== null) {
    try {
      fileSettings = JSON.parse(raw) as Partial<VaultVectorSettings>;
    } catch (err) {
      throw new Error(`Failed to parse ${dataJsonPath}: ${(err as Error).message}`);
    }
  }

  // Merge: defaults < file < env overrides
  const settings: VaultVectorSettings = { ...DEFAULT_SETTINGS, ...fileSettings };

  if (env.VOYAGE_API_KEY) {
    settings.voyageApiKey = env.VOYAGE_API_KEY;
  }
  if (env.VAULT_VECTOR_MODEL) {
    settings.voyageModel = env.VAULT_VECTOR_MODEL;
  }

  return { settings, pluginDir, embeddingsPath };
}
