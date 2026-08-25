export type TelegramBotCommandDefinition = Readonly<{
  command: string;
  description: string;
  detail: string;
}>;

export const telegramBotCommands = [
  {
    command: "start",
    description: "Open the bot and linking help",
    detail: "Start or relink the bot.",
  },
  {
    command: "help",
    description: "Show commands and examples",
    detail: "Show this command list.",
  },
  {
    command: "coach",
    description: "Ask the smart coach",
    detail: "Ask the coach. Plain text DMs also work after linking.",
  },
  {
    command: "log",
    description: "Log a meal note",
    detail: "Log meal text, for example: /log Greek yogurt and berries.",
  },
  {
    command: "checkin",
    description: "Log hunger, mood, energy, stress",
    detail:
      "Log scores: /checkin hunger=6 mood=7 energy=5 stress=4 cravings=2 notes=optional.",
  },
  {
    command: "report",
    description: "Get deterministic daily report",
    detail: "Show the latest deterministic daily health/check-in report.",
  },
  {
    command: "settings",
    description: "View or change reminders",
    detail: "View settings or use: /settings reminders on/off.",
  },
  {
    command: "link",
    description: "Link Telegram to your account",
    detail: "Open the authenticated account-linking flow.",
  },
  {
    command: "unlink",
    description: "Disconnect Telegram",
    detail: "Disconnect this Telegram account.",
  },
] as const satisfies readonly TelegramBotCommandDefinition[];

export const telegramBotCommandMenu = telegramBotCommands.map((command) => ({
  command: command.command,
  description: command.description,
}));

export function formatTelegramCommandHelp(input: {
  linked: boolean;
  linkUrl?: string | undefined;
  prefix?: string | undefined;
}): string {
  const lines = [
    ...(input.prefix === undefined ? [] : [input.prefix, ""]),
    "Fitness Coach commands",
    "",
    ...telegramBotCommands.map(
      (command) => `/${command.command} - ${command.detail}`,
    ),
    "",
    input.linked
      ? "You can also DM a plain question and I will answer as coach."
      : linkInstruction(input.linkUrl),
  ];

  return lines.join("\n");
}

function linkInstruction(linkUrl: string | undefined): string {
  if (linkUrl === undefined) {
    return "Link this Telegram account first: use /link, then open the authenticated link flow.";
  }

  return `Link this Telegram account first: open ${linkUrl}, sign in, then tap the Telegram link.`;
}
