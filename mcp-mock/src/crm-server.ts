import { z } from "zod";
import {
  mergeDemoPasswords,
  parseDemoPasswords,
  CUSTOMER_INFO_LOOKUPS,
  getCustomerInformation,
  validateCustomerAuth,
  type CustomerInfoLookup,
} from "./crmDemoData.js";
import { retrieveInformation } from "./knowledge/retrieveInformation.js";
import { migrateKnowledgeBase } from "./knowledge/migrate.js";
import {
  getCrmSession,
  setCrmSessionValidation,
} from "./mcpSessionStore.js";
import { runStatefulMcpHttpServer } from "./runStatefulMcpHttpServer.js";

const passwords = parseDemoPasswords(process.env.DEMO_CUSTOMER_PASSWORDS);
mergeDemoPasswords(passwords);
const port = Number(process.env.MCP_CRM_PORT ?? 3010);
const lookupEnum = CUSTOMER_INFO_LOOKUPS as unknown as [string, ...string[]];

const migration = migrateKnowledgeBase();
console.log(`[crm-mcp] Knowledge migration: ${migration.reason}`);

runStatefulMcpHttpServer(port, "crm-mcp-mock", (server) => {
  server.registerTool(
    "retrieve_information",
    {
      description:
        "Semantic search over public Nexus ERP documentation (products, plans, billing, support, FAQ, security). " +
        "No authentication. No account data. " +
        "Answer facts and how-to only from returned excerpts. " +
        "If resultCount is 0 or excerpts do not match: tell the caller it is not in the docs — do not say yes without content. " +
        "Login password reset is portal self-service; guide only, never reset on the call.",
      inputSchema: {
        query: z.string().describe("Natural language question or keywords to search"),
        topic_group: z
          .string()
          .optional()
          .describe(
            "Optional filter: billing_guidelines | compliance | faq | guidelines | integrations | " +
            "localization | onboarding | partner_reseller | products | security_public | " +
            "sla_incidents | subscription_plans | support | upgrades_downgrades",
          ),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Maximum number of excerpts to return (default 3)"),
      },
    },
    async ({ query, topic_group, max_results }) => {
      const result = retrieveInformation({ query, topic_group, max_results });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    "validate_customer",
    {
      description:
        "Verify caller before account-specific lookup. Preferred: customer_number + phone_password. " +
        "Alternative: customer_number + full_name + birth_date (YYYY-MM-DD). " +
        "On success the customer is bound to this MCP session. Never returns phone password or identity markers.",
      inputSchema: {
        customer_number: z.string().describe("Five-digit customer number"),
        auth_method: z
          .enum(["phone_password", "name_birthdate"])
          .describe("phone_password preferred; name_birthdate as fallback"),
        phone_password: z
          .string()
          .optional()
          .describe("Required when auth_method is phone_password"),
        full_name: z.string().optional().describe("Required when auth_method is name_birthdate"),
        birth_date: z
          .string()
          .optional()
          .describe("Required when auth_method is name_birthdate. YYYY-MM-DD"),
      },
    },
    async (args, extra) => {
      const result = validateCustomerAuth(args);
      setCrmSessionValidation(
        extra.sessionId,
        result.valid ? result.customerNumber : undefined,
        result.valid,
      );
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

  server.registerTool(
    "get_customer_information",
    {
      description:
        "Account-specific lookup after validation in this MCP session. Returns subscription, user counts, and invoices. " +
        "Never returns phone password, full name, or birth date. Lookups: account_profile, subscription_details, " +
        "latest_invoice, invoice_by_id (+ invoice_id), list_invoices, open_invoices, overdue_invoices, billing_contact.",
      inputSchema: {
        lookup: z.enum(lookupEnum).describe("Structured lookup type"),
        invoice_id: z
          .string()
          .optional()
          .describe("Required when lookup is invoice_by_id"),
      },
    },
    async ({ lookup, invoice_id }, extra) => {
      const session = getCrmSession(extra.sessionId);
      if (!session.customerValidated || !session.customerNumber) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "CUSTOMER_NOT_VALIDATED",
                message:
                  "Customer is not validated in this MCP session. Call validate_customer first.",
              }),
            },
          ],
        };
      }

      const result = getCustomerInformation({
        customer_number: session.customerNumber,
        lookup: lookup as CustomerInfoLookup,
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
