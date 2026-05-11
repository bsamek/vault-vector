import { describe, expect, it, vi } from 'vitest';
import { createAtlasFactory, type Connector, type MongoClientLike } from '../src/atlas';
import { FakeCollection } from './fakes/collection';
import { DEFAULT_SETTINGS } from '../src/settings';

function makeFakeClient() {
  const fake = new FakeCollection();
  const close = vi.fn(async () => {});
  const client: MongoClientLike = {
    db: (_n) => ({ collection: (_c) => fake }),
    close,
  };
  return { client, close, collection: fake };
}

describe('createAtlasFactory', () => {
  it('lazily connects only on first getCollection call', async () => {
    const connect = vi.fn().mockImplementation(async () => makeFakeClient().client);
    const factory = createAtlasFactory({ ...DEFAULT_SETTINGS, uri: 'mongodb+srv://x/db' }, connect as unknown as Connector);

    expect(connect).not.toHaveBeenCalled();

    await factory.getCollection();
    await factory.getCollection();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('passes the configured database and collection names', async () => {
    const dbSpy = vi.fn();
    const collSpy = vi.fn();
    const connect: Connector = async () => ({
      db: (name) => {
        dbSpy(name);
        return { collection: (n) => { collSpy(n); return new FakeCollection(); } };
      },
      close: async () => {},
    });

    const factory = createAtlasFactory(
      { ...DEFAULT_SETTINGS, uri: 'mongodb+srv://x', database: 'mydb', collection: 'mycoll' },
      connect
    );
    await factory.getCollection();

    expect(dbSpy).toHaveBeenCalledWith('mydb');
    expect(collSpy).toHaveBeenCalledWith('mycoll');
  });

  it('close() releases the client and the next getCollection reconnects', async () => {
    const close = vi.fn(async () => {});
    const connect = vi.fn().mockImplementation(async () => ({
      db: () => ({ collection: () => new FakeCollection() }),
      close,
    }));

    const factory = createAtlasFactory({ ...DEFAULT_SETTINGS, uri: 'mongodb+srv://x' }, connect as unknown as Connector);

    await factory.getCollection();
    await factory.close();
    await factory.getCollection();

    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('close() with no active client is a no-op', async () => {
    const connect = vi.fn().mockImplementation(async () => ({
      db: () => ({ collection: () => new FakeCollection() }),
      close: async () => {},
    }));
    const factory = createAtlasFactory({ ...DEFAULT_SETTINGS, uri: 'mongodb+srv://x' }, connect as unknown as Connector);

    await factory.close();

    expect(connect).not.toHaveBeenCalled();
  });
});
