import { McpSetupCard } from "@/components/mcp-setup-card";
import { SiteHeader } from "@/components/site-header";
import { currentWebSession } from "@/lib/auth";
import { mcpEndpoint } from "@/lib/env";

export default async function McpSetupPage() {
  const session = await currentWebSession();

  return (
    <>
      <SiteHeader session={session} />
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section>
          <p className="text-sm font-semibold uppercase text-primary">
            Assistant connections
          </p>
          <h1 className="mt-2 text-3xl font-black">
            Connect Fitme to ChatGPT and other MCP clients
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Copy the endpoint, open the client setup screen, and authenticate
            with Google. The client receives only scoped OAuth access to
            approved Fitness Coach tools.
          </p>
        </section>
        <McpSetupCard endpoint={mcpEndpoint()} />
      </main>
    </>
  );
}
