import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoyageClient } from '../src/voyage';

type FetchInput = { url: string; init: RequestInit };

function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchInput[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const i = init ?? {};
    calls.push({ url: u, init: i });
    return responder(u, i);
  });
  (globalThis as any).fetch = fn;
  return { calls, fn };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe('createVoyageClient', () => {
  it('sends a single batch with the correct request shape', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
      })
    );

    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4' });
    const out = await client.embed(['hello', 'world'], 'document');

    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      input: ['hello', 'world'],
      model: 'voyage-4',
      input_type: 'document',
    });
  });

  it('splits inputs into multiple batches and preserves order', async () => {
    const { calls } = mockFetch((_url, init) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      return jsonResponse({
        data: body.input.map((t, i) => ({ index: i, embedding: [t.length] })),
      });
    });

    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4', batchSize: 2 });
    const out = await client.embed(['a', 'bb', 'ccc', 'dddd', 'eeeee'], 'document');

    expect(calls).toHaveLength(3);
    expect(out).toEqual([[1], [2], [3], [4], [5]]);
  });

  it('reorders results when Voyage returns them out of index order', async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          { index: 1, embedding: [9] },
          { index: 0, embedding: [1] },
        ],
      })
    );

    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4' });
    const out = await client.embed(['a', 'b'], 'document');
    expect(out).toEqual([[1], [9]]);
  });

  it('forwards input_type "query"', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ data: [{ index: 0, embedding: [0.5] }] })
    );

    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4' });
    await client.embed(['find me'], 'query');

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.input_type).toBe('query');
  });

  it('throws on non-2xx with status and body in the message', async () => {
    mockFetch(() => new Response('rate limited', { status: 429 }));

    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4' });
    await expect(client.embed(['x'], 'document')).rejects.toThrow(/429/);
    await expect(client.embed(['x'], 'document')).rejects.toThrow(/rate limited/);
  });

  it('returns [] for empty input without calling fetch', async () => {
    const { fn } = mockFetch(() => jsonResponse({ data: [] }));
    const client = createVoyageClient({ apiKey: 'k', model: 'voyage-4' });
    const out = await client.embed([], 'document');
    expect(out).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
