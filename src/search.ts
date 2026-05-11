import type { CollectionLike } from './atlas';

export function renderSnippet(content: string, maxChars: number = 200): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars - 1) + '…';
}

export type SearchHit = { path: string; snippet: string; score: number };

export function buildVectorSearchPipeline(opts: {
  index: string;
  query: string;
  limit: number;
}): unknown[] {
  return [
    {
      $vectorSearch: {
        index: opts.index,
        path: 'content',
        query: opts.query,
        limit: opts.limit,
        numCandidates: opts.limit * 10,
      },
    },
    {
      $project: {
        _id: 0,
        path: 1,
        content: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

export async function executeSearch(
  collection: CollectionLike,
  opts: { index: string; query: string; limit: number }
): Promise<SearchHit[]> {
  if (!opts.query.trim()) return [];
  const pipeline = buildVectorSearchPipeline(opts);
  const docs = await collection.aggregate(pipeline).toArray();
  return docs.map(d => ({
    path: String(d.path),
    snippet: renderSnippet(String(d.content)),
    score: typeof d.score === 'number' ? d.score : 0,
  }));
}
