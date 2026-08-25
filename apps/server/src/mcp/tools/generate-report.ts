import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { CoachReportPort } from "../../services/coach-report.js";
import type { HealthReadRange } from "../../services/health-read.js";

export const GENERATE_REPORT_TOOL_NAME = "generate_report";

export const generateReportInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  style: z.enum(["daily"]).default("daily"),
  range: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
};

export const generateReportOutputSchema = {
  report: z.record(z.string(), z.unknown()),
};

export async function generateReportToolResult(input: {
  reports: CoachReportPort;
  userId: string;
  profileId?: string | undefined;
  scopes: readonly string[];
  style: "daily";
  range: HealthReadRange;
  timezone?: string | undefined;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("report:read")) {
    return {
      content: [
        {
          type: "text",
          text: "MCP token is missing report:read scope.",
        },
      ],
      isError: true,
    };
  }

  const result = await input.reports.generateDailyReport({
    userId: input.userId,
    profileId: input.profileId,
    range: input.range,
    timezone: input.timezone,
  });

  return {
    content: [
      {
        type: "text",
        text: result.text,
      },
    ],
    structuredContent: {
      report: result.report,
    },
  };
}
