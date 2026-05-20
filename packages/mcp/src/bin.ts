#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { NodeFileAdapter } from './node-file-adapter.js';

async function main() {
  // Parse --vault <path> from argv
  let vaultPath: string | undefined;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vault' && i + 1 < args.length) {
      vaultPath = args[i + 1];
      i++;
    }
  }

  // Also check env
  if (!vaultPath) {
    vaultPath = process.env.VAULT_VECTOR_VAULT;
  }

  if (!vaultPath) {
    process.stderr.write('vault-vector-mcp: error: --vault <path> is required\n');
    process.exit(1);
  }

  const config = await loadConfig({ vaultPath, env: process.env });
  const fileAdapter = new NodeFileAdapter();
  const { server } = buildServer({ ...config, fileAdapter });

  const transport = new StdioServerTransport();

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`vault-vector-mcp: fatal: ${String(err)}\n`);
  process.exit(1);
});
