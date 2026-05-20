import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NodeFileAdapter } from '../src/node-file-adapter';

describe('NodeFileAdapter', () => {
  let tmpDir: string;
  let adapter: NodeFileAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-vector-test-'));
    adapter = new NodeFileAdapter();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exists() returns false before write', async () => {
    const filePath = path.join(tmpDir, 'missing.txt');
    expect(await adapter.exists(filePath)).toBe(false);
  });

  it('write + read round-trip', async () => {
    const filePath = path.join(tmpDir, 'data.json');
    const content = JSON.stringify({ hello: 'world' });
    await adapter.write(filePath, content);
    const read = await adapter.read(filePath);
    expect(read).toBe(content);
  });

  it('exists() returns true after write', async () => {
    const filePath = path.join(tmpDir, 'data.json');
    await adapter.write(filePath, '{}');
    expect(await adapter.exists(filePath)).toBe(true);
  });

  it('read of missing file rejects', async () => {
    const filePath = path.join(tmpDir, 'nope.json');
    await expect(adapter.read(filePath)).rejects.toThrow();
  });

  it('write creates intermediate directories', async () => {
    const filePath = path.join(tmpDir, 'a', 'b', 'c.txt');
    await adapter.write(filePath, 'nested');
    const read = await adapter.read(filePath);
    expect(read).toBe('nested');
  });
});
