import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createAtlasFactory,
  createLocalStore,
  createVoyageClient,
  createVoyageReranker,
  executeLocalSearch,
  executeSearch,
  type AtlasFactory,
  type Connector,
  type FileAdapter,
  type LocalStore,
  type MongoClientLike,
  type RerankConfig,
  type VaultVectorSettings,
  type VoyageClient,
  type VoyageReranker,
} from '@vault-vector/core';
import { MongoClient } from 'mongodb';

const realConnector: Connector = async (uri) => {
  const client = new MongoClient(uri);
  await client.connect();
  return client as unknown as MongoClientLike;
};

export interface ServerDeps {
  settings: VaultVectorSettings;
  embeddingsPath: string;
  fileAdapter: FileAdapter;
  /** Factory for Voyage client – injected in tests to avoid real HTTP */
  voyageFactory?: (opts: { apiKey: string; model: string }) => VoyageClient;
  /** Mongo connector – injected in tests */
  connector?: Connector;
}

export interface BuildServerResult {
  server: McpServer;
  /** Direct handler for tests: call the search tool without a transport */
  callTool: (args: { query: string; limit?: number; rerank?: boolean }) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: { hits: Array<{ path: string; score: number; snippet: string }> };
  }>;
  /** Close any background resources (Mongo client, server). */
  close: () => Promise<void>;
}

export function buildServer(deps: ServerDeps): BuildServerResult {
  const { settings, embeddingsPath, fileAdapter } = deps;
  const voyageFactory = deps.voyageFactory ?? createVoyageClient;
  const connector = deps.connector ?? realConnector;

  let voyageClient: VoyageClient | null = null;
  let reranker: VoyageReranker | null = null;
  let localStore: LocalStore | null = null;
  let lastMtime: number | null = null;
  let atlas: AtlasFactory | null = null;

  const server = new McpServer({ name: 'vault-vector', version: '0.1.0' });

  function getRerankConfig(doRerank: boolean): RerankConfig | undefined {
    if (!doRerank || !settings.voyageApiKey) return undefined;
    if (!reranker) {
      reranker = createVoyageReranker({
        apiKey: settings.voyageApiKey,
        model: settings.rerankModel,
      });
    }
    return {
      reranker,
      instruction: settings.rerankInstruction,
      candidateCap: settings.rerankCandidateCap,
      docCharLimit: settings.rerankDocCharLimit,
    };
  }

  async function getLocalStore(): Promise<LocalStore> {
    if (!localStore) {
      localStore = createLocalStore({
        adapter: fileAdapter,
        path: embeddingsPath,
        model: settings.voyageModel,
      });
      await localStore.load();
      const stat = await fs.stat(embeddingsPath).catch(() => null);
      lastMtime = stat?.mtimeMs ?? null;
      return localStore;
    }
    const stat = await fs.stat(embeddingsPath).catch(() => null);
    if (stat && stat.mtimeMs !== lastMtime) {
      await localStore.load();
      lastMtime = stat.mtimeMs;
    }
    return localStore;
  }

  async function handleSearch(args: { query: string; limit?: number; rerank?: boolean }) {
    const limit = args.limit ?? settings.resultLimit;
    const doRerank = args.rerank ?? settings.rerankEnabled;
    const rerankCfg = getRerankConfig(doRerank);

    let hits;

    if (settings.embeddingProvider === 'voyage-local') {
      if (!voyageClient) {
        voyageClient = voyageFactory({ apiKey: settings.voyageApiKey, model: settings.voyageModel });
      }
      const store = await getLocalStore();
      hits = await executeLocalSearch(voyageClient, store, args.query, limit, rerankCfg);
    } else {
      if (!atlas) {
        atlas = createAtlasFactory(settings, connector);
      }
      const collection = await atlas.getCollection();
      hits = await executeSearch(
        collection,
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

  async function close(): Promise<void> {
    if (atlas) {
      await atlas.close();
      atlas = null;
    }
    await server.close();
  }

  return { server, callTool: handleSearch, close };
}
