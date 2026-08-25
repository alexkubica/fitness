import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";
import {
  isFitnessTokenClaims,
  type FitnessTokenClaims,
} from "./token-claims.js";

export type FitnessJwtPublicJwk = JWK & Readonly<{ kid: string }>;
export type FitnessJwtPrivateJwk = JWK & Readonly<{ kid: string }>;

export type FitnessJwtKeyPair = Readonly<{
  keyId: string;
  privateJwk: FitnessJwtPrivateJwk;
  publicJwk: FitnessJwtPublicJwk;
}>;

export type FitnessJwks = Readonly<{
  keys: FitnessJwtPublicJwk[];
}>;

export type GenerateFitnessJwtKeyPairOptions = Readonly<{
  keyId: string;
}>;

export type SignFitnessJwtOptions = Readonly<{
  keyId: string;
  privateJwk: FitnessJwtPrivateJwk;
  now?: number | Date;
}>;

export type VerifyFitnessJwtOptions = Readonly<{
  jwks: FitnessJwks;
  issuer: string;
  audience: string | readonly string[];
  now?: number | Date;
}>;

const fitnessJwtAlgorithm = "RS256";

export async function generateFitnessJwtKeyPair(
  options: GenerateFitnessJwtKeyPairOptions,
): Promise<FitnessJwtKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(fitnessJwtAlgorithm, {
    extractable: true,
    modulusLength: 2048,
  });
  const privateJwk = withFitnessJwkMetadata(await exportJWK(privateKey), {
    keyId: options.keyId,
  });
  const publicJwk = withFitnessJwkMetadata(await exportJWK(publicKey), {
    keyId: options.keyId,
  });

  return {
    keyId: options.keyId,
    privateJwk,
    publicJwk,
  };
}

export function buildFitnessJwks(
  publicJwks: readonly FitnessJwtPublicJwk[],
): FitnessJwks {
  return {
    keys: publicJwks.map((publicJwk) => ({ ...publicJwk })),
  };
}

export function parseFitnessJwksJson(value: string): FitnessJwks {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid fitness JWKS JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.keys)) {
    throw new Error("Invalid fitness JWKS JSON: expected a keys array.");
  }

  return buildFitnessJwks(parsed.keys.map(parseFitnessJwtPublicJwk));
}

export async function signFitnessJwt(
  claims: FitnessTokenClaims,
  options: SignFitnessJwtOptions,
): Promise<string> {
  const privateKey = await importJWK(options.privateJwk, fitnessJwtAlgorithm);

  return new SignJWT(jwtPayloadForClaims(claims))
    .setProtectedHeader({
      alg: fitnessJwtAlgorithm,
      kid: options.keyId,
      typ: "JWT",
    })
    .sign(privateKey);
}

export async function verifyFitnessJwt(
  token: string,
  options: VerifyFitnessJwtOptions,
): Promise<FitnessTokenClaims> {
  if (token.split(".").length !== 3) {
    throw new Error("Malformed signed JWT.");
  }

  const result = await verifyCompactJwt(token, options);

  if (!isFitnessTokenClaims(result.payload)) {
    throw new Error("Malformed signed JWT claims.");
  }

  return result.payload;
}

async function verifyCompactJwt(
  token: string,
  options: VerifyFitnessJwtOptions,
) {
  try {
    return await jwtVerify(token, createLocalJWKSet(options.jwks), {
      algorithms: [fitnessJwtAlgorithm],
      audience: joseStringOrStringArray(options.audience),
      issuer: options.issuer,
      ...(options.now === undefined
        ? {}
        : { currentDate: dateFor(options.now) }),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Signed JWT verification failed: ${error.message}`);
    }

    throw new Error("Signed JWT verification failed.");
  }
}

function withFitnessJwkMetadata(
  jwk: JWK,
  options: { keyId: string },
): FitnessJwtPublicJwk {
  return {
    ...jwk,
    alg: fitnessJwtAlgorithm,
    kid: options.keyId,
    use: "sig",
  };
}

function parseFitnessJwtPublicJwk(value: unknown): FitnessJwtPublicJwk {
  if (!isRecord(value) || typeof value.kid !== "string") {
    throw new Error("Invalid fitness JWKS JSON: every key must include kid.");
  }

  return {
    ...(value as JWK),
    kid: value.kid,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jwtPayloadForClaims(claims: FitnessTokenClaims): JWTPayload {
  return {
    ...claims,
    aud: joseStringOrStringArray(claims.aud),
    ...(claims.resource === undefined
      ? {}
      : { resource: joseStringOrStringArray(claims.resource) }),
  };
}

function joseStringOrStringArray(
  value: string | readonly string[],
): string | string[] {
  return typeof value === "string" ? value : [...value];
}

function dateFor(now: number | Date): Date {
  if (now instanceof Date) {
    return now;
  }

  return new Date(now * 1000);
}
