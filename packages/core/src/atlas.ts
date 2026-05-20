export interface CollectionLike {
  replaceOne(
    filter: { _id: string },
    doc: Record<string, unknown>,
    opts?: { upsert?: boolean }
  ): Promise<unknown>;
  find(filter: Record<string, unknown>): {
    project(p: Record<string, 0 | 1>): {
      toArray(): Promise<Array<Record<string, unknown>>>;
    };
  };
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  aggregate(pipeline: unknown[]): {
    toArray(): Promise<Array<Record<string, unknown>>>;
  };
}

export interface MongoClientLike {
  db(name: string): { collection(name: string): CollectionLike };
  close(): Promise<void>;
}

export type Connector = (uri: string) => Promise<MongoClientLike>;

export interface AtlasFactory {
  getCollection(): Promise<CollectionLike>;
  close(): Promise<void>;
}

import type { VaultVectorSettings } from './settings-types';

export function createAtlasFactory(
  settings: VaultVectorSettings,
  connect: Connector
): AtlasFactory {
  let client: MongoClientLike | null = null;

  return {
    async getCollection(): Promise<CollectionLike> {
      if (!client) {
        client = await connect(settings.uri);
      }
      return client.db(settings.database).collection(settings.collection);
    },
    async close(): Promise<void> {
      if (client) {
        await client.close();
        client = null;
      }
    },
  };
}
