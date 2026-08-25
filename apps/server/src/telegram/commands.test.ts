import { describe, expect, it } from "vitest";
import {
  formatTelegramCommandHelp,
  telegramBotCommandMenu,
  telegramBotCommands,
} from "./commands.js";

describe("Telegram command catalog", () => {
  it("keeps Bot API command menu entries valid and useful", () => {
    expect(telegramBotCommandMenu).toHaveLength(telegramBotCommands.length);

    for (const command of telegramBotCommandMenu) {
      expect(command.command).toMatch(/^[a-z0-9_]{1,32}$/u);
      expect(command.description.length).toBeGreaterThanOrEqual(3);
      expect(command.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("formats linked help with commands and plain-text coach guidance", () => {
    const text = formatTelegramCommandHelp({
      linked: true,
    });

    expect(text).toContain("Fitness Coach commands");
    expect(text).toContain("/coach - Ask the coach");
    expect(text).toContain("/checkin - Log scores");
    expect(text).toContain("plain question");
    expect(text).not.toContain("https://fitness.example");
  });

  it("formats unlinked help with the authenticated link URL", () => {
    const text = formatTelegramCommandHelp({
      linked: false,
      linkUrl: "https://fitness.example/telegram/link",
    });

    expect(text).toContain("/link - Open the authenticated account-linking");
    expect(text).toContain("https://fitness.example/telegram/link");
  });
});
