#!/usr/bin/env npx tsx
/**
 * Tutorial 03: Permission System (~200 lines)
 * =============================================
 *
 * A real coding agent needs safety. Building on Tutorial 02, we add:
 * 1. Read-only tools auto-allowed (FileRead is safe)
 * 2. Write tools require user confirmation (Bash, FileWrite)
 * 3. Interactive Y/N prompt before dangerous operations
 *
 * What you'll learn:
 * - Why Claude Code has a 5-layer permission system
 * - The simplest useful permission model: read=auto, write=ask
 * - How to pause the agent loop for user input
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/03-permissions.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as readline from "node:readline";

const client = new Anthropic();

// === TOOLS (same as Tutorial 02) ===
const tools: Anthropic.Messages.Tool[] = [
  {
    name: "Bash",
    description: "Run a shell command",
    input_schema: {
      type: "object" as const,
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "FileRead",
    description: "Read a file's contents",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "FileWrite",
    description: "Write content to a file",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

// === NEW: Permission system ===
const READ_ONLY_TOOLS = new Set(["FileRead"]);

function askUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

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

// === AGENT LOOP WITH PERMISSIONS ===
async function agent(userMessage: string) {
  console.log(`\n\x1b[36m> ${userMessage}\x1b[0m\n`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < 15; round++) {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: "You are a coding assistant. Be concise.",
      tools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as any;
        if (delta.type === "text_delta") process.stdout.write(delta.text);
      }
    }

    const finalMessage = await stream.finalMessage();
    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason !== "tool_use") break;

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;

      const input = block.input as Record<string, any>;
      const summary = block.name === "Bash" ? input.command : input.path;

      // Permission check: read-only tools are auto-allowed
      if (!READ_ONLY_TOOLS.has(block.name)) {
        console.log(`\n\x1b[33m⚠ ${block.name}: ${summary}\x1b[0m`);
        const allowed = await askUser(`\x1b[33m  Allow? [y/N] \x1b[0m`);
        if (!allowed) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Permission denied by user.",
            is_error: true,
          });
          console.log(`\x1b[31m  ✗ Denied\x1b[0m`);
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

agent(process.argv[2] || "Create a hello.txt file with a greeting, then read it back").catch(console.error);
