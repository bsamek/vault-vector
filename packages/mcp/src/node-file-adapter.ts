import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileAdapter } from '@vault-vector/core';

export class NodeFileAdapter implements FileAdapter {
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async read(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  async write(filePath: string, data: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data, 'utf8');
  }
}
