import type { NeonAuditRepository } from "@fitness/db";

export type AuditActor = Readonly<{
  type: "user" | "service";
  id: string;
}>;

export type AuditTarget = Readonly<{
  type: string;
  id: string;
}>;

export type AuditEventInput = Readonly<{
  action: string;
  actor: AuditActor;
  target: AuditTarget;
  userId: string;
  profileId?: string | undefined;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type AuditEvent = AuditEventInput &
  Readonly<{
    id: string;
    createdAt: string;
  }>;

export type AuditService = Readonly<{
  create(event: AuditEventInput): AuditEvent;
  list(): readonly AuditEvent[];
}>;

export type AuditPort = Readonly<{
  create(event: AuditEventInput): AuditEvent | Promise<AuditEvent>;
  list(): readonly AuditEvent[];
}>;

export type AuditServiceOptions = Readonly<{
  now?: () => Date;
}>;

export function createAuditService(
  options: AuditServiceOptions = {},
): AuditService {
  const events: AuditEvent[] = [];
  let nextId = 1;

  return {
    create(eventInput) {
      const event = deepFreeze({
        id: `audit_event_${nextId}`,
        ...deepClone(eventInput),
        createdAt: (options.now ?? (() => new Date()))().toISOString(),
      });

      nextId += 1;
      events.push(event);
      return copyAuditEvent(event);
    },
    list() {
      return events.map(copyAuditEvent);
    },
  };
}

export function createRepositoryAuditService(
  repository: NeonAuditRepository,
): AuditPort {
  return {
    create(event) {
      return repository.createAuditEvent(event);
    },
    list() {
      return [];
    },
  };
}

function copyAuditEvent(event: AuditEvent): AuditEvent {
  return deepFreeze(deepClone(event));
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}
