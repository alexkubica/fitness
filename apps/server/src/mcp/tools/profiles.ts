import type { ProfileService } from "../../services/profiles.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

export const LIST_ACCESSIBLE_PROFILES_TOOL_NAME = "list_accessible_profiles";
export const GET_PROFILE_TOOL_NAME = "get_profile";
export const GET_PROFILE_ACCESS_TOOL_NAME = "get_profile_access";

export const listAccessibleProfilesInputSchema = {};

export const listAccessibleProfilesOutputSchema = {
  profiles: z.array(z.record(z.string(), z.unknown())),
};

export const getProfileInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
};

export const getProfileOutputSchema = {
  profile: z.record(z.string(), z.unknown()),
};

export const getProfileAccessInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
};

export const getProfileAccessOutputSchema = {
  access: z.record(z.string(), z.unknown()),
  profile: z.record(z.string(), z.unknown()),
};

export async function listAccessibleProfilesToolResult(input: {
  actorUserId: string;
  profiles: ProfileService;
}): Promise<CallToolResult> {
  const profiles = (
    await input.profiles.listAccessibleProfiles(input.actorUserId)
  ).filter((profile) => profile.permissions.includes("profile.read"));

  return {
    content: [
      {
        type: "text",
        text:
          profiles.length === 0
            ? "No accessible health profiles found."
            : [
                "Accessible health profiles:",
                ...profiles.map(
                  (profile) =>
                    `- ${profile.profileId}: ${profile.displayName} (${profile.relationship}, ${profile.ownershipStatus})`,
                ),
              ].join("\n"),
      },
    ],
    structuredContent: {
      profiles,
    },
  };
}

export async function getProfileToolResult(input: {
  actorUserId: string;
  profileId?: string | undefined;
  profiles: ProfileService;
}): Promise<CallToolResult> {
  const context = await input.profiles.requireProfileContext(
    input.actorUserId,
    input.profileId,
  );
  const profile = {
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

  return {
    content: [
      {
        type: "text",
        text: `${profile.displayName}: ${profile.profileId} (${profile.relationship}, ${profile.ownershipStatus}).`,
      },
    ],
    structuredContent: {
      profile,
    },
  };
}

export async function getProfileAccessToolResult(input: {
  actorUserId: string;
  profileId?: string | undefined;
  profiles: ProfileService;
}): Promise<CallToolResult> {
  const context = await input.profiles.requireProfileContext(
    input.actorUserId,
    input.profileId,
  );

  return {
    content: [
      {
        type: "text",
        text: `Access to ${context.profile.displayName}: ${context.access.relationship}, role ${context.access.roleIdentifier}, status ${context.access.status}.`,
      },
    ],
    structuredContent: {
      access: {
        ...context.access,
        permissions: context.permissions,
      },
      profile: context.profile,
    },
  };
}
