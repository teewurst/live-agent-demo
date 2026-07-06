import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveredMcpTool } from "./mcpConnectionManager.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(backendRoot, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "mcp-discovery.json");

type CacheFile = {
  entries: Record<string, DiscoveredMcpTool[]>;
};

const memory = new Map<string, DiscoveredMcpTool[]>();

export function mcpDiscoveryCacheKey(serverUrls: string[]): string {
  return [...serverUrls].sort().join("|");
}

export function clearMcpDiscoveryCache(): void {
  memory.clear();
  try {
    unlinkSync(CACHE_FILE);
  } catch {
    // Cache file may not exist yet.
  }
}

export function loadMcpDiscoveryCacheFromDisk(): void {
  memory.clear();
  try {
    const raw = readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    for (const [key, tools] of Object.entries(parsed.entries ?? {})) {
      memory.set(key, tools);
    }
  } catch {
    // No cache yet — expected on first run after build.
  }
}

function persistMcpDiscoveryCache(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const entries = Object.fromEntries(memory.entries());
  writeFileSync(CACHE_FILE, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

export function getCachedMcpDiscovery(serverUrls: string[]): DiscoveredMcpTool[] | null {
  const key = mcpDiscoveryCacheKey(serverUrls);
  const cached = memory.get(key);
  return cached ? [...cached] : null;
}

export function setCachedMcpDiscovery(
  serverUrls: string[],
  tools: DiscoveredMcpTool[],
): void {
  const key = mcpDiscoveryCacheKey(serverUrls);
  memory.set(key, [...tools]);
  persistMcpDiscoveryCache();
}
