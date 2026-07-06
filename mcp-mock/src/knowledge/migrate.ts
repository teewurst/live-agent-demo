import { PUBLIC_KNOWLEDGE_DOCUMENTS } from "./seedDocuments.js";
import { knowledgeVectorStore } from "./vectorStore.js";

/** Bump when PUBLIC_KNOWLEDGE_DOCUMENTS changes so the vector store re-seeds on restart. */
export const KNOWLEDGE_CORPUS_VERSION = "2";

export type MigrationResult = {
  migrated: boolean;
  chunkCount: number;
  reason: string;
  corpusVersion: string;
};

let appliedCorpusVersion: string | undefined;

export function migrateKnowledgeBase(force = false): MigrationResult {
  const needsMigration =
    force ||
    knowledgeVectorStore.isEmpty() ||
    appliedCorpusVersion !== KNOWLEDGE_CORPUS_VERSION;

  if (!needsMigration) {
    return {
      migrated: false,
      chunkCount: knowledgeVectorStore.size,
      reason: "Vector store already up to date.",
      corpusVersion: KNOWLEDGE_CORPUS_VERSION,
    };
  }

  const chunkCount = knowledgeVectorStore.seed(PUBLIC_KNOWLEDGE_DOCUMENTS);
  appliedCorpusVersion = KNOWLEDGE_CORPUS_VERSION;

  return {
    migrated: true,
    chunkCount,
    reason: `Seeded ${chunkCount} knowledge chunks (corpus v${KNOWLEDGE_CORPUS_VERSION}).`,
    corpusVersion: KNOWLEDGE_CORPUS_VERSION,
  };
}

export function listTopicGroups(): string[] {
  return [...new Set(PUBLIC_KNOWLEDGE_DOCUMENTS.map((doc) => doc.topicGroup))].sort();
}
