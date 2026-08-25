import { NextRequest, NextResponse } from "next/server";
import { googleConfig } from "@/lib/env";
import {
  createGoogleWebAuthorization,
  safeReturnPath,
} from "@/lib/google-web-auth";

const GOOGLE_STATE_COOKIE = "fitness_web_google_state";

export function GET(request: NextRequest): NextResponse {
  let config: ReturnType<typeof googleConfig>;

  try {
    config = googleConfig();
  } catch {
    return googleConfigErrorRedirect(request);
  }

  if (config === undefined) {
    return googleConfigErrorRedirect(request);
  }

  const redirectUri = new URL(
    "/api/auth/google/callback",
    request.nextUrl.origin,
  ).toString();
  const authorization = createGoogleWebAuthorization({
    config,
    redirectUri,
    returnTo: safeReturnPath(request.nextUrl.searchParams.get("return_to")),
  });
  const response = NextResponse.redirect(authorization.authorizationUrl);

  response.cookies.set(GOOGLE_STATE_COOKIE, authorization.state, {
    httpOnly: true,
    maxAge: authorization.maxAgeSeconds,
    path: "/api/auth/google/callback",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}

function googleConfigErrorRedirect(request: NextRequest): NextResponse {
  const returnTo = safeReturnPath(
    request.nextUrl.searchParams.get("return_to"),
  );
  const redirectUrl = new URL(returnTo, request.nextUrl.origin);

  redirectUrl.searchParams.set("auth_error", "google_not_configured");

  return NextResponse.redirect(redirectUrl);
}
