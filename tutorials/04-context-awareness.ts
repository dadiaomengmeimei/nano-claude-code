#!/usr/bin/env npx tsx
/**
 * Tutorial 04: Context Awareness (~220 lines)
 * =============================================
 *
 * A smart agent knows about its environment. Building on Tutorial 03, we add:
 * 1. Auto-detect project type (package.json, Cargo.toml, etc.)
 * 2. Read CLAUDE.md for project-specific instructions
 * 3. Gather Git info (branch, status)
 * 4. Inject all context into the system prompt
 *
 * What you'll learn:
 * - Why Claude Code's system prompt is "assembled, not written"
 * - How context injection makes the agent dramatically smarter
 * - The pattern: gather context → build prompt → run loop
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/04-context-awareness.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as readline from "node:readline";

const client = new Anthropic();
const CWD = process.cwd();

// === CONTEXT GATHERING (like Claude Code's context.ts) ===
function gatherContext(): string {
  const parts: string[] = [];

  // 1. Read CLAUDE.md
  try {
    const claudeMd = readFileSync(join(CWD, "CLAUDE.md"), "utf-8");
    parts.push(`## Project Instructions (CLAUDE.md)\n${claudeMd}`);
  } catch {}

  // 2. Detect project type
  const projectFiles: [string, string][] = [
    ["package.json", "Node.js/TypeScript"],
    ["Cargo.toml", "Rust"],
    ["go.mod", "Go"],
    ["pyproject.toml", "Python"],
    ["requirements.txt", "Python"],
  ];
  for (const [file, type] of projectFiles) {
    try { statSync(join(CWD, file)); parts.push(`- Project type: ${type} (${file})`); } catch {}
  }

  // 3. Git info
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: CWD, encoding: "utf-8" }).trim();
    const status = execSync("git status --short", { cwd: CWD, encoding: "utf-8" }).trim();
    parts.push(`- Git branch: ${branch}`);
    if (status) parts.push(`- Changed files: ${status.split("\n").length}`);
  } catch {}

  return parts.join("\n");
}

// === SYSTEM PROMPT BUILDER (like Claude Code's prompt.ts) ===
function buildSystemPrompt(context: string): string {
  return `You are an expert AI coding assistant working in: ${CWD}
OS: ${process.platform} | Shell: bash

# Tools
- Bash: Run shell commands
- FileRead: Read files
- FileWrite: Create/overwrite files

# Rules
1. Read files before editing. Use FileRead, not \`cat\`.
2. Be concise. Show what you did and why.

${context ? `# Project Context\n${context}` : ""}`.trim();
}

// === TOOLS + EXECUTOR (same as Tutorial 03) ===
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
        return `Wrote ${input.content.split("\n").length} lines to ${input.path}`;
      } catch (e: any) { return `Error: ${e.message}`; }
    default: return `Unknown tool: ${name}`;
  }
}

function askUser(q: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => { rl.question(q, (a) => { rl.close(); r(a.trim().toLowerCase() === "y"); }); });
}

// === AGENT LOOP ===
async function agent(userMessage: string) {
  const context = gatherContext();
  const systemPrompt = buildSystemPrompt(context);

  console.log(`\x1b[2m[Context: ${context.split("\n").length} lines gathered]\x1b[0m`);
  console.log(`\n\x1b[36m> ${userMessage}\x1b[0m\n`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

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
    if (final.stop_reason !== "tool_use") break;

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, any>;
      const summary = block.name === "Bash" ? input.command : input.path;

      if (!READ_ONLY.has(block.name)) {
        console.log(`\n\x1b[33m⚠ ${block.name}: ${summary}\x1b[0m`);
        const ok = await askUser(`\x1b[33m  Allow? [y/N] \x1b[0m`);
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
  console.log();
}

agent(process.argv[2] || "What kind of project is this? Summarize its structure.").catch(console.error);
