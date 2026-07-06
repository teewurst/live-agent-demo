/** Canonical benchmark scenario for validate + invoice lookup. */
export const STANDARD_SCENARIO = {
  id: "validate-latest-invoice",
  description:
    "Caller asks for latest invoice and provides customer number + phone password. " +
    "Agent validates, looks up invoice, and speaks the result.",
  input:
    "My customer number is 12345 and phone password is 9876. Please look up my latest invoice.",
  toolBackend: "local",
  expected: {
    toolCallOrder: [
      "emit_output",
      "validate_customer",
      "emit_output",
      "get_customer_information",
      "emit_output",
    ],
    validateCustomer: {
      customer_number: "12345",
      auth_method: "phone_password",
      phone_password: "9876",
    },
    invoiceNumber: "INV-12345-2026-004",
    captionSnippets: ["One moment please", "Thanks, checking that now", "INV-12345-2026-004"],
    finalStatus: "done",
  },
};

function assistantCaptions(events) {
  return events
    .filter((event) => event.name === "assistant_caption_delta")
    .map((event) => event.data.delta)
    .join("");
}

function toolCalls(events) {
  return events
    .filter((event) => event.name === "tool_call")
    .map((event) => ({
      toolCallId: String(event.data.toolCallId ?? ""),
      toolName: String(event.data.toolName ?? ""),
      arguments: event.data.arguments ?? {},
      status: "called",
    }));
}

function toolResults(events) {
  return events
    .filter((event) => event.name === "tool_result")
    .map((event) => ({
      toolCallId: String(event.data.toolCallId ?? ""),
      toolName: String(event.data.toolName ?? ""),
      status: String(event.data.status ?? ""),
      result: event.data.result ?? null,
    }));
}

function buildToolSequence(events) {
  const calls = toolCalls(events);
  const results = toolResults(events);
  const sequence = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    sequence.push({
      order: index + 1,
      phase: "call",
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      arguments: call.arguments,
    });

    const result = results.find((item) => item.toolCallId === call.toolCallId);
    if (result) {
      sequence.push({
        order: index + 1,
        phase: "result",
        toolName: result.toolName,
        toolCallId: result.toolCallId,
        status: result.status,
        result: result.result,
      });
    }
  }

  return sequence;
}

function mergeClientNetworkSpans(turnProfile, clientTiming) {
  if (!turnProfile || !clientTiming) {
    return turnProfile;
  }

  const networkSpans = [];
  if (clientTiming.connectMs > 0) {
    networkSpans.push({
      id: "client-connect",
      kind: "network",
      label: "Network connection",
      ms: clientTiming.connectMs,
      detail: "TCP/TLS handshake",
    });
  }

  networkSpans.push({
    id: "client-upload",
    kind: "network",
    label: "Network upload",
    ms: Math.max(clientTiming.uploadMs, 0),
    detail: `${Math.max(1, Math.round(clientTiming.audioBytes / 1024))} KB audio → backend`,
  });

  const networkMs = networkSpans.reduce((sum, span) => sum + span.ms, 0);
  const spans = [...networkSpans, ...(turnProfile.spans ?? [])];
  const bucketSums = {
    transcribing: 0,
    agent: 0,
    tools: 0,
    tts: 0,
  };

  for (const span of spans) {
    if (span.kind === "network" || span.kind === "transcribing") {
      bucketSums.transcribing += span.ms;
    } else if (span.kind === "agent_llm") {
      bucketSums.agent += span.ms;
    } else if (span.kind === "tool") {
      bucketSums.tools += span.ms;
    } else if (span.kind === "tts") {
      bucketSums.tts += span.ms;
    }
  }

  const bucketLabels = {
    transcribing: "Middleware",
    agent: "AI Agent (LLM)",
    tools: "MCP / Tools",
    tts: "TTS",
  };

  return {
    ...turnProfile,
    totalMs: (turnProfile.totalMs ?? 0) + networkMs,
    spans,
    buckets: Object.entries(bucketSums)
      .filter(([, ms]) => ms > 0)
      .map(([key, ms]) => ({
        key,
        label: bucketLabels[key],
        ms,
      })),
  };
}

function textIncludesInvoice(payload, invoiceNumber) {
  return JSON.stringify(payload).includes(invoiceNumber);
}

function runStrictAssertions(events, scenario) {
  const captions = assistantCaptions(events);
  const calls = toolCalls(events);
  const results = toolResults(events);
  const callNames = calls.map((call) => call.toolName);
  const finalStatus = events.filter((event) => event.name === "status").at(-1)?.data.state ?? null;
  const turnProfile = events.find((event) => event.name === "turn_profile")?.data ?? null;

  const validateCall = calls.find((call) => call.toolName === "validate_customer");
  const validateResult = results.find((result) => result.toolName === "validate_customer");
  const researchResult = results.find((result) => result.toolName === "get_customer_information");

  return [
    {
      id: "tool_call_sequence",
      passed: JSON.stringify(callNames) === JSON.stringify(scenario.expected.toolCallOrder),
      expected: scenario.expected.toolCallOrder,
      actual: callNames,
    },
    {
      id: "validate_customer_called",
      passed: Boolean(validateCall),
      message: "validate_customer tool call present",
    },
    {
      id: "validate_customer_args",
      passed:
        validateCall?.arguments.customer_number === scenario.expected.validateCustomer.customer_number &&
        validateCall?.arguments.auth_method === scenario.expected.validateCustomer.auth_method &&
        validateCall?.arguments.phone_password === scenario.expected.validateCustomer.phone_password,
      expected: scenario.expected.validateCustomer,
      actual: validateCall?.arguments ?? null,
    },
    {
      id: "validate_customer_success",
      passed: validateResult?.status === "success",
      actual: validateResult?.status ?? null,
    },
    {
      id: "get_customer_information_success",
      passed: researchResult?.status === "success",
      actual: researchResult?.status ?? null,
    },
    {
      id: "invoice_number_in_result",
      passed: textIncludesInvoice(researchResult?.result ?? "", scenario.expected.invoiceNumber),
      expected: scenario.expected.invoiceNumber,
    },
    {
      id: "assistant_captions",
      passed: scenario.expected.captionSnippets.every((snippet) => captions.includes(snippet)),
      expected: scenario.expected.captionSnippets,
      actual: captions,
    },
    {
      id: "final_status_done",
      passed: finalStatus === scenario.expected.finalStatus,
      expected: scenario.expected.finalStatus,
      actual: finalStatus,
    },
    {
      id: "turn_profile_present",
      passed: Boolean(turnProfile),
      message: "turn_profile SSE event emitted",
    },
  ];
}

function runLiveAssertions(events, scenario) {
  const captions = assistantCaptions(events);
  const calls = toolCalls(events);
  const results = toolResults(events);
  const callNames = calls.map((call) => call.toolName);
  const finalStatus = events.filter((event) => event.name === "status").at(-1)?.data.state ?? null;
  const turnProfile = events.find((event) => event.name === "turn_profile")?.data ?? null;
  const userTranscript = events.find((event) => event.name === "user_transcript")?.data.text ?? "";

  const validateCall = calls.find((call) => call.toolName === "validate_customer");
  const validateResult = results.find((result) => result.toolName === "validate_customer");
  const researchResult = results.find((result) => result.toolName === "get_customer_information");
  const invoiceAnywhere =
    textIncludesInvoice(researchResult?.result ?? "", scenario.expected.invoiceNumber) ||
    captions.includes(scenario.expected.invoiceNumber) ||
    textIncludesInvoice(events, scenario.expected.invoiceNumber);

  return [
    {
      id: "validate_customer_called",
      passed: Boolean(validateCall),
      message: "validate_customer tool call present",
      critical: true,
    },
    {
      id: "validate_customer_number",
      passed: String(validateCall?.arguments.customer_number ?? "") === "12345",
      actual: validateCall?.arguments ?? null,
      critical: true,
    },
    {
      id: "validate_customer_success",
      passed: validateResult?.status === "success",
      actual: validateResult?.status ?? null,
      critical: true,
    },
    {
      id: "get_customer_information_called",
      passed: callNames.includes("get_customer_information"),
      actual: callNames,
      critical: true,
    },
    {
      id: "get_customer_information_success",
      passed: researchResult?.status === "success",
      actual: researchResult?.status ?? null,
      critical: true,
    },
    {
      id: "invoice_number_delivered",
      passed: invoiceAnywhere,
      expected: scenario.expected.invoiceNumber,
      actual: captions,
      critical: true,
    },
    {
      id: "emit_output_spoken",
      passed: results.some((result) => result.toolName === "emit_output" && result.status === "success"),
      critical: true,
    },
    {
      id: "final_status_done",
      passed: finalStatus === "done",
      expected: "done",
      actual: finalStatus,
      critical: true,
    },
    {
      id: "turn_profile_present",
      passed: Boolean(turnProfile),
      critical: true,
    },
    {
      id: "turn_profile_has_timing",
      passed: typeof turnProfile?.totalMs === "number" && turnProfile.totalMs > 0,
      actual: turnProfile?.totalMs ?? null,
      critical: true,
    },
    {
      id: "user_transcript_present",
      passed: userTranscript.trim().length > 0,
      actual: userTranscript,
      critical: false,
    },
    {
      id: "tool_call_sequence_exact",
      passed: JSON.stringify(callNames) === JSON.stringify(scenario.expected.toolCallOrder),
      expected: scenario.expected.toolCallOrder,
      actual: callNames,
      critical: false,
    },
  ];
}

function runAssertions(events, scenario, options = {}) {
  const mode = options.mode ?? "strict";
  const assertions =
    mode === "live" ? runLiveAssertions(events, scenario) : runStrictAssertions(events, scenario);

  const passed =
    mode === "live"
      ? assertions.filter((item) => item.critical).every((item) => item.passed)
      : assertions.every((item) => item.passed);

  return { passed, assertions, mode };
}

export function buildBenchmarkReport(events, scenario = STANDARD_SCENARIO, options = {}) {
  const captions = assistantCaptions(events);
  const toolSequence = buildToolSequence(events);
  const rawTurnProfile = events.find((event) => event.name === "turn_profile")?.data ?? null;
  const turnProfile = mergeClientNetworkSpans(rawTurnProfile, options.clientTiming ?? null);
  const validation = runAssertions(events, scenario, options);
  const statusEvents = events.filter((event) => event.name === "status").map((event) => event.data.state);
  const wallClockMs = options.wallClockMs ?? null;

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    execution: {
      mode: options.executionMode ?? "mock",
      apis: options.apis ?? ["mock-openai.chat", "mock-openai.tts"],
      models: options.models ?? null,
      wallClockMs,
    },
    scenario: {
      id: scenario.id,
      description: scenario.description,
      input: scenario.input,
      toolBackend: scenario.toolBackend,
      route: options.route ?? "debug-message",
    },
    passed: validation.passed,
    summary: {
      eventCount: events.length,
      toolCallCount: toolCalls(events).length,
      toolResultCount: toolResults(events).length,
      toolCallNames: toolCalls(events).map((call) => call.toolName),
      assistantCaption: captions,
      statusTimeline: statusEvents,
      finalStatus: statusEvents.at(-1) ?? null,
      totalMs: turnProfile?.totalMs ?? null,
      serverMs: rawTurnProfile?.totalMs ?? null,
      clientNetworkMs: options.clientTiming
        ? (options.clientTiming.connectMs ?? 0) + (options.clientTiming.uploadMs ?? 0)
        : null,
      buckets: turnProfile?.buckets ?? [],
    },
    turnProfile,
    toolSequence,
    assertions: validation.assertions,
    events: events.map((event) => ({
      name: event.name,
      data: event.data,
    })),
  };
}
