import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

export function runMcpHttpServer(
  port: number,
  name: string,
  register: (server: McpServer) => void,
): void {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const server = new McpServer({ name, version: "1.0.0" });
    register(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
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
    console.log(`[${name}] MCP mock listening on :${port}/mcp`);
  });
}
