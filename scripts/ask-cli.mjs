#!/usr/bin/env node
/**
 * Headless CLI client for the notebooklm-mcp server, meant to be launched
 * via a background shell task (not through the interactive MCP tool-call
 * path, which this host aborts on long-running calls — see AUTHENTICATION
 * notes). Spawns the SAME dist/index.js server as a child process, speaks
 * MCP over stdio directly, and prints the tool result as JSON to stdout.
 *
 * Usage:
 *   node scripts/ask-cli.mjs --question "..." --notebook-url "https://notebook.google.com/notebook/<uuid>" [--session-id ID]
 *   node scripts/ask-cli.mjs --question "..." --notebook-id my-notebook-id
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, "..", "dist", "index.js");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--")) {
      const name = key.slice(2);
      const value = argv[i + 1];
      args[name] = value;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.question) {
    console.error("Missing --question");
    process.exit(1);
  }
  if (!args["notebook-url"] && !args["notebook-id"]) {
    console.error("Missing --notebook-url or --notebook-id");
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
  });

  const client = new Client({ name: "ask-cli", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const toolArgs = { question: args.question };
  if (args["notebook-url"]) toolArgs.notebook_url = args["notebook-url"];
  if (args["notebook-id"]) toolArgs.notebook_id = args["notebook-id"];
  if (args["session-id"]) toolArgs.session_id = args["session-id"];

  try {
    const result = await client.callTool({ name: "ask_question", arguments: toolArgs });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
