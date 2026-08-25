import { NextRequest, NextResponse } from "next/server";
import { FITNESS_WEB_SESSION_COOKIE } from "@fitness/auth";

export function POST(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin));

  response.cookies.set(FITNESS_WEB_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}
