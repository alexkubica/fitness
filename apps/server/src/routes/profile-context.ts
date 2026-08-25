import {
  ProfileAccessError,
  type ProfileContext,
  type ProfileService,
} from "../services/profiles.js";
import {
  AuthorizationError,
  type AuthorizationService,
} from "../services/authorization.js";
import type { ProfilePermission } from "@fitness/auth";

export type RouteProfileContextResult =
  | Readonly<{ ok: true; value: ProfileContext }>
  | Readonly<{
      ok: false;
      error: string;
      status: 403 | 404;
      requiredPermission?: string | undefined;
      requestedAction?: string | undefined;
      requestId?: string | undefined;
    }>;

export async function resolveRouteProfileContext(
  profiles: ProfileService,
  actorUserId: string,
  profileId: string | undefined,
  authorization?: AuthorizationService | undefined,
  permission?: ProfilePermission | undefined,
  requestedAction?: string | undefined,
  requestId?: string | undefined,
): Promise<RouteProfileContextResult> {
  try {
    if (
      profileId !== undefined &&
      authorization !== undefined &&
      permission !== undefined
    ) {
      await authorization.requirePermission(
        actorUserId,
        profileId,
        permission,
        { requestedAction, requestId },
      );
    }

    const value = await profiles.requireProfileContext(actorUserId, profileId);

    if (
      profileId === undefined &&
      authorization !== undefined &&
      permission !== undefined
    ) {
      await authorization.requirePermission(
        actorUserId,
        value.profileId,
        permission,
        { requestedAction, requestId },
      );
    }

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
        requiredPermission: error.requiredPermission,
        requestedAction: error.requestedAction,
        requestId: error.requestId,
      };
    }

    if (error instanceof ProfileAccessError) {
      return {
        ok: false,
        error:
          error.code === "profile-not-found"
            ? "PROFILE_NOT_ACCESSIBLE"
            : "PERMISSION_DENIED",
        status: error.code === "profile-not-found" ? 404 : 403,
      };
    }

    throw error;
  }
}

export function routeProfileErrorBody(
  result: Extract<RouteProfileContextResult, { ok: false }>,
): Record<string, string> {
  return {
    error: result.error,
    ...(result.requiredPermission === undefined
      ? {}
      : { requiredPermission: result.requiredPermission }),
    ...(result.requestedAction === undefined
      ? {}
      : { requestedAction: result.requestedAction }),
    ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
  };
}
