import { z } from "zod";
import { RESEARCH_LOOKUPS, researchCustomerLookup, type ResearchLookup } from "./crmDemoData.js";
import { runMcpHttpServer } from "./runMcpHttpServer.js";

const port = Number(process.env.MCP_RESEARCH_PORT ?? 3011);
const lookupEnum = RESEARCH_LOOKUPS as unknown as [string, ...string[]];

runMcpHttpServer(port, "crm-research-mcp-mock", (server) => {
  server.registerTool(
    "research_customer",
    {
      description:
        "Structured account lookup after validation. Use lookup enum only — not free text. " +
        "latest_invoice | invoice_by_id | list_invoices | open_invoices | overdue_invoices | billing_contact",
      inputSchema: {
        lookup: z.enum(lookupEnum).describe("Structured lookup type"),
        invoice_id: z
          .string()
          .optional()
          .describe("Required when lookup is invoice_by_id"),
        customer_number: z
          .string()
          .describe("Validated customer number (injected by middleware, not the LLM)"),
      },
    },
    async ({ lookup, invoice_id, customer_number }) => {
      const result = researchCustomerLookup({
        customer_number,
        lookup: lookup as ResearchLookup,
        invoice_id,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...result, source: "mcp_mock" }),
          },
        ],
      };
    },
  );
});
