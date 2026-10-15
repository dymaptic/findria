import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dimensions, $0.02/1M tokens

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export class EmbeddingService {
  async embed(text: string): Promise<number[]> {
    const cleanedText = text
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 30000); // ~8K tokens rough limit

    const response = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanedText,
      dimensions: 1536,
    });

    return response.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const cleanedTexts = texts.map((text) =>
      text.replace(/\s+/g, ' ').trim().substring(0, 30000)
    );

    // OpenAI supports batching up to 2048 inputs
    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < cleanedTexts.length; i += batchSize) {
      const batch = cleanedTexts.slice(i, i + batchSize);
      const response = await getOpenAI().embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: 1536,
      });
      results.push(...response.data.map((d) => d.embedding));
    }

    return results;
  }
}

export const embeddingService = new EmbeddingService();
