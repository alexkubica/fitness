import { describe, expect, it } from "vitest";
import { createRepositoryAuditService } from "./audit.js";

describe("repository-backed audit service", () => {
  it("delegates append-only audit events to a durable repository", async () => {
    const calls: unknown[] = [];
    const audit = createRepositoryAuditService({
      async createAuditEvent(input) {
        calls.push(input);

        return {
          id: "audit-event-1",
          ...input,
          createdAt: "2026-06-11T12:00:00.000Z",
        };
      },
    });

    const event = await audit.create({
      action: "health.samples.ingest",
      actor: {
        type: "user",
        id: "user_alex",
      },
      target: {
        type: "health_samples",
        id: "healthkit-batch-1",
      },
      userId: "user_alex",
      metadata: {
        accepted: 1,
      },
    });

    expect(event.id).toBe("audit-event-1");
    expect(calls).toHaveLength(1);
  });
});
