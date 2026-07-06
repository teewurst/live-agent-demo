import type { Response } from "express";
import { writeEvent } from "./sse.js";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.includes("aborted");
  }
  return false;
}

export function sendErrorEvent(res: Response, message: string): void {
  writeEvent(res, "error", { message });
  writeEvent(res, "status", { state: "error" });
}
