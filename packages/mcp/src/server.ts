import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createLocalStore,
  createVoyageClient,
  createVoyageReranker,
  executeLocalSearch,
  executeSearch,
  type VaultVectorSettings,
  type FileAdapter,
  type VoyageClient,
  type LocalStore,
  type RerankConfig,
} from '@vault-vector/core';
import { MongoClient } from 'mongodb';

export interface ServerDeps {
  settings: VaultVectorSettings;
  embeddingsPath: string;
  fileAdapter: FileAdapter;
  /** Factory for Voyage client – injected in tests to avoid real HTTP */
  voyageFactory?: (opts: { apiKey: string; model: string }) => VoyageClient;
  /** Factory for MongoClient – injected in tests */
  atlasFactory?: (uri: string) => MongoClient;
}

export interface BuildServerResult {
  server: McpServer;
  /** Direct handler for tests: call the search tool without a transport */
  callTool: (args: { query: string; limit?: number; rerank?: boolean }) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: { hits: Array<{ path: string; score: number; snippet: string }> };
  }>;
}

export function buildServer(deps: ServerDeps): BuildServerResult {
  const { settings, embeddingsPath, fileAdapter } = deps;
  const voyageFactory = deps.voyageFactory ?? createVoyageClient;
  const atlasFactory = deps.atlasFactory ?? ((uri: string) => new MongoClient(uri));

  // Lazy caches
  let voyageClient: VoyageClient | null = null;
  let localStore: LocalStore | null = null;
  let lastMtime: number | null = null;

  let mongoClient: MongoClient | null = null;

  const server = new McpServer({ name: 'vault-vector', version: '0.1.0' });

  async function handleSearch(args: { query: string; limit?: number; rerank?: boolean }) {
    const limit = args.limit ?? settings.resultLimit;
    const doRerank = args.rerank ?? settings.rerankEnabled;

    let rerankCfg: RerankConfig | undefined;
    if (doRerank && settings.voyageApiKey) {
      rerankCfg = {
        reranker: createVoyageReranker({
          apiKey: settings.voyageApiKey,
          model: settings.rerankModel,
        }),
        instruction: settings.rerankInstruction,
        candidateCap: settings.rerankCandidateCap,
        docCharLimit: settings.rerankDocCharLimit,
      };
    }

    let hits;

    if (settings.embeddingProvider === 'voyage-local') {
      // Lazy init voyage client
      if (!voyageClient) {
        voyageClient = voyageFactory({ apiKey: settings.voyageApiKey, model: settings.voyageModel });
      }

      // Lazy init local store
      if (!localStore) {
        localStore = createLocalStore({
          adapter: fileAdapter,
          path: embeddingsPath,
          model: settings.voyageModel,
        });
        await localStore.load();
        try {
          const stat = await fs.stat(embeddingsPath);
          lastMtime = stat.mtimeMs;
        } catch {
          lastMtime = null;
        }
      } else {
        // Check mtime for hot-reload
        try {
          const stat = await fs.stat(embeddingsPath);
          if (lastMtime === null || stat.mtimeMs !== lastMtime) {
            await localStore.load();
            lastMtime = stat.mtimeMs;
          }
        } catch {
          // File gone – skip reload
        }
      }

      hits = await executeLocalSearch(
        voyageClient,
        localStore,
        args.query,
        limit,
        rerankCfg,
      );
    } else {
      // atlas-auto
      if (!mongoClient) {
        mongoClient = atlasFactory(settings.uri);
      }
      const collection = mongoClient.db(settings.database).collection(settings.collection);

      hits = await executeSearch(
        collection as never,
        { index: settings.indexName, query: args.query, limit },
        rerankCfg,
      );
    }

    const content = hits.map(h => ({
      type: 'text' as const,
      text: `${h.path} (score: ${h.score.toFixed(3)})\n${h.snippet}`,
    }));

    const structuredContent = {
      hits: hits.map(h => ({ path: h.path, score: h.score, snippet: h.snippet })),
    };

    return { content, structuredContent };
  }

  // Register the MCP tool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(
    'search',
    'Search the vault using semantic similarity',
    {
      query: z.string(),
      limit: z.number().optional(),
      rerank: z.boolean().optional(),
    },
    async (args: { query: string; limit?: number; rerank?: boolean }) => {
      const result = await handleSearch(args);
      return {
        content: result.content,
        structuredContent: result.structuredContent as Record<string, unknown>,
      };
    }
  );

  return { server, callTool: handleSearch };
}
