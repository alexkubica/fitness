import { NextRequest, NextResponse } from "next/server";
import {
  FITNESS_WEB_SESSION_COOKIE,
  issueFitnessWebSession,
} from "@fitness/auth";
import { googleConfig, webAuthUserId, webSessionTtlSeconds } from "@/lib/env";
import { authenticateGoogleWebCallback } from "@/lib/google-web-auth";

const GOOGLE_STATE_COOKIE = "fitness_web_google_state";

export async function GET(request: NextRequest): Promise<NextResponse> {
  let config: ReturnType<typeof googleConfig>;

  try {
    config = googleConfig();
  } catch {
    return googleErrorRedirect(request, "google_not_configured");
  }

  if (config === undefined) {
    return googleErrorRedirect(request, "google_not_configured");
  }

  try {
    const redirectUri = new URL(
      "/api/auth/google/callback",
      request.nextUrl.origin,
    ).toString();
    const callback = await authenticateGoogleWebCallback({
      code: request.nextUrl.searchParams.get("code"),
      config,
      expectedState: request.cookies.get(GOOGLE_STATE_COOKIE)?.value,
      redirectUri,
      state: request.nextUrl.searchParams.get("state"),
    });
    const issued = issueFitnessWebSession({
      email: callback.identity.email,
      secret: config.stateSecret,
      ttlSeconds: webSessionTtlSeconds(),
      userId: webAuthUserId(),
    });
    const response = NextResponse.redirect(
      new URL(callback.state.returnTo, request.nextUrl.origin),
    );

    response.cookies.set(FITNESS_WEB_SESSION_COOKIE, issued.token, {
      httpOnly: true,
      maxAge: issued.maxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    response.cookies.set(GOOGLE_STATE_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/api/auth/google/callback",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });

    return response;
  } catch {
    return googleErrorRedirect(request, "google_failed");
  }
}

function googleErrorRedirect(
  request: NextRequest,
  error: "google_failed" | "google_not_configured",
): NextResponse {
  const redirectUrl = new URL("/", request.nextUrl.origin);

  redirectUrl.searchParams.set("auth_error", error);

  return NextResponse.redirect(redirectUrl);
}
