export type TelegramLlmCoachInput = Readonly<{
  userId: string;
  telegramUserId: number;
  messageText: string;
  reportText?: string;
  now: Date;
}>;

export type TelegramLlmCoachReply = Readonly<{
  text: string;
  provider: "openrouter";
  model: string;
}>;

export type TelegramLlmCoach = Readonly<{
  reply(input: TelegramLlmCoachInput): Promise<TelegramLlmCoachReply>;
}>;

export type OpenRouterFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type OpenRouterFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<OpenRouterFetchResponse>;

export type OpenRouterTelegramCoachConfig = Readonly<{
  apiKey: string;
  endpoint?: string;
  fetch?: OpenRouterFetch;
  model?: string;
  appName?: string;
  siteUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
}>;

export type TelegramLlmCoachRuntimeConfig = Readonly<{
  enabled?: boolean;
  provider?: "openrouter";
  apiKey?: string;
  model?: string;
  appName?: string;
  siteUrl?: string;
}>;

type OpenRouterMessage = Readonly<{
  role: "system" | "user";
  content: string;
}>;

const openRouterChatEndpoint = "https://openrouter.ai/api/v1/chat/completions";
const defaultOpenRouterModel = "openrouter/free";
const defaultOpenRouterAppName = "Fitness Coach";
const defaultTimeoutMs = 20_000;
const defaultMaxTokens = 500;
const maxMessageChars = 4_000;
const maxReportChars = 3_500;
const maxReplyChars = 1_800;

export function createOpenRouterTelegramCoach(
  config: OpenRouterTelegramCoachConfig,
): TelegramLlmCoach {
  const fetcher = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? openRouterChatEndpoint;
  const model = config.model ?? defaultOpenRouterModel;
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;
  const maxTokens = config.maxTokens ?? defaultMaxTokens;

  return {
    async reply(input) {
      const response = await postOpenRouterChatCompletion({
        apiKey: config.apiKey,
        appName: config.appName ?? defaultOpenRouterAppName,
        endpoint,
        fetcher,
        maxTokens,
        messages: buildCoachMessages(input),
        model,
        siteUrl: config.siteUrl,
        timeoutMs,
      });
      const parsed = extractOpenRouterText(response);

      return {
        text: truncate(parsed.text, maxReplyChars),
        provider: "openrouter",
        model: parsed.model ?? model,
      };
    },
  };
}

export function resolveTelegramLlmCoach(
  config: TelegramLlmCoachRuntimeConfig = {},
): TelegramLlmCoach | undefined {
  const enabled =
    config.enabled ?? envFlag("TELEGRAM_COACH_LLM_ENABLED") ?? false;

  if (!enabled) {
    return undefined;
  }

  const provider =
    config.provider ?? envString("TELEGRAM_COACH_LLM_PROVIDER") ?? "openrouter";

  if (provider !== "openrouter") {
    throw new Error("Unsupported Telegram coach LLM provider.");
  }

  const apiKey = config.apiKey ?? envString("OPENROUTER_API_KEY");

  if (apiKey === undefined) {
    throw new Error(
      "OPENROUTER_API_KEY is required when TELEGRAM_COACH_LLM_ENABLED=1.",
    );
  }

  return createOpenRouterTelegramCoach({
    apiKey,
    ...optionalString("model", config.model ?? envString("OPENROUTER_MODEL")),
    ...optionalString(
      "appName",
      config.appName ?? envString("OPENROUTER_APP_NAME"),
    ),
    ...optionalString(
      "siteUrl",
      config.siteUrl ??
        envString("OPENROUTER_SITE_URL") ??
        externalOriginFromEnv(),
    ),
  });
}

function externalOriginFromEnv(): string | undefined {
  return (
    originFromUrl(envString("FITNESS_EXTERNAL_URL")) ??
    originFromUrl(envString("RENDER_EXTERNAL_URL")) ??
    originFromVercelDomain(envString("VERCEL_PROJECT_PRODUCTION_URL")) ??
    originFromVercelDomain(envString("VERCEL_BRANCH_URL")) ??
    originFromVercelDomain(envString("VERCEL_URL"))
  );
}

function originFromUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function originFromVercelDomain(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return originFromUrl(value.includes("://") ? value : `https://${value}`);
}

function buildCoachMessages(
  input: TelegramLlmCoachInput,
): readonly OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Fitme, the user's private Telegram health and fitness coach.",
        "Coach behavior, nutrition, activity, sleep, and habit decisions using only the provided context and the user's message.",
        "Do not diagnose disease, adjust medication, or present wearable data as medical certainty.",
        "If the user reports chest pain, fainting, severe shortness of breath, unusual heart symptoms, self-harm intent, or dangerous eating behavior, recommend urgent professional help.",
        "Avoid shame, crash diets, compensatory fasting, and extreme calorie targets. Prefer the next normal meal and practical adherence.",
        "If asked to write data, say to use /log or /checkin; do not claim you changed Apple Health.",
        "Answer in the user's language when clear. Keep replies concise and Telegram-friendly.",
      ].join(" "),
    },
    {
      role: "user",
      content: buildUserPrompt(input),
    },
  ];
}

function buildUserPrompt(input: TelegramLlmCoachInput): string {
  const parts = [
    `Current time: ${input.now.toISOString()}`,
    "",
    "User message:",
    truncate(input.messageText, maxMessageChars),
  ];

  if (input.reportText !== undefined && input.reportText.trim().length > 0) {
    parts.push(
      "",
      "Recent deterministic backend report context:",
      truncate(input.reportText, maxReportChars),
    );
  }

  return parts.join("\n");
}

async function postOpenRouterChatCompletion(input: {
  apiKey: string;
  appName: string;
  endpoint: string;
  fetcher: OpenRouterFetch;
  maxTokens: number;
  messages: readonly OpenRouterMessage[];
  model: string;
  siteUrl: string | undefined;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.apiKey}`,
    "content-type": "application/json",
    "x-openrouter-title": input.appName,
  };

  if (input.siteUrl !== undefined && input.siteUrl.length > 0) {
    headers["http-referer"] = input.siteUrl;
  }

  try {
    const response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0.4,
        max_tokens: input.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter request failed with HTTP ${response.status}.`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenRouterText(response: unknown): {
  text: string;
  model?: string;
} {
  if (!isRecord(response)) {
    throw new Error("OpenRouter response was not an object.");
  }

  const choices = response.choices;

  if (!Array.isArray(choices)) {
    throw new Error("OpenRouter response did not include choices.");
  }

  const firstChoice = choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenRouter response did not include a message.");
  }

  const content = firstChoice.message.content;
  const text = typeof content === "string" ? content.trim() : "";

  if (text.length === 0) {
    throw new Error("OpenRouter response text was empty.");
  }

  return {
    text,
    ...(typeof response.model === "string" ? { model: response.model } : {}),
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 20)}\n[truncated]`;
}

function envFlag(name: string): boolean | undefined {
  const value = envString(name);

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function envString(name: string): string | undefined {
  const value = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function optionalString<Key extends string>(
  key: Key,
  value: string | undefined,
): Partial<Record<Key, string>> {
  return value === undefined
    ? {}
    : ({ [key]: value } as Partial<Record<Key, string>>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
