import { listTopicGroups, migrateKnowledgeBase } from "./migrate.js";
import { knowledgeVectorStore } from "./vectorStore.js";

export type RetrieveInformationInput = {
  query: string;
  topic_group?: string;
  max_results?: number;
};

export function retrieveInformation(input: RetrieveInformationInput): Record<string, unknown> {
  migrateKnowledgeBase();

  const query = input.query.trim();
  if (!query) {
    return {
      error: "MISSING_QUERY",
      message: "query is required for information retrieval.",
    };
  }

  const maxResults = Math.min(Math.max(input.max_results ?? 3, 1), 8);
  const hits = knowledgeVectorStore.search(query, {
    topK: maxResults,
    topicGroup: input.topic_group?.trim() || undefined,
  });

  return {
    query,
    topicGroup: input.topic_group ?? null,
    availableTopicGroups: listTopicGroups(),
    resultCount: hits.length,
    results: hits.map((hit) => ({
      title: hit.title,
      topicGroup: hit.topicGroup,
      excerpt: hit.excerpt,
      relevanceScore: Number(hit.score.toFixed(4)),
      documentId: hit.documentId,
    })),
    source: "knowledge_vector_store",
  };
}
