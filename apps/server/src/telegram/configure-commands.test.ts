import { describe, expect, it } from "vitest";
import { telegramBotCommandMenu } from "./commands.js";
import { syncTelegramCommandMenu } from "./configure-commands.js";

describe("Telegram command menu sync", () => {
  it("sets the shared command catalog through the client", async () => {
    const stdout: string[] = [];
    const calls: unknown[] = [];
    const result = await syncTelegramCommandMenu({
      client: {
        async setMyCommands(commands) {
          calls.push(commands);
        },
      },
      stdout: (chunk) => stdout.push(chunk),
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(calls).toEqual([telegramBotCommandMenu]);
    expect(stdout.join("")).toContain(
      `Updated Telegram command menu with ${telegramBotCommandMenu.length} commands.`,
    );
  });

  it("returns a failing exit code without throwing when Telegram rejects commands", async () => {
    const stderr: string[] = [];
    const result = await syncTelegramCommandMenu({
      client: {
        async setMyCommands() {
          throw new Error("Telegram rejected commands");
        },
      },
      stderr: (chunk) => stderr.push(chunk),
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(stderr.join("")).toContain("Telegram rejected commands");
  });
});
