import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenRouterTelegramCoach,
  resolveTelegramLlmCoach,
  type OpenRouterFetch,
} from "./llm-coach.js";

const baseNow = new Date("2026-06-15T09:00:00.000Z");

describe("OpenRouter Telegram coach", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts minimized coach context to the OpenRouter chat completion API", async () => {
    const requests: {
      url: string;
      body: unknown;
      headers: Readonly<Record<string, string>>;
    }[] = [];
    const fetcher: OpenRouterFetch = async (url, init) => {
      requests.push({
        url,
        body: JSON.parse(init.body) as unknown,
        headers: init.headers,
      });

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            model: "meta-llama/llama-3.2-3b-instruct:free",
            choices: [
              {
                message: {
                  content: " Add protein and keep dinner normal. ",
                },
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const coach = createOpenRouterTelegramCoach({
      apiKey: "sk-or-test",
      appName: "Fitme Test",
      fetch: fetcher,
      model: "openrouter/free",
      siteUrl: "https://fitness.example",
    });

    const reply = await coach.reply({
      userId: "user_alex",
      telegramUserId: 12_345,
      messageText: "What should I eat after training?",
      reportText: "Daily coach report\nSteps: 10,000\nSleep: 7h.",
      now: baseNow,
    });

    expect(reply).toEqual({
      text: "Add protein and keep dinner normal.",
      provider: "openrouter",
      model: "meta-llama/llama-3.2-3b-instruct:free",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        authorization: "Bearer sk-or-test",
        "content-type": "application/json",
        "http-referer": "https://fitness.example",
        "x-openrouter-title": "Fitme Test",
      },
    });
    expect(requests[0]?.body).toMatchObject({
      model: "openrouter/free",
      temperature: 0.4,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Do not diagnose disease"),
        },
        {
          role: "user",
          content: expect.stringContaining("What should I eat after training?"),
        },
      ],
    });
    expect(JSON.stringify(requests[0]?.body)).toContain("Daily coach report");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("user_alex");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("12345");
  });

  it("throws redacted provider errors without exposing the API key", async () => {
    const coach = createOpenRouterTelegramCoach({
      apiKey: "sk-or-secret",
      fetch: async () => ({
        ok: false,
        status: 429,
        async json() {
          return {};
        },
        async text() {
          return "rate limited";
        },
      }),
    });

    try {
      await coach.reply({
        userId: "user_alex",
        telegramUserId: 12_345,
        messageText: "hello",
        now: baseNow,
      });
      throw new Error("expected OpenRouter failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("HTTP 429");
      expect((error as Error).message).not.toContain("sk-or-secret");
    }
  });

  it("stays disabled unless explicitly enabled", () => {
    expect(resolveTelegramLlmCoach()).toBeUndefined();
  });

  it("requires an OpenRouter API key when enabled", () => {
    vi.stubEnv("TELEGRAM_COACH_LLM_ENABLED", "1");

    expect(() => resolveTelegramLlmCoach()).toThrow("OPENROUTER_API_KEY");
  });

  it("creates an OpenRouter coach when enabled with an API key", () => {
    vi.stubEnv("TELEGRAM_COACH_LLM_ENABLED", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");

    expect(resolveTelegramLlmCoach()).toMatchObject({
      reply: expect.any(Function),
    });
  });
});
