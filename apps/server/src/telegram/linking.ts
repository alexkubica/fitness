import { randomUUID } from "node:crypto";
import type { NeonTelegramLinkingRepository } from "@fitness/db";

export type TelegramLinkToken = Readonly<{
  token: string;
  userId: string;
  state: string;
  nonce: string;
  expiresAt: string;
}>;

export type TelegramAccount = Readonly<{
  id: string;
  userId: string;
  telegramUserId: number;
  linkedAt: string;
  active: boolean;
  revokedAt?: string;
}>;

export type TelegramLinkingService = Readonly<{
  createLinkToken(input: {
    userId: string;
    state: string;
    nonce: string;
  }): TelegramLinkToken;
  consumeLinkToken(input: {
    token: string;
    state: string;
    nonce: string;
    telegramUserId: number;
  }): TelegramLinkConsumeResult;
  consumeOpaqueLinkToken(input: {
    token: string;
    telegramUserId: number;
  }): TelegramLinkConsumeResult;
  findActiveAccountByTelegramUserId(
    telegramUserId: number,
  ): TelegramAccount | undefined;
  unlinkTelegramUser(telegramUserId: number): TelegramAccount | "not-linked";
  listAccounts(): readonly TelegramAccount[];
}>;

export type AsyncTelegramLinkingService = Readonly<{
  createLinkToken(input: {
    userId: string;
    state: string;
    nonce: string;
  }): TelegramLinkToken | Promise<TelegramLinkToken>;
  consumeLinkToken(input: {
    token: string;
    state: string;
    nonce: string;
    telegramUserId: number;
  }): TelegramLinkConsumeResult | Promise<TelegramLinkConsumeResult>;
  consumeOpaqueLinkToken(input: {
    token: string;
    telegramUserId: number;
  }): TelegramLinkConsumeResult | Promise<TelegramLinkConsumeResult>;
  findActiveAccountByTelegramUserId(
    telegramUserId: number,
  ): TelegramAccount | undefined | Promise<TelegramAccount | undefined>;
  unlinkTelegramUser(
    telegramUserId: number,
  ): TelegramAccount | "not-linked" | Promise<TelegramAccount | "not-linked">;
}>;

export type TelegramLinkConsumeResult =
  | Readonly<{
      ok: true;
      account: TelegramAccount;
    }>
  | Readonly<{
      ok: false;
      error:
        | "account-mismatch"
        | "expired"
        | "nonce-mismatch"
        | "not-found"
        | "state-mismatch"
        | "used";
    }>;

export type TelegramLinkingServiceOptions = Readonly<{
  now?: () => Date;
  randomToken?: () => string;
  tokenTtlMs?: number;
}>;

type StoredTelegramLinkToken = TelegramLinkToken & {
  consumedAt?: string;
};

export function createTelegramLinkingService(
  options: TelegramLinkingServiceOptions = {},
): TelegramLinkingService {
  const now = options.now ?? (() => new Date());
  const randomToken = options.randomToken ?? randomLinkToken;
  const tokenTtlMs = options.tokenTtlMs ?? 5 * 60 * 1_000;
  const tokens = new Map<string, StoredTelegramLinkToken>();
  const accounts: TelegramAccount[] = [];
  let nextAccountId = 1;

  const consumeStoredLinkToken = (input: {
    token: string;
    state: string;
    nonce: string;
    telegramUserId: number;
  }): TelegramLinkConsumeResult => {
    const linkToken = tokens.get(input.token);

    if (linkToken === undefined) {
      return { ok: false, error: "not-found" };
    }

    if (linkToken.consumedAt !== undefined) {
      return { ok: false, error: "used" };
    }

    if (Date.parse(linkToken.expiresAt) <= now().getTime()) {
      return { ok: false, error: "expired" };
    }

    if (linkToken.state !== input.state) {
      return { ok: false, error: "state-mismatch" };
    }

    if (linkToken.nonce !== input.nonce) {
      return { ok: false, error: "nonce-mismatch" };
    }

    const activeAccount = findActiveAccount(accounts, input.telegramUserId);

    if (
      activeAccount !== undefined &&
      activeAccount.userId !== linkToken.userId
    ) {
      return { ok: false, error: "account-mismatch" };
    }

    const nowIso = now().toISOString();

    if (activeAccount !== undefined) {
      revokeAccount(activeAccount, nowIso);
    }

    linkToken.consumedAt = nowIso;

    const account: TelegramAccount = {
      id: `telegram_account_${nextAccountId}`,
      userId: linkToken.userId,
      telegramUserId: input.telegramUserId,
      linkedAt: nowIso,
      active: true,
    };

    nextAccountId += 1;
    accounts.push(account);

    return {
      ok: true,
      account: copyAccount(account),
    };
  };

  return {
    createLinkToken(input) {
      const token = randomToken();
      const linkToken: StoredTelegramLinkToken = {
        token,
        userId: input.userId,
        state: input.state,
        nonce: input.nonce,
        expiresAt: new Date(now().getTime() + tokenTtlMs).toISOString(),
      };

      tokens.set(token, linkToken);
      return copyLinkToken(linkToken);
    },
    consumeLinkToken(input) {
      return consumeStoredLinkToken(input);
    },
    consumeOpaqueLinkToken(input) {
      const linkToken = tokens.get(input.token);

      if (linkToken === undefined) {
        return { ok: false, error: "not-found" };
      }

      return consumeStoredLinkToken({
        token: input.token,
        state: linkToken.state,
        nonce: linkToken.nonce,
        telegramUserId: input.telegramUserId,
      });
    },
    findActiveAccountByTelegramUserId(telegramUserId) {
      const account = findActiveAccount(accounts, telegramUserId);

      return account === undefined ? undefined : copyAccount(account);
    },
    unlinkTelegramUser(telegramUserId) {
      const account = findActiveAccount(accounts, telegramUserId);

      if (account === undefined) {
        return "not-linked";
      }

      revokeAccount(account, now().toISOString());
      return copyAccount(account);
    },
    listAccounts() {
      return accounts.map(copyAccount);
    },
  };
}

export function createRepositoryTelegramLinkingService(
  repository: NeonTelegramLinkingRepository,
  options: TelegramLinkingServiceOptions = {},
): AsyncTelegramLinkingService {
  const now = options.now ?? (() => new Date());
  const randomToken = options.randomToken ?? randomLinkToken;
  const tokenTtlMs = options.tokenTtlMs ?? 5 * 60 * 1_000;

  return {
    createLinkToken(input) {
      const linkToken: TelegramLinkToken = {
        token: randomToken(),
        userId: input.userId,
        state: input.state,
        nonce: input.nonce,
        expiresAt: new Date(now().getTime() + tokenTtlMs).toISOString(),
      };

      return repository.createLinkToken(linkToken);
    },
    consumeLinkToken(input) {
      return repository.consumeLinkToken(input);
    },
    consumeOpaqueLinkToken(input) {
      return repository.consumeOpaqueLinkToken(input);
    },
    findActiveAccountByTelegramUserId(telegramUserId) {
      return repository.findActiveAccountByTelegramUserId(telegramUserId);
    },
    unlinkTelegramUser(telegramUserId) {
      return repository.unlinkTelegramUser(telegramUserId);
    },
  };
}

function findActiveAccount(
  accounts: readonly TelegramAccount[],
  telegramUserId: number,
): TelegramAccount | undefined {
  return accounts.find(
    (account) =>
      account.telegramUserId === telegramUserId && account.active === true,
  );
}

function revokeAccount(account: TelegramAccount, revokedAt: string): void {
  const mutableAccount = account as {
    active: boolean;
    revokedAt?: string;
  };

  mutableAccount.active = false;
  mutableAccount.revokedAt = revokedAt;
}

function copyLinkToken(token: TelegramLinkToken): TelegramLinkToken {
  return { ...token };
}

function copyAccount(account: TelegramAccount): TelegramAccount {
  return { ...account };
}

function randomLinkToken(): string {
  return randomUUID();
}
