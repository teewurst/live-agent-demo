import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { clearCrmSession } from "./mcpSessionStore.js";

type TransportMap = Record<string, StreamableHTTPServerTransport>;

export function runStatefulMcpHttpServer(
  port: number,
  name: string,
  register: (server: McpServer) => void,
): void {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(express.json());

  const transports: TransportMap = {};

  const createServer = (): McpServer => {
    const server = new McpServer({ name, version: "1.0.0" });
    register(server);
    return server;
  };

  app.post("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport!;
          },
          onsessionclosed: (closedSessionId) => {
            delete transports[closedSessionId];
            clearCrmSession(closedSessionId);
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId && transports[closedSessionId]) {
            delete transports[closedSessionId];
            clearCrmSession(closedSessionId);
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${name}] MCP request failed:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: name });
  });

  app.listen(port, () => {
    console.log(`[${name}] Stateful MCP listening on :${port}/mcp`);
  });
}
