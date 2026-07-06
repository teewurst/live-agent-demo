import type { KnowledgeDocument } from "./seedDocuments.js";

export type IndexedChunk = {
  id: string;
  documentId: string;
  topicGroup: string;
  title: string;
  text: string;
  vector: Map<string, number>;
};

export type SearchHit = {
  id: string;
  documentId: string;
  topicGroup: string;
  title: string;
  excerpt: string;
  score: number;
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "were",
  "der", "die", "das", "und", "oder", "zu", "von", "im", "für", "ist", "sind", "ein", "eine",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  const smaller = a.size < b.size ? a : b;
  const larger = a.size < b.size ? b : a;
  for (const [term, weight] of smaller) {
    const other = larger.get(term);
    if (other) {
      dot += weight * other;
    }
  }
  return dot;
}

export class InMemoryVectorStore {
  private chunks: IndexedChunk[] = [];
  private idf = new Map<string, number>();

  isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  get size(): number {
    return this.chunks.length;
  }

  clear(): void {
    this.chunks = [];
    this.idf.clear();
  }

  seed(documents: KnowledgeDocument[]): number {
    this.clear();
    const rawChunks = documents.map((doc) => ({
      id: `chunk-${doc.id}`,
      documentId: doc.id,
      topicGroup: doc.topicGroup,
      title: doc.title,
      text: `${doc.title}. ${doc.content} Tags: ${doc.tags.join(", ")}`,
    }));

    const documentFrequency = new Map<string, number>();
    for (const chunk of rawChunks) {
      const uniqueTerms = new Set(tokenize(chunk.text));
      for (const term of uniqueTerms) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    const totalDocs = rawChunks.length;
    this.idf = new Map(
      [...documentFrequency.entries()].map(([term, df]) => [term, Math.log((1 + totalDocs) / (1 + df)) + 1]),
    );

    this.chunks = rawChunks.map((chunk) => {
      const tokens = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
      const weighted = new Map<string, number>();
      for (const [term, count] of tf) {
        weighted.set(term, count * (this.idf.get(term) ?? 1));
      }
      const magnitude = Math.sqrt([...weighted.values()].reduce((sum, value) => sum + value * value, 0));
      const vector = new Map<string, number>();
      for (const [term, weight] of weighted) {
        vector.set(term, magnitude > 0 ? weight / magnitude : 0);
      }
      return { ...chunk, vector };
    });

    return this.chunks.length;
  }

  search(query: string, options?: { topK?: number; topicGroup?: string }): SearchHit[] {
    const topK = options?.topK ?? 5;
    const tokens = tokenize(query);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    const weighted = new Map<string, number>();
    for (const [term, count] of tf) {
      weighted.set(term, count * (this.idf.get(term) ?? 1));
    }
    const magnitude = Math.sqrt([...weighted.values()].reduce((sum, value) => sum + value * value, 0));
    const normalizedQuery = new Map<string, number>();
    for (const [term, weight] of weighted) {
      normalizedQuery.set(term, magnitude > 0 ? weight / magnitude : 0);
    }

    const hits = this.chunks
      .filter((chunk) => !options?.topicGroup || chunk.topicGroup === options.topicGroup)
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        topicGroup: chunk.topicGroup,
        title: chunk.title,
        excerpt: chunk.text.slice(0, 280),
        score: cosineSimilarity(normalizedQuery, chunk.vector),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return hits;
  }
}

export const knowledgeVectorStore = new InMemoryVectorStore();
