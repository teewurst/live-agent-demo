import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { isAbortError } from "./errors.js";
import {
  getCachedMcpDiscovery,
  setCachedMcpDiscovery,
} from "./mcpDiscoveryCache.js";

export type McpCallResult =
  | { status: "success"; result: unknown }
  | { status: "error"; errorMessage: string };

export type DiscoveredMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverUrl: string;
};

class McpServerConnection {
  private client: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private connected = false;

  constructor(
    readonly serverUrl: string,
    private sessionId?: string,
  ) {}

  get activeSessionId(): string | undefined {
    return this.transport?.sessionId ?? this.sessionId;
  }

  async connect(signal?: AbortSignal): Promise<string | undefined> {
    if (this.connected && this.client) {
      return this.activeSessionId;
    }

    this.client = new Client({ name: "crm-voice-backend", version: "1.0.0" });
    this.transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      sessionId: this.sessionId,
      requestInit: signal ? { signal } : undefined,
    });

    await this.client.connect(this.transport);
    this.sessionId = this.transport.sessionId;
    this.connected = true;
    return this.activeSessionId;
  }

  async listTools(signal?: AbortSignal): Promise<Tool[]> {
    await this.connect(signal);
    if (!this.client) {
      return [];
    }
    const response = await this.client.listTools(undefined, { signal });
    return response.tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    await this.connect(signal);
    if (!this.client) {
      return { status: "error", errorMessage: "MCP client not connected" };
    }

    try {
      const response = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal },
      );
      if (response.isError) {
        return {
          status: "error",
          errorMessage: `MCP tool ${toolName} returned an error`,
        };
      }
      return {
        status: "success",
        result: parseToolContent(response.content),
      };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "MCP call failed";
      return { status: "error", errorMessage: message };
    }
  }

  async close(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.terminateSession();
      } catch {
        // Server may not support DELETE.
      }
    }
    if (this.client) {
      await this.client.close();
    }
    this.client = undefined;
    this.transport = undefined;
    this.connected = false;
  }
}

const voiceSessionConnections = new Map<string, Map<string, McpServerConnection>>();

function parseToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }

  const textParts = content
    .filter((part): part is { type: string; text?: string } => {
      return Boolean(part && typeof part === "object" && "type" in part);
    })
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  const combined = textParts.join("\n").trim();
  if (!combined) {
    return null;
  }

  try {
    return JSON.parse(combined) as unknown;
  } catch {
    return combined;
  }
}

function connectionsForVoiceSession(voiceSessionId: string): Map<string, McpServerConnection> {
  let connections = voiceSessionConnections.get(voiceSessionId);
  if (!connections) {
    connections = new Map();
    voiceSessionConnections.set(voiceSessionId, connections);
  }
  return connections;
}

export function getMcpConnection(
  voiceSessionId: string,
  serverUrl: string,
  sessionId?: string,
): McpServerConnection {
  const connections = connectionsForVoiceSession(voiceSessionId);
  const existing = connections.get(serverUrl);
  if (existing) {
    return existing;
  }
  const connection = new McpServerConnection(serverUrl, sessionId);
  connections.set(serverUrl, connection);
  return connection;
}

export async function closeMcpConnections(voiceSessionId: string): Promise<void> {
  const connections = voiceSessionConnections.get(voiceSessionId);
  if (!connections) {
    return;
  }
  await Promise.all([...connections.values()].map((connection) => connection.close()));
  voiceSessionConnections.delete(voiceSessionId);
}

export async function discoverMcpTools(
  voiceSessionId: string,
  serverUrls: string[],
  signal?: AbortSignal,
): Promise<DiscoveredMcpTool[]> {
  const cached = getCachedMcpDiscovery(serverUrls);
  if (cached) {
    return cached;
  }

  const discovered: DiscoveredMcpTool[] = [];
  const seen = new Set<string>();

  for (const serverUrl of serverUrls) {
    const connection = getMcpConnection(voiceSessionId, serverUrl);
    const tools = await connection.listTools(signal);
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      discovered.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        serverUrl,
      });
    }
  }

  setCachedMcpDiscovery(serverUrls, discovered);
  return discovered;
}

export async function callDiscoveredMcpTool(
  voiceSessionId: string,
  tool: DiscoveredMcpTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  const connection = getMcpConnection(voiceSessionId, tool.serverUrl);
  return connection.callTool(tool.name, args, signal);
}
