import {
  describeCustomerInfoArgsForGate,
  describeValidateArgsForGate,
} from "./crmDemoData.js";
import { isCustomerInfoTool, isValidateTool } from "./mcpToolRegistry.js";
import type { SessionState } from "./types.js";

export function gateBackendTool(
  session: SessionState,
  toolName: string,
  toolArgs: Record<string, unknown>,
): { allowed: true } | { allowed: false; result: unknown } {
  if (isValidateTool(toolName)) {
    const missing = describeValidateArgsForGate(toolArgs);
    if (missing) {
      return {
        allowed: false,
        result: {
          error: "MISSING_CREDENTIALS",
          message:
            `Do not call validate_customer until the caller has provided ${missing}. ` +
            "Preferred: customer_number + phone_password (auth_method phone_password). " +
            "Alternative: customer_number + full_name + birth_date (auth_method name_birthdate). " +
            "Ask for missing details, then wait for the caller.",
        },
      };
    }
  }

  if (isCustomerInfoTool(toolName)) {
    if (!session.customerValidated || !session.customerNumber) {
      return {
        allowed: false,
        result: {
          error: "CUSTOMER_NOT_VALIDATED",
          message:
            "Validation is required before customer information lookup. Ask for credentials if needed.",
        },
      };
    }

    const missing = describeCustomerInfoArgsForGate(toolArgs);
    if (missing) {
      return {
        allowed: false,
        result: {
          error: "MISSING_LOOKUP_ARGS",
          message:
            `get_customer_information requires a valid lookup enum${missing === "invoice_id" ? " and invoice_id when lookup is invoice_by_id" : ""}. ` +
            "Do not use free-text queries.",
        },
      };
    }
  }

  return { allowed: true };
}
