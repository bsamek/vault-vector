export type VoyageInputType = 'document' | 'query';

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export interface VoyageReranker {
  rerank(query: string, documents: string[], topK: number): Promise<RerankResult[]>;
}

interface VoyageRerankResponse {
  data: Array<{ index: number; relevance_score: number }>;
}

const RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank';

export function createVoyageReranker(opts: {
  apiKey: string;
  model: string;
}): VoyageReranker {
  return {
    async rerank(query, documents, topK) {
      if (documents.length === 0) return [];
      const res = await fetch(RERANK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          documents,
          model: opts.model,
          top_k: topK,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage rerank ${res.status}: ${body}`);
      }
      const json = (await res.json()) as VoyageRerankResponse;
      return json.data.map(d => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      }));
    },
  };
}

export interface VoyageClient {
  embed(texts: string[], inputType: VoyageInputType): Promise<number[][]>;
}

interface VoyageEmbedResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

export function createVoyageClient(opts: {
  apiKey: string;
  model: string;
  batchSize?: number;
}): VoyageClient {
  const batchSize = opts.batchSize ?? 64;

  async function embedBatch(texts: string[], inputType: VoyageInputType): Promise<number[][]> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: opts.model, input_type: inputType }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage ${res.status}: ${body}`);
    }

    const json = (await res.json()) as VoyageEmbedResponse;
    const ordered: number[][] = new Array(texts.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }

  return {
    async embed(texts, inputType) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const chunk = texts.slice(i, i + batchSize);
        const embeddings = await embedBatch(chunk, inputType);
        out.push(...embeddings);
      }
      return out;
    },
  };
}
