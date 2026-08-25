import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDirectory, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@fitness/auth", "@fitness/db", "@fitness/domain"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
