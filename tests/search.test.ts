import { describe, expect, it } from 'vitest';
import { renderSnippet, buildVectorSearchPipeline, executeSearch } from '../src/search';
import { FakeCollection } from './fakes/collection';

describe('renderSnippet', () => {
  it('returns content unchanged when shorter than the limit', () => {
    expect(renderSnippet('hello world', 200)).toBe('hello world');
  });

  it('truncates with an ellipsis when over the limit', () => {
    const long = 'a'.repeat(300);
    const out = renderSnippet(long, 200);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and newlines into single spaces', () => {
    expect(renderSnippet('  hello\n\n  world\n', 200)).toBe('hello world');
  });

  it('uses a default max of 200 chars when not specified', () => {
    const long = 'x'.repeat(500);
    expect(renderSnippet(long).length).toBe(200);
  });
});

describe('buildVectorSearchPipeline', () => {
  it('produces a $vectorSearch + $project pipeline', () => {
    const pipeline = buildVectorSearchPipeline({ index: 'idx', query: 'hello', limit: 5 });

    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]).toEqual({
      $vectorSearch: {
        index: 'idx',
        path: 'content',
        query: 'hello',
        limit: 5,
        numCandidates: 50,
      },
    });
    expect(pipeline[1]).toMatchObject({
      $project: {
        path: 1,
        content: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    });
  });
});

describe('executeSearch', () => {
  it('returns an empty list for a blank query without calling the collection', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [{ path: 'should-not-return.md', content: 'x', score: 1 }];

    const hits = await executeSearch(fake, { index: 'idx', query: '   ', limit: 5 });
    expect(hits).toEqual([]);
  });

  it('maps Atlas docs to search hits with rendered snippets', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [
      { path: 'a.md', content: 'line one\n\nline two', score: 0.93 },
      { path: 'b.md', content: 'b content', score: 0.81 },
    ];

    const hits = await executeSearch(fake, { index: 'idx', query: 'hi', limit: 5 });

    expect(hits).toEqual([
      { path: 'a.md', snippet: 'line one line two', score: 0.93 },
      { path: 'b.md', snippet: 'b content', score: 0.81 },
    ]);
  });
});
