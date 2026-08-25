import Link from "next/link";
import type { FitnessWebSession } from "@fitness/auth";
import { Activity, LogOut, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { webBuildLabel } from "@/lib/env";

export function SiteHeader({
  session,
}: Readonly<{
  session: FitnessWebSession | undefined;
}>) {
  const buildLabel = webBuildLabel();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          className="flex min-w-0 items-center gap-3 font-semibold"
          href="/"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
            <Activity className="size-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">Fitness Coach</span>
            <span className="truncate font-mono text-[10px] font-semibold text-muted-foreground">
              {buildLabel}
            </span>
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-2">
          {session === undefined ? null : (
            <Badge
              className="hidden max-w-52 truncate sm:inline-flex"
              variant="secondary"
            >
              {session.email}
            </Badge>
          )}
          {session === undefined ? null : (
            <Button
              asChild
              className="hidden sm:inline-flex"
              size="sm"
              variant="ghost"
            >
              <Link href="/mcp-setup">
                <PlugZap className="size-4" aria-hidden="true" />
                MCP
              </Link>
            </Button>
          )}
          {session === undefined ? (
            <Button asChild size="sm">
              <Link href="/api/auth/google/start?return_to=/">Sign in</Link>
            </Button>
          ) : (
            <form action="/api/auth/logout" method="post">
              <Button
                className="hidden sm:inline-flex"
                size="sm"
                type="submit"
                variant="outline"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
              <Button
                aria-label="Sign out"
                className="sm:hidden"
                size="icon"
                type="submit"
                variant="outline"
              >
                <LogOut className="size-4" aria-hidden="true" />
              </Button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
