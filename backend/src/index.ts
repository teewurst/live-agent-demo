import cors from "cors";
import express from "express";
import multer from "multer";
import { config } from "./config.js";
import { AppError, isAbortError, sendErrorEvent } from "./errors.js";
import { transcribeAudio } from "./openaiAudio.js";
import { openCallLine } from "./callOpen.js";
import { processTextTurn } from "./pipeline.js";
import {
  clearAbortController,
  createSession,
  getSession,
  interruptSession,
  resetSession,
  setAbortController,
} from "./sessions.js";
import { closeSse, initSseResponse, writeEvent } from "./sse.js";
import { applyToolBackendFromRequest } from "./toolBackend.js";
import { applyAgentPromptFromRequest } from "./promptVariant.js";
import { loadMcpDiscoveryCacheFromDisk } from "./mcpDiscoveryCache.js";
import { TurnProfiler } from "./turnProfiler.js";
import {
  connectLiveSessionHandler,
  createLiveSessionHandler,
  getLivePromptHandler,
  interruptLiveSessionHandler,
  resetLiveSessionHandler,
} from "./liveSession.js";
import { executeLiveToolHandler } from "./liveToolHandler.js";

loadMcpDiscoveryCacheFromDisk();

function sessionIdFromParams(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.use(
  cors({
    origin: config.FRONTEND_ORIGIN,
    allowedHeaders: [
      "Content-Type",
      "X-Tool-Backend",
      "X-Agent-Prompt-Variant",
      "X-Live-Agent-Prompt-Variant",
    ],
  }),
);
app.use(express.json());
app.use(express.text({ type: ["application/sdp", "text/plain"] }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/sessions/instant", (_req, res) => {
  const session = createSession();
  res.json({ sessionId: session.id });
});

app.post("/api/live/sessions", createLiveSessionHandler);
app.get("/api/live/sessions/:sessionId/prompt", getLivePromptHandler);
app.post("/api/live/sessions/:sessionId/connect", connectLiveSessionHandler);
app.post("/api/live/sessions/:sessionId/reset", resetLiveSessionHandler);
app.post("/api/live/sessions/:sessionId/interrupt", interruptLiveSessionHandler);
app.post("/api/live/sessions/:sessionId/tools/execute", executeLiveToolHandler);

app.post("/api/sessions", async (req, res) => {
  initSseResponse(res);

  const session = createSession();
  const abortController = new AbortController();
  setAbortController(session, abortController);
  const signal = abortController.signal;
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    await openCallLine({ session, res, signal });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      clearAbortController(session, signal);
      return;
    }

    const message =
      error instanceof AppError ? error.message : "Unexpected error while opening call";
    sendErrorEvent(res, message);
    closeSse(res);
    clearAbortController(session, signal);
  } finally {
    clearAbortController(session, signal);
  }
});

app.post("/api/sessions/:sessionId/reset", async (req, res) => {
  initSseResponse(res);

  let session;
  try {
    session = resetSession(sessionIdFromParams(req.params.sessionId));
  } catch (error) {
    sendErrorEvent(res, error instanceof AppError ? error.message : "Session not found");
    closeSse(res);
    return;
  }

  const abortController = new AbortController();
  setAbortController(session, abortController);
  const signal = abortController.signal;
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    await openCallLine({ session, res, signal });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      clearAbortController(session, signal);
      return;
    }

    const message =
      error instanceof AppError ? error.message : "Unexpected error while reopening call";
    sendErrorEvent(res, message);
    closeSse(res);
    clearAbortController(session, signal);
  } finally {
    clearAbortController(session, signal);
  }
});

app.post("/api/sessions/:sessionId/interrupt", (req, res) => {
  try {
    interruptSession(sessionIdFromParams(req.params.sessionId));
    res.json({ ok: true });
  } catch (error) {
    handleHttpError(error, res);
  }
});

app.post("/api/sessions/:sessionId/debug-message", async (req, res) => {
  initSseResponse(res);

  let session;
  try {
    session = getSession(sessionIdFromParams(req.params.sessionId));
  } catch (error) {
    sendErrorEvent(res, error instanceof AppError ? error.message : "Session not found");
    closeSse(res);
    return;
  }

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    sendErrorEvent(res, "Missing debug text");
    closeSse(res);
    return;
  }

  applyToolBackendFromRequest(req, session);
  applyAgentPromptFromRequest(req, session);

  const abortController = new AbortController();
  setAbortController(session, abortController);
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  await processTextTurn({
    session,
    res,
    userText: text,
    signal: abortController.signal,
  });
});

app.post(
  "/api/sessions/:sessionId/utterance",
  upload.single("audio"),
  async (req, res) => {
    initSseResponse(res);

    let session;
    try {
      session = getSession(sessionIdFromParams(req.params.sessionId));
    } catch (error) {
      sendErrorEvent(res, error instanceof AppError ? error.message : "Session not found");
      closeSse(res);
      return;
    }

    applyToolBackendFromRequest(req, session);
    applyAgentPromptFromRequest(req, session);

    const abortController = new AbortController();
    setAbortController(session, abortController);
    const signal = abortController.signal;
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      if (!req.file) {
        throw new AppError("Missing audio upload", "MISSING_AUDIO", 400);
      }

      writeEvent(res, "status", { state: "transcribing" });

      const profiler = new TurnProfiler();

      const transcript = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype,
        signal,
        profiler,
      );

      if (signal.aborted) {
        writeEvent(res, "status", { state: "interrupted" });
        closeSse(res);
        clearAbortController(session, signal);
        return;
      }

      await processTextTurn({ session, res, userText: transcript, signal, profiler });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        writeEvent(res, "status", { state: "interrupted" });
        closeSse(res);
        clearAbortController(session, signal);
        return;
      }

      const message =
        error instanceof AppError ? error.message : "Unexpected error during utterance processing";
      sendErrorEvent(res, message);
      closeSse(res);
      clearAbortController(session, signal);
    }
  },
);

function handleHttpError(error: unknown, res: express.Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

app.listen(config.BACKEND_PORT, () => {
  console.log(`Voice call backend listening on port ${config.BACKEND_PORT}`);
});
