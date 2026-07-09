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
        "Search public documentation only (products, plans, billing, support hours, FAQ, security policy). " +
        "No authentication. Does not access account data. " +
        "Use for facts and how-to guides when steps exist in the excerpts. " +
        "If resultCount is 0 or excerpts do not answer the question: say you could not find it in the docs — do not claim you can help. " +
        "Login password reset is self-service in the portal; guide from docs, never reset on the call.",
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
        "Verify the caller before account lookups. System will say you are verifying first. " +
        "Requires customer_number. Preferred: phone_password. Alternative: name + birth_date.",
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
        "Account data after validate_customer. System will say you are loading account records. " +
        "One lookup per fact; combine results in one spoken answer. Never returns phone password.",
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
