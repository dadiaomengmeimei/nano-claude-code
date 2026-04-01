#!/usr/bin/env npx tsx
/**
 * Tutorial 02: File Tools + Streaming (~150 lines)
 * ==================================================
 *
 * Building on Tutorial 01, we add:
 * 1. FileRead tool - so the agent can read files (not just `cat`)
 * 2. FileWrite tool - so the agent can create/write files
 * 3. Streaming - see tokens appear in real-time instead of waiting
 *
 * What you'll learn:
 * - How to define multiple tools with typed schemas
 * - How streaming works with the Anthropic API
 * - How to handle tool_use events in a stream
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/02-file-tools-streaming.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const client = new Anthropic();

// === TOOLS: Bash + FileRead + FileWrite ===
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
      properties: { path: { type: "string", description: "File path to read" } },
      required: ["path"],
    },
  },
  {
    name: "FileWrite",
    description: "Write content to a file (creates parent dirs)",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
];

// === TOOL EXECUTOR ===
function executeTool(name: string, input: Record<string, any>): string {
  switch (name) {
    case "Bash":
      try {
        return execSync(input.command, { encoding: "utf-8", timeout: 15000 });
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    case "FileRead":
      try {
        return readFileSync(input.path, "utf-8");
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    case "FileWrite":
      try {
        mkdirSync(dirname(input.path), { recursive: true });
        writeFileSync(input.path, input.content, "utf-8");
        return `Wrote ${input.content.split("\n").length} lines to ${input.path}`;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    default:
      return `Unknown tool: ${name}`;
  }
}

// === STREAMING AGENT LOOP ===
async function agent(userMessage: string) {
  console.log(`\n\x1b[36m> ${userMessage}\x1b[0m\n`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < 15; round++) {
    // Use streaming API
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: "You are a coding assistant with file read/write and bash tools. Be concise.",
      tools,
      messages,
    });

    // Collect response while streaming text to terminal
    const contentBlocks: Anthropic.Messages.ContentBlock[] = [];
    let hasToolUse = false;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block as any;
        if (block.type === "tool_use") hasToolUse = true;
      } else if (event.type === "content_block_delta") {
        const delta = event.delta as any;
        if (delta.type === "text_delta") {
          process.stdout.write(delta.text); // Real-time streaming!
        }
      }
    }

    // Get the final message
    const finalMessage = await stream.finalMessage();
    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason !== "tool_use") break;

    // Execute tools
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;

      const input = block.input as Record<string, any>;
      console.log(`\n\x1b[2m⚡ ${block.name}: ${JSON.stringify(input).slice(0, 80)}\x1b[0m`);

      const output = executeTool(block.name, input);
      console.log(`\x1b[2m${output.slice(0, 300)}\x1b[0m`);

      results.push({ type: "tool_result", tool_use_id: block.id, content: output });
    }

    messages.push({ role: "user", content: results });
  }
  console.log();
}

agent(process.argv[2] || "Read package.json and tell me about this project").catch(console.error);
