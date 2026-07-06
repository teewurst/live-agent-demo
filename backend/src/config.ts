import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  BACKEND_PORT: z.coerce.number().default(3001),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-transcribe"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts-2025-03-20"),
  OPENAI_TTS_VOICE: z.string().default("shimmer"),
  OPENAI_TTS_FORMAT: z.enum(["mp3", "wav", "opus", "aac", "flac", "pcm"]).default("mp3"),
  OPENAI_AGENT_MODEL: z.string().default("gpt-5.4-nano"),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().default(8),
  AGENT_LOG_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  AGENT_LOG_DIR: z.string().default("./logs/agent-turns"),
  MCP_SERVER_URLS: z
    .string()
    .default("http://crm-mcp:3010/mcp")
    .transform((raw, ctx) => {
      const urls = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!urls.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCP_SERVER_URLS must list at least one MCP endpoint URL",
        });
        return z.NEVER;
      }
      for (const url of urls) {
        try {
          new URL(url);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid MCP server URL: ${url}`,
          });
          return z.NEVER;
        }
      }
      return urls;
    }),
  DEMO_CUSTOMER_PASSWORDS: z
    .string()
    .default('{"12345":"9876","67890":"horizon42"}')
    .transform((raw, ctx) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        const map: Record<string, string> = {};
        for (const [customerNumber, password] of Object.entries(parsed)) {
          if (typeof password === "string" && customerNumber.trim()) {
            map[customerNumber.trim()] = password;
          }
        }
        return map;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "DEMO_CUSTOMER_PASSWORDS must be a JSON object of customer_number -> phone_password",
        });
        return z.NEVER;
      }
    }),
  PHRASE_MAX_CHARS: z.coerce.number().default(800),
  PHRASE_MIN_CHARS: z.coerce.number().default(120),
  PHRASE_FLUSH_ON_NEWLINE: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  /** Agent replies at or below this length are synthesized in one TTS call (better prosody). */
  TTS_WHOLE_MESSAGE_MAX_CHARS: z.coerce.number().default(800),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
