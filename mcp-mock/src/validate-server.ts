import { z } from "zod";
import {
  mergeDemoPasswords,
  parseDemoPasswords,
  researchCustomerLookup,
  validateCustomerAuth,
  RESEARCH_LOOKUPS,
} from "./crmDemoData.js";
import { runMcpHttpServer } from "./runMcpHttpServer.js";

const passwords = parseDemoPasswords(process.env.DEMO_CUSTOMER_PASSWORDS);
mergeDemoPasswords(passwords);
const port = Number(process.env.MCP_VALIDATE_PORT ?? 3010);

runMcpHttpServer(port, "crm-validate-mcp-mock", (server) => {
  server.registerTool(
    "validate_customer",
    {
      description:
        "Verify caller before account lookup. Preferred: customer_number + phone_password. " +
        "Alternative: customer_number + full_name + birth_date (YYYY-MM-DD).",
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
    async ({ customer_number, auth_method, phone_password, full_name, birth_date }) => {
      const result = validateCustomerAuth({
        customer_number,
        auth_method,
        phone_password,
        full_name,
        birth_date,
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
