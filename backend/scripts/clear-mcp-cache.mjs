#!/usr/bin/env node
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cacheFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "mcp-discovery.json");

try {
  rmSync(cacheFile, { force: true });
  process.stderr.write(`Cleared MCP discovery cache: ${cacheFile}\n`);
} catch {
  // Ignore missing cache file.
}
