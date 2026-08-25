import { describe, expect, it } from "vitest";
import {
  clearFitnessWebSessionCookie,
  FITNESS_WEB_SESSION_COOKIE,
  issueFitnessWebSession,
  serializeFitnessWebSessionCookie,
  verifyFitnessWebSession,
} from "./web-session.js";

const SECRET = "0123456789abcdefghijklmnopqrstuvwxyz";

describe("fitness web sessions", () => {
  it("issues and verifies a signed session", () => {
    const issued = issueFitnessWebSession({
      userId: "alex",
      email: "Alex@Example.com",
      secret: SECRET,
      ttlSeconds: 60,
      now: 1_000,
    });

    expect(issued.session).toEqual({
      userId: "alex",
      email: "alex@example.com",
      issuedAt: 1_000,
      expiresAt: 1_060,
    });

    expect(
      verifyFitnessWebSession({
        token: issued.token,
        secret: SECRET,
        now: 1_030,
      }),
    ).toEqual(issued.session);
  });

  it("rejects expired or tampered sessions", () => {
    const issued = issueFitnessWebSession({
      userId: "alex",
      email: "alex@example.com",
      secret: SECRET,
      ttlSeconds: 60,
      now: 1_000,
    });

    expect(
      verifyFitnessWebSession({
        token: issued.token,
        secret: SECRET,
        now: 1_061,
      }),
    ).toBeUndefined();

    expect(
      verifyFitnessWebSession({
        token: `${issued.token}tampered`,
        secret: SECRET,
        now: 1_030,
      }),
    ).toBeUndefined();
  });

  it("serializes and clears secure http-only cookies", () => {
    expect(
      serializeFitnessWebSessionCookie({
        token: "abc.def",
        maxAgeSeconds: 60,
        secure: true,
      }),
    ).toContain(`${FITNESS_WEB_SESSION_COOKIE}=abc.def`);
    expect(clearFitnessWebSessionCookie(true)).toContain("Max-Age=0");
  });
});
