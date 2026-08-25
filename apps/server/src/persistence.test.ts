import { describe, expect, it } from "vitest";
import {
  createPersistenceServices,
  resolvePersistenceMode,
} from "./persistence.js";

describe("server persistence wiring", () => {
  it("defaults to in-memory services unless Neon persistence is explicit", () => {
    expect(resolvePersistenceMode({})).toBe("memory");
    expect(createPersistenceServices({})).toEqual({});
  });

  it("creates health read/write services when Neon persistence is explicit", () => {
    const services = createPersistenceServices({
      FITNESS_PERSISTENCE: "neon",
      DATABASE_URL: "postgresql://fitness:fitness@localhost:5432/fitness_dev",
    });

    expect(Object.keys(services).sort()).toEqual([
      "audit",
      "authorization",
      "coach",
      "eatingCheckIns",
      "healthRead",
      "healthSync",
      "mealPlans",
      "mealSnapshots",
      "meals",
      "oauth",
      "profiles",
      "reports",
      "targetPlans",
      "telegramLinking",
      "telegramReminders",
      "telegramStorage",
    ]);
  });

  it("does not allow fake auth tokens against a non-local Neon database", () => {
    expect(() =>
      createPersistenceServices({
        FITNESS_PERSISTENCE: "neon",
        ALLOW_FAKE_AUTH_TOKENS: "1",
        DATABASE_URL: "postgresql://user:secret@example.neon.tech/db",
      }),
    ).toThrow(/fake auth/i);
  });
});
