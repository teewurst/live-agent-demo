import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsLibDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(testsLibDir, "../..");
export const repoRoot = path.resolve(backendRoot, "..");

export function loadProjectEnv() {
  dotenv.config({ path: path.join(repoRoot, ".env") });
  dotenv.config({ path: path.join(backendRoot, ".env") });
}

export function requireOpenAiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || key === "test-key") {
    throw new Error(
      "OPENAI_API_KEY is required for live benchmark. Set it in the repo .env file.",
    );
  }
  return key;
}
