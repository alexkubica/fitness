import { describe, expect, it } from "vitest";
import { createRepositoryTelegramLinkingService } from "./linking.js";

describe("repository-backed Telegram linking service", () => {
  it("creates short-lived raw link tokens through the durable repository", async () => {
    const calls: unknown[] = [];
    const linking = createRepositoryTelegramLinkingService(
      {
        async createLinkToken(input) {
          calls.push(input);
          return input;
        },
        async consumeLinkToken() {
          throw new Error("not used");
        },
        async consumeOpaqueLinkToken(input) {
          calls.push(input);
          return {
            ok: false,
            error: "not-found",
          };
        },
        async findActiveAccountByTelegramUserId() {
          return undefined;
        },
        async unlinkTelegramUser() {
          return "not-linked";
        },
      },
      {
        now: () => new Date("2026-06-11T12:00:00.000Z"),
        randomToken: () => "raw-link-token",
        tokenTtlMs: 5 * 60 * 1_000,
      },
    );

    const linkToken = await linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });

    expect(linkToken).toEqual({
      token: "raw-link-token",
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
      expiresAt: "2026-06-11T12:05:00.000Z",
    });
    expect(calls).toEqual([
      {
        token: "raw-link-token",
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
        expiresAt: "2026-06-11T12:05:00.000Z",
      },
    ]);

    await expect(
      linking.consumeOpaqueLinkToken({
        token: "raw-link-token",
        telegramUserId: 12_345,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "not-found",
    });
    expect(calls.at(-1)).toEqual({
      token: "raw-link-token",
      telegramUserId: 12_345,
    });
  });
});
