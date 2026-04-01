#!/usr/bin/env npx tsx
/**
 * Tutorial 05: REPL + Conversation Memory (~280 lines)
 * =====================================================
 *
 * Now we make it interactive! Building on Tutorial 04, we add:
 * 1. A REPL (Read-Eval-Print Loop) - continuous conversation
 * 2. Conversation memory - the agent remembers previous messages
 * 3. Slash commands (/help, /clear, /exit)
 *
 * What you'll learn:
 * - How Claude Code maintains conversation state
 * - The REPL pattern for interactive agents
 * - Why conversation memory makes agents dramatically more useful
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/05-repl-conversation.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as readline from "node:readline";

const client = new Anthropic();
const CWD = process.cwd();

// === Context + Prompt (from Tutorial 04) ===
function gatherContext(): string {
  const parts: string[] = [];
  try { parts.push(`## CLAUDE.md\n${readFileSync(join(CWD, "CLAUDE.md"), "utf-8")}`); } catch {}
  const checks: [string, string][] = [["package.json", "Node.js"], ["Cargo.toml", "Rust"], ["go.mod", "Go"], ["pyproject.toml", "Python"]];
  for (const [f, t] of checks) { try { statSync(join(CWD, f)); parts.push(`- ${t} project`); } catch {} }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: CWD, encoding: "utf-8" }).trim();
    parts.push(`- Git: ${branch}`);
  } catch {}
  return parts.join("\n");
}

function buildSystemPrompt(ctx: string): string {
  return `You are an expert AI coding assistant. Working dir: ${CWD} | OS: ${process.platform}
Tools: Bash (run commands), FileRead (read files), FileWrite (create/write files)
Rules: Read before edit. Be concise.
${ctx ? `\n# Context\n${ctx}` : ""}`;
}

// === Tools (from Tutorial 03) ===
const tools: Anthropic.Messages.Tool[] = [
  { name: "Bash", description: "Run a shell command",
    input_schema: { type: "object" as const, properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "FileRead", description: "Read a file",
    input_schema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "FileWrite", description: "Write a file",
    input_schema: { type: "object" as const, properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
];

const READ_ONLY = new Set(["FileRead"]);

function executeTool(name: string, input: Record<string, any>): string {
  switch (name) {
    case "Bash":
      try { return execSync(input.command, { encoding: "utf-8", timeout: 15000 }); }
      catch (e: any) { return `Error: ${e.message}`; }
    case "FileRead":
      try { return readFileSync(input.path, "utf-8"); }
      catch (e: any) { return `Error: ${e.message}`; }
    case "FileWrite":
      try {
        mkdirSync(dirname(input.path), { recursive: true });
        writeFileSync(input.path, input.content, "utf-8");
        return `Wrote to ${input.path}`;
      } catch (e: any) { return `Error: ${e.message}`; }
    default: return `Unknown tool: ${name}`;
  }
}

// === NEW: Interactive REPL ===
async function runAgentTurn(
  messages: Anthropic.Messages.MessageParam[],
  systemPrompt: string,
  rl: readline.Interface,
): Promise<void> {
  for (let round = 0; round < 15; round++) {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      tools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as any;
        if (delta.type === "text_delta") process.stdout.write(delta.text);
      }
    }

    const final = await stream.finalMessage();
    messages.push({ role: "assistant", content: final.content });
    if (final.stop_reason !== "tool_use") return;

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, any>;
      const summary = block.name === "Bash" ? input.command : input.path;

      if (!READ_ONLY.has(block.name)) {
        console.log(`\n\x1b[33m⚠ ${block.name}: ${summary}\x1b[0m`);
        const ok = await new Promise<boolean>((r) => {
          rl.question(`\x1b[33m  Allow? [y/N] \x1b[0m`, (a) => r(a.trim().toLowerCase() === "y"));
        });
        if (!ok) {
          results.push({ type: "tool_result", tool_use_id: block.id, content: "Denied.", is_error: true });
          continue;
        }
      }

      console.log(`\x1b[2m⚡ ${block.name}: ${String(summary).slice(0, 60)}\x1b[0m`);
      const output = executeTool(block.name, input);
      console.log(`\x1b[2m${output.slice(0, 200)}\x1b[0m`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: output });
    }
    messages.push({ role: "user", content: results });
  }
}

async function main() {
  const systemPrompt = buildSystemPrompt(gatherContext());
  let messages: Anthropic.Messages.MessageParam[] = [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\x1b[1m\x1b[36mnano-claude-code\x1b[0m \x1b[2mv0.1 tutorial\x1b[0m`);
  console.log(`\x1b[2mType a message, /help for commands, /exit to quit\x1b[0m\n`);

  const prompt = () => rl.question("\x1b[1m\x1b[36m❯ \x1b[0m", async (input) => {
    input = input.trim();
    if (!input) return prompt();

    // Slash commands
    if (input === "/exit" || input === "/quit") { console.log("Bye!"); process.exit(0); }
    if (input === "/clear") { messages = []; console.log("\x1b[2mCleared.\x1b[0m\n"); return prompt(); }
    if (input === "/help") {
      console.log(`  /clear  - Clear conversation\n  /exit   - Quit\n`);
      return prompt();
    }

    messages.push({ role: "user", content: input });
    console.log();

    try {
      await runAgentTurn(messages, systemPrompt, rl);
    } catch (e: any) {
      console.error(`\x1b[31mError: ${e.message}\x1b[0m`);
    }

    console.log("\n");
    prompt();
  });

  prompt();
}

main().catch(console.error);
