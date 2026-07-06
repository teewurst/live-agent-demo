import type OpenAI from "openai";
import { CUSTOMER_INFO_LOOKUPS, VALIDATE_AUTH_METHODS } from "./crmDemoData.js";

export const RETRIEVE_INFORMATION_TOOL = "retrieve_information";
export const VALIDATE_CUSTOMER_TOOL = "validate_customer";
export const GET_CUSTOMER_INFORMATION_TOOL = "get_customer_information";

/** @deprecated */
export const RESEARCH_CUSTOMER_TOOL = GET_CUSTOMER_INFORMATION_TOOL;

export const LOCAL_BACKEND_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: RETRIEVE_INFORMATION_TOOL,
      description:
        "Semantic search over public ERP documentation: products, plans, billing guidelines, support, FAQ. " +
        "No authentication required. No account or personal data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language question or keywords" },
          topic_group: {
            type: "string",
            description:
              "Optional: billing_guidelines | compliance | faq | guidelines | integrations | localization | " +
              "onboarding | partner_reseller | products | security_public | sla_incidents | " +
              "subscription_plans | support | upgrades_downgrades",
          },
          max_results: { type: "number", description: "Max excerpts (1-8, default 3)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: VALIDATE_CUSTOMER_TOOL,
      description:
        "Verify the caller before any account-specific lookup. Always requires customer_number. " +
        "Preferred method: auth_method=phone_password with phone_password. " +
        "Alternative: auth_method=name_birthdate with full_name and birth_date (YYYY-MM-DD).",
      parameters: {
        type: "object",
        properties: {
          customer_number: {
            type: "string",
            description: "Five-digit customer number from invoice or billing portal.",
          },
          auth_method: {
            type: "string",
            enum: [...VALIDATE_AUTH_METHODS],
          },
          phone_password: { type: "string" },
          full_name: { type: "string" },
          birth_date: { type: "string", description: "ISO date YYYY-MM-DD." },
        },
        required: ["customer_number", "auth_method"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_CUSTOMER_INFORMATION_TOOL,
      description:
        "Account lookup after validate_customer succeeded. Never returns phone password or identity markers. " +
        "Lookups: account_profile, subscription_details, latest_invoice, invoice_by_id, list_invoices, " +
        "open_invoices, overdue_invoices, billing_contact.",
      parameters: {
        type: "object",
        properties: {
          lookup: {
            type: "string",
            enum: [...CUSTOMER_INFO_LOOKUPS],
          },
          invoice_id: {
            type: "string",
            description: "Required when lookup is invoice_by_id.",
          },
        },
        required: ["lookup"],
        additionalProperties: false,
      },
    },
  },
];
