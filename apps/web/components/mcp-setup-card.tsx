"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  ListChecks,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/apps#settings/Connectors";
const OPENAI_SUBMISSION_URL =
  "https://developers.openai.com/apps-sdk/deploy/submission";
const MCP_OAUTH_CLIENT_ID = "fitness-chatgpt";

export function McpSetupCard({
  endpoint,
}: Readonly<{
  endpoint: string;
}>) {
  const [copied, setCopied] = useState<string | undefined>();
  const cursorJson = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            fitme: {
              url: endpoint,
            },
          },
        },
        null,
        2,
      ),
    [endpoint],
  );

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(undefined), 1800);
  }

  return (
    <Card id="mcp-setup">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PlugZap className="size-5 text-primary" aria-hidden="true" />
              MCP setup
            </CardTitle>
            <CardDescription>
              Connect ChatGPT or another remote MCP client to the same
              normalized health data the mobile app syncs.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={CHATGPT_CONNECTORS_URL} rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" aria-hidden="true" />
              Open ChatGPT setup
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border border-border bg-card-soft p-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold">MCP endpoint</p>
              <code className="mt-1 block truncate rounded bg-background px-2 py-1 text-xs text-muted-foreground">
                {endpoint}
              </code>
            </div>
            <Button
              onClick={() => void copy("endpoint", endpoint)}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied === "endpoint" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clipboard className="size-4" aria-hidden="true" />
              )}
              {copied === "endpoint" ? "Copied" : "Copy URL"}
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card-soft p-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold">ChatGPT OAuth client ID</p>
              <code className="mt-1 block truncate rounded bg-background px-2 py-1 text-xs text-muted-foreground">
                {MCP_OAUTH_CLIENT_ID}
              </code>
              <p className="mt-2 text-xs text-muted-foreground">
                Use this when ChatGPT asks for a user-defined OAuth client ID.
                Do not use the Google OAuth client ID.
              </p>
            </div>
            <Button
              onClick={() => void copy("client-id", MCP_OAUTH_CLIENT_ID)}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied === "client-id" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clipboard className="size-4" aria-hidden="true" />
              )}
              {copied === "client-id" ? "Copied" : "Copy Client ID"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <SetupPanel title="ChatGPT" badge="Verified">
            <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
              <li>Open ChatGPT web settings.</li>
              <li>Go to Apps & Connectors, then Advanced settings.</li>
              <li>Enable developer mode if the Create button is hidden.</li>
              <li>Create a connector named Fitme.</li>
              <li>Paste the MCP endpoint.</li>
              <li>
                If ChatGPT asks for a client ID, paste{" "}
                <code>{MCP_OAUTH_CLIENT_ID}</code>.
              </li>
              <li>Complete Google OAuth with the allowed Google account.</li>
            </ol>
          </SetupPanel>

          <SetupPanel title="Claude" badge="Remote MCP">
            <p className="text-sm text-muted-foreground">
              Add a custom remote connector from Claude settings and use the
              endpoint above. Complete OAuth with the allowed Google account.
            </p>
          </SetupPanel>

          <SetupPanel title="Cursor / VS Code" badge="Config">
            <pre className="max-h-40 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
              {cursorJson}
            </pre>
            <Button
              className="mt-3"
              onClick={() => void copy("json", cursorJson)}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied === "json" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clipboard className="size-4" aria-hidden="true" />
              )}
              {copied === "json" ? "Copied" : "Copy JSON"}
            </Button>
          </SetupPanel>
        </div>

        <div className="rounded-md border border-border bg-card-soft p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <ListChecks className="size-4 text-primary" aria-hidden="true" />
            Available tools after connecting
          </h3>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <ToolGroup
              title="Read"
              tools={[
                "get_health_summary",
                "get_metric_timeseries",
                "generate_report",
                "get_meal_log",
                "get_coach_profile",
              ]}
            />
            <ToolGroup
              title="Food"
              tools={[
                "upsert_meal_log",
                "delete_meal_log: requires confirmDelete=true",
              ]}
            />
            <ToolGroup
              title="Coach"
              tools={["upsert_coach_profile", "generate_report"]}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Ask ChatGPT to create meals with `upsert_meal_log`, read history
            with `get_meal_log` over a date range, inspect stats with
            `get_health_summary`, and review a day by combining meals with
            health summaries. Apple Health writeback stays native-app only.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border bg-card-soft p-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p className="flex items-start gap-2">
            <ShieldCheck
              className="mt-0.5 size-4 text-primary"
              aria-hidden="true"
            />
            MCP clients get scoped OAuth tokens. They do not receive Telegram
            link tokens, iOS HealthKit sync tokens, database credentials, or
            direct Apple Health access.
          </p>
          <Button asChild size="sm" variant="ghost">
            <a href={OPENAI_SUBMISSION_URL} rel="noreferrer" target="_blank">
              Public app submission
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ToolGroup({
  title,
  tools,
}: Readonly<{
  title: string;
  tools: readonly string[];
}>) {
  return (
    <section>
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      <ul className="mt-2 grid gap-1">
        {tools.map((tool) => (
          <li
            className="rounded bg-background px-2 py-1 font-mono text-xs text-muted-foreground"
            key={tool}
          >
            {tool}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SetupPanel({
  badge,
  children,
  title,
}: Readonly<{
  badge: string;
  children: React.ReactNode;
  title: string;
}>) {
  return (
    <section className="rounded-md border border-border bg-card-soft p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {badge}
        </span>
      </div>
      {children}
    </section>
  );
}
