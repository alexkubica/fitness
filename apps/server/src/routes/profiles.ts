import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import {
  AuthorizationError,
  type AuthorizationService,
} from "../services/authorization.js";
import {
  ProfileAccessError,
  type ProfileContext,
  type ProfileService,
} from "../services/profiles.js";

export type ProfileRoutesServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  profiles: ProfileService;
}>;

type JsonRequest = Readonly<{
  json(): Promise<unknown>;
}>;

type ValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; message: string; status: 400 }>;

export function registerProfileRoutes(
  app: Hono<ServerEnv>,
  services: ProfileRoutesServices,
): void {
  app.get("/api/profiles", async (context) => {
    const auth = context.get("auth");
    const profiles = await services.profiles.listAccessibleProfiles(
      auth.actorUserId,
    );

    return context.json({ profiles });
  });

  app.get("/api/profiles/:profileId", async (context) => {
    const auth = context.get("auth");
    const result = await getProfileContext(
      services.profiles,
      services.authorization,
      auth.actorUserId,
      context.req.param("profileId"),
      "profile.read",
      context.req.header("x-request-id"),
    );

    if (result.ok === false) {
      return context.json({ error: result.error }, result.status);
    }

    return context.json({ profile: profileResponse(result.value) });
  });

  app.get("/api/profiles/:profileId/access", async (context) => {
    const auth = context.get("auth");
    const result = await getProfileContext(
      services.profiles,
      services.authorization,
      auth.actorUserId,
      context.req.param("profileId"),
      "profile.read",
      context.req.header("x-request-id"),
    );

    if (result.ok === false) {
      return context.json({ error: result.error }, result.status);
    }

    return context.json({
      access: result.value.access,
      profile: result.value.profile,
    });
  });

  app.post("/api/profiles/managed", async (context) => {
    const auth = context.get("auth");
    const payload = await parseManagedProfileRequest(context.req);

    if (payload.ok === false) {
      return context.json(
        { error: "invalid-payload", message: payload.message },
        payload.status,
      );
    }

    const profile = await services.profiles.createManagedProfile(
      auth.actorUserId,
      payload.value,
    );

    await services.audit.create({
      action: "profile.managed.create",
      actor: auth.actor,
      profileId: profile.profileId,
      target: {
        type: "health_profile",
        id: profile.profileId,
      },
      userId: profile.subjectUserId,
      metadata: {
        profileId: profile.profileId,
        profileType: profile.profile.profileType,
        relationship: profile.access.relationship,
        roleIdentifier: profile.access.roleIdentifier,
      },
    });

    return context.json({ profile: profileResponse(profile) }, 201);
  });
}

async function parseManagedProfileRequest(request: JsonRequest): Promise<
  ValidationResult<{
    displayName: string;
    avatarUrl?: string | undefined;
    timezone: string;
    relationship?: string | undefined;
    roleIdentifier?: string | undefined;
  }>
> {
  try {
    return parseManagedProfilePayload(await request.json());
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseManagedProfilePayload(value: unknown): ValidationResult<{
  displayName: string;
  avatarUrl?: string | undefined;
  timezone: string;
  relationship?: string | undefined;
  roleIdentifier?: string | undefined;
}> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const displayName = boundedString(value.displayName, "displayName", 120);
  const avatarUrl = optionalBoundedString(value.avatarUrl, "avatarUrl", 500);
  const timezone = optionalBoundedString(value.timezone, "timezone", 80);
  const relationship = optionalBoundedString(
    value.relationship,
    "relationship",
    80,
  );
  const roleIdentifier = optionalBoundedString(
    value.roleIdentifier,
    "roleIdentifier",
    120,
  );

  if (displayName.ok === false) return displayName;
  if (avatarUrl.ok === false) return avatarUrl;
  if (timezone.ok === false) return timezone;
  if (relationship.ok === false) return relationship;
  if (roleIdentifier.ok === false) return roleIdentifier;

  return {
    ok: true,
    value: {
      displayName: displayName.value,
      avatarUrl: avatarUrl.value,
      timezone: timezone.value ?? "UTC",
      relationship: relationship.value,
      roleIdentifier: roleIdentifier.value,
    },
  };
}

function profileResponse(context: ProfileContext) {
  return {
    profileId: context.profileId,
    displayName: context.profile.displayName,
    avatar: context.profile.avatarUrl,
    linkedUserId: context.profile.linkedUserId,
    ownerUserId: context.profile.ownerUserId,
    profileType: context.profile.profileType,
    timezone: context.profile.timezone,
    relationship: context.access.relationship,
    roleIdentifier: context.access.roleIdentifier,
    ownershipStatus:
      context.profile.ownerUserId === context.actorUserId
        ? ("owner" as const)
        : ("accessible" as const),
    isOwner: context.profile.ownerUserId === context.actorUserId,
    isManaged: context.profile.profileType === "managed",
    accessStatus: context.access.status,
    expiresAt: context.access.expiresAt,
    permissions: context.permissions,
    createdAt: context.profile.createdAt,
    updatedAt: context.profile.updatedAt,
  };
}

async function getProfileContext(
  profiles: ProfileService,
  authorization: AuthorizationService,
  actorUserId: string,
  profileId: string,
  permission: "profile.read",
  requestId: string | undefined,
): Promise<
  | Readonly<{ ok: true; value: ProfileContext }>
  | Readonly<{ ok: false; error: string; status: 403 | 404 }>
> {
  try {
    await authorization.requirePermission(actorUserId, profileId, permission, {
      requestedAction: "profile.read",
      requestId,
    });
    const value = await profiles.getProfile(actorUserId, profileId);

    return {
      ok: true,
      value,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        error: error.code,
        status: error.code === "PROFILE_NOT_ACCESSIBLE" ? 404 : 403,
      };
    }
    if (error instanceof ProfileAccessError) {
      return {
        ok: false,
        error: error.code,
        status: error.code === "profile-not-found" ? 404 : 403,
      };
    }

    throw error;
  }
}

function boundedString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid(`Payload ${name} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be 1-${maxChars} characters.`);
  }

  return { ok: true, value: trimmed };
}

function optionalBoundedString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }

  return boundedString(value, name, maxChars);
}

function invalid(message: string): ValidationResult<never> {
  return {
    ok: false,
    message,
    status: 400,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
