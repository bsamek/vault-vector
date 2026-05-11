export type VoyageInputType = 'document' | 'query';

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
