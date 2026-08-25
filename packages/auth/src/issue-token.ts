#!/usr/bin/env node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  issueFitnessProfileToken,
  type FitnessTokenProfile,
} from "./private-token-issuer.js";
import { isAuthScope, type AuthScope } from "./scopes.js";
import type { FitnessJwtPrivateJwk } from "./signed-tokens.js";

export type IssueFitnessTokenCliEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type IssueFitnessTokenCliOptions = Readonly<{
  argv: readonly string[];
  env: IssueFitnessTokenCliEnvironment;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  readKeychainGenericPassword?: (service: string) => Promise<string>;
}>;

export type IssueFitnessTokenCliResult = Readonly<{
  exitCode: number;
}>;

type OutputMode = "json" | "raw";

type ParsedIssueTokenArgs = Readonly<{
  profile: FitnessTokenProfile;
  ttlSeconds?: number;
  tokenId?: string;
  now?: number;
  issuer?: string;
  audience?: string;
  resource?: string;
  subject?: string;
  scopes?: readonly AuthScope[];
  outputMode: OutputMode;
}>;

const execFileAsync = promisify(execFile);

export async function runIssueFitnessTokenCli(
  options: IssueFitnessTokenCliOptions,
): Promise<IssueFitnessTokenCliResult> {
  try {
    const args = parseArgs(options.argv);
    const privateJwk = await privateJwkFromInput(options);
    const issued = await issueFitnessProfileToken({
      profile: args.profile,
      privateJwk,
      ...(args.ttlSeconds === undefined ? {} : { ttlSeconds: args.ttlSeconds }),
      ...(args.tokenId === undefined ? {} : { tokenId: args.tokenId }),
      ...(args.now === undefined ? {} : { now: args.now }),
      ...(args.scopes === undefined ? {} : { scopes: args.scopes }),
      ...profileConfigFromEnv(args.profile, options.env),
      ...profileConfigFromArgs(args),
    });

    if (args.outputMode === "json") {
      options.stdout(
        `${JSON.stringify({
          accessToken: issued.token,
          tokenType: "Bearer",
          profile: args.profile,
          expiresAt: new Date(issued.claims.exp * 1000).toISOString(),
          scopes: issued.claims.scope
            .split(/\s+/u)
            .filter((scope) => scope.length > 0),
        })}\n`,
      );
    } else {
      options.stdout(`${issued.token}\n`);
    }

    return { exitCode: 0 };
  } catch (error) {
    options.stderr(`${errorMessage(error)}\n`);
    return { exitCode: 1 };
  }
}

function parseArgs(argv: readonly string[]): ParsedIssueTokenArgs {
  let profile: FitnessTokenProfile | undefined;
  let ttlSeconds: number | undefined;
  let tokenId: string | undefined;
  let now: number | undefined;
  let issuer: string | undefined;
  let audience: string | undefined;
  let resource: string | undefined;
  let subject: string | undefined;
  const scopes: AuthScope[] = [];
  let outputMode: OutputMode = "raw";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--profile":
        profile = parseProfile(readRequiredValue(argv, index, arg));
        index += 1;
        break;
      case "--ttl-seconds":
        ttlSeconds = parseIntegerArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--token-id":
        tokenId = readRequiredValue(argv, index, arg);
        index += 1;
        break;
      case "--issuer":
        issuer = parsedStringArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--audience":
        audience = parsedStringArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--resource":
        resource = parsedStringArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--subject":
        subject = parsedStringArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--scope":
        scopes.push(parseScope(readRequiredValue(argv, index, arg)));
        index += 1;
        break;
      case "--now":
        now = parseIntegerArg(readRequiredValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--json":
        outputMode = "json";
        break;
      case "--raw":
        outputMode = "raw";
        break;
      default:
        throw new Error(`Unknown argument "${arg}".`);
    }
  }

  if (profile === undefined) {
    throw new Error("Missing required --profile mcp|healthkit argument.");
  }

  return {
    profile,
    outputMode,
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    ...(tokenId === undefined ? {} : { tokenId }),
    ...(now === undefined ? {} : { now }),
    ...(issuer === undefined ? {} : { issuer }),
    ...(audience === undefined ? {} : { audience }),
    ...(resource === undefined ? {} : { resource }),
    ...(subject === undefined ? {} : { subject }),
    ...(scopes.length === 0 ? {} : { scopes }),
  };
}

function parseProfile(value: string): FitnessTokenProfile {
  if (value === "mcp" || value === "healthkit") {
    return value;
  }

  throw new Error(`Invalid --profile "${value}".`);
}

function readRequiredValue(
  argv: readonly string[],
  index: number,
  name: string,
): string {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

function parseIntegerArg(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer.`);
  }

  return parsed;
}

function parsedStringArg(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty.`);
  }

  return value;
}

function parseScope(value: string): AuthScope {
  if (!isAuthScope(value)) {
    throw new Error(`Unknown scope "${value}".`);
  }

  return value;
}

async function privateJwkFromInput(
  options: IssueFitnessTokenCliOptions,
): Promise<FitnessJwtPrivateJwk> {
  const value = envString(options.env, "FITNESS_AUTH_PRIVATE_JWK");

  if (value !== undefined) {
    return parsePrivateJwk(value, "FITNESS_AUTH_PRIVATE_JWK");
  }

  const keychainService = envString(
    options.env,
    "FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE",
  );

  if (keychainService === undefined) {
    throw new Error(
      "Missing private JWK. Set FITNESS_AUTH_PRIVATE_JWK or configure Keychain input.",
    );
  }

  const readKeychainGenericPassword =
    options.readKeychainGenericPassword ?? readMacosKeychainGenericPassword;

  return parsePrivateJwk(
    await readKeychainGenericPassword(keychainService),
    "Keychain private JWK",
  );
}

function parsePrivateJwk(
  value: string,
  sourceDescription: string,
): FitnessJwtPrivateJwk {
  try {
    return JSON.parse(value) as FitnessJwtPrivateJwk;
  } catch {
    throw new Error(
      `${sourceDescription} must contain a private JWK JSON object.`,
    );
  }
}

function profileConfigFromEnv(
  profile: FitnessTokenProfile,
  env: IssueFitnessTokenCliEnvironment,
): Partial<{
  issuer: string;
  audience: string;
  resource: string;
  subject: string;
  scopes: readonly AuthScope[];
}> {
  if (profile === "mcp") {
    return optionalValues({
      issuer: envString(env, "MCP_ISSUER_URL"),
      audience: envString(env, "MCP_AUDIENCE"),
      resource: envString(env, "MCP_RESOURCE_URL"),
      subject: envString(env, "MCP_EXPECTED_SUBJECT"),
    });
  }

  return optionalValues({
    issuer: envString(env, "HEALTH_SYNC_TOKEN_ISSUER"),
    audience: envString(env, "HEALTH_SYNC_TOKEN_AUDIENCE"),
    resource: envString(env, "HEALTH_SYNC_TOKEN_RESOURCE"),
    subject: envString(env, "HEALTH_SYNC_EXPECTED_SUBJECT"),
  });
}

function profileConfigFromArgs(args: ParsedIssueTokenArgs): Partial<{
  issuer: string;
  audience: string;
  resource: string;
  subject: string;
}> {
  return optionalValues({
    issuer: args.issuer,
    audience: args.audience,
    resource: args.resource,
    subject: args.subject,
  });
}

function optionalValues<T extends Record<string, string | undefined>>(
  values: T,
): Partial<Record<keyof T, string>> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => {
      return entry[1] !== undefined;
    }),
  ) as Partial<Record<keyof T, string>>;
}

function envString(
  env: IssueFitnessTokenCliEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Token issuance failed.";
}

async function readMacosKeychainGenericPassword(
  service: string,
): Promise<string> {
  try {
    const result = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-w",
    ]);

    return result.stdout.trim();
  } catch {
    throw new Error(
      `Unable to read private JWK from macOS Keychain service "${service}".`,
    );
  }
}

function isDirectRun(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const result = await runIssueFitnessTokenCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: (chunk) => {
      process.stdout.write(chunk);
    },
    stderr: (chunk) => {
      process.stderr.write(chunk);
    },
  });

  process.exitCode = result.exitCode;
}
