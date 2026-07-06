import {
  findDiscoveredTool,
  isCustomerInfoTool,
  isPublicInfoTool,
  isValidateTool,
  GET_CUSTOMER_INFORMATION_TOOL,
  VALIDATE_CUSTOMER_TOOL,
} from "./mcpToolRegistry.js";
import { callDiscoveredMcpTool } from "./mcpConnectionManager.js";
import {
  localGetCustomerInformation,
  localRetrieveInformation,
  localValidateCustomer,
  type CustomerInfoLookup,
  type ValidateCustomerInput,
} from "./localDemoTools.js";
import { setCustomerValidation } from "./sessions.js";
import type { SessionState, ToolExecutionResult } from "./types.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseValidFlag(result: unknown): boolean | null {
  if (typeof result === "boolean") {
    return result;
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.valid === "boolean") {
      return record.valid;
    }
    if (typeof record.success === "boolean") {
      return record.success;
    }
  }
  return null;
}

function parseValidateInput(args: Record<string, unknown>): ValidateCustomerInput {
  return {
    customer_number: asString(args.customer_number),
    auth_method: args.auth_method as ValidateCustomerInput["auth_method"],
    phone_password: asString(args.phone_password) || undefined,
    full_name: asString(args.full_name) || undefined,
    birth_date: asString(args.birth_date) || undefined,
  };
}

function parseCustomerInfoInput(
  session: SessionState,
  args: Record<string, unknown>,
): { lookup: CustomerInfoLookup; invoice_id?: string; customer_number: string } {
  return {
    lookup: asString(args.lookup) as CustomerInfoLookup,
    invoice_id: asString(args.invoice_id) || undefined,
    customer_number: session.customerNumber ?? "",
  };
}

async function executeViaMcp(
  session: SessionState,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ result: unknown; source: "mcp" | "local_demo" }> {
  const discovered = findDiscoveredTool(session, toolName);
  if (!discovered) {
    return {
      result: {
        error: "TOOL_NOT_DISCOVERED",
        message: `Tool ${toolName} was not discovered from MCP servers.`,
      },
      source: "local_demo",
    };
  }

  const mcpResult = await callDiscoveredMcpTool(session.id, discovered, args, signal);
  if (mcpResult.status === "success" && mcpResult.result !== null) {
    return { result: mcpResult.result, source: "mcp" };
  }

  return executeLocalFallback(session, toolName, args, mcpResult);
}

function resolveMcpError(
  mcpResult?: { status: string; errorMessage?: string },
): string | undefined {
  if (!mcpResult) {
    return undefined;
  }
  if (mcpResult.status === "error") {
    return mcpResult.errorMessage ?? "MCP error";
  }
  return "empty MCP result";
}

function withLocalDemoMeta<T extends Record<string, unknown>>(
  payload: T,
  mcpResult?: { status: string; errorMessage?: string },
): T & { source: "local_demo"; mcpError?: string } {
  const mcpError = resolveMcpError(mcpResult);
  return {
    ...payload,
    source: "local_demo",
    ...(mcpError ? { mcpError } : {}),
  };
}

function executeLocalFallback(
  session: SessionState,
  toolName: string,
  args: Record<string, unknown>,
  mcpResult?: { status: string; errorMessage?: string },
): { result: unknown; source: "local_demo" } {
  const mcpError = resolveMcpError(mcpResult);

  if (isPublicInfoTool(toolName)) {
    return {
      result: withLocalDemoMeta(
        localRetrieveInformation(
          asString(args.query),
          asString(args.topic_group) || undefined,
          asNumber(args.max_results),
        ),
        mcpResult,
      ),
      source: "local_demo",
    };
  }

  if (isValidateTool(toolName)) {
    return {
      result: withLocalDemoMeta(localValidateCustomer(parseValidateInput(args)), mcpResult),
      source: "local_demo",
    };
  }

  if (isCustomerInfoTool(toolName)) {
    const { lookup, invoice_id, customer_number } = parseCustomerInfoInput(session, args);
    return {
      result: withLocalDemoMeta(
        localGetCustomerInformation(customer_number, lookup, invoice_id),
        mcpResult,
      ),
      source: "local_demo",
    };
  }

  return {
    result: {
      error: "MCP_FAILED",
      message: mcpError ?? "MCP returned no result",
    },
    source: "local_demo",
  };
}

function executeLocal(
  session: SessionState,
  toolName: string,
  args: Record<string, unknown>,
): { result: unknown; source: "local_demo" } {
  return executeLocalFallback(session, toolName, args);
}

function applyValidationResult(
  session: SessionState,
  args: Record<string, unknown>,
  result: unknown,
): void {
  const valid = parseValidFlag(result) ?? false;
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const resolvedCustomerNumber =
    typeof record.customerNumber === "string"
      ? record.customerNumber
      : asString(args.customer_number);

  setCustomerValidation(session, valid ? resolvedCustomerNumber : undefined, valid);
}

export async function executeBackendTool(
  session: SessionState,
  toolName: string,
  args: Record<string, unknown>,
  _userText: string,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const mode = session.toolBackendMode;

  if (isPublicInfoTool(toolName)) {
    const retrieveArgs = {
      query: asString(args.query),
      topic_group: asString(args.topic_group) || undefined,
      max_results: asNumber(args.max_results),
    };
    const { result } =
      mode === "mcp"
        ? await executeViaMcp(session, toolName, retrieveArgs, signal)
        : executeLocal(session, toolName, retrieveArgs);
    return { status: "success", result };
  }

  if (isValidateTool(toolName)) {
    const { result } =
      mode === "mcp"
        ? await executeViaMcp(session, toolName, args, signal)
        : executeLocal(session, toolName, args);

    applyValidationResult(session, args, result);

    return {
      status: "success",
      result,
    };
  }

  if (isCustomerInfoTool(toolName)) {
    if (!session.customerValidated || !session.customerNumber) {
      return {
        status: "error",
        result: {
          error: "CUSTOMER_NOT_VALIDATED",
          message:
            "Customer is not validated in this session. Call validate_customer first.",
        },
      };
    }

    const customerArgs =
      mode === "mcp"
        ? {
            lookup: asString(args.lookup),
            invoice_id: asString(args.invoice_id) || undefined,
          }
        : {
            lookup: asString(args.lookup),
            invoice_id: asString(args.invoice_id) || undefined,
            customer_number: session.customerNumber,
          };

    const { result } =
      mode === "mcp"
        ? await executeViaMcp(session, toolName, customerArgs, signal)
        : executeLocal(session, toolName, customerArgs);

    return {
      status: "success",
      result,
    };
  }

  if (mode === "mcp") {
    const { result, source } = await executeViaMcp(session, toolName, args, signal);
    return {
      status: "success",
      result: { ...(result as object), source },
    };
  }

  return {
    status: "error",
    result: {
      error: "UNKNOWN_TOOL",
      message: `Tool ${toolName} is not registered.`,
    },
  };
}

export { VALIDATE_CUSTOMER_TOOL, GET_CUSTOMER_INFORMATION_TOOL };
