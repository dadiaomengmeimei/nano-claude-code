#!/usr/bin/env npx tsx
/**
 * Tutorial 01: The Minimal Agent Loop (~80 lines)
 * ================================================
 *
 * This is the absolute simplest AI agent you can build.
 * It demonstrates THE core concept: User -> LLM -> Tool -> LLM -> Response
 *
 * What you'll learn:
 * - The fundamental agent loop pattern
 * - How tool_use works in the Anthropic API
 * - Why an agent is just "LLM + tools in a loop"
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/01-minimal-agent.ts "list all ts files"
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";

const client = new Anthropic();

// === THE ONLY TOOL: run a shell command ===
const tools: Anthropic.Messages.Tool[] = [
  {
    name: "Bash",
    description: "Run a shell command and return output",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The bash command to run" },
      },
      required: ["command"],
    },
  },
];

// === THE AGENT LOOP ===
async function agent(userMessage: string) {
  console.log(`\n\x1b[36m> ${userMessage}\x1b[0m\n`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Loop until the LLM stops calling tools
  for (let round = 0; round < 10; round++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: "You are a coding assistant. Use the Bash tool to help the user. Be concise.",
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Print text output
    for (const block of response.content) {
      if (block.type === "text") console.log(block.text);
    }

    // No more tool calls? Done.
    if (response.stop_reason !== "tool_use") break;

    // Execute tool calls and feed results back
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const cmd = (block.input as any).command;
      console.log(`\x1b[2m⚡ ${cmd}\x1b[0m`);

      let output: string;
      try {
        output = execSync(cmd, { encoding: "utf-8", timeout: 10000 });
      } catch (e: any) {
        output = `Error: ${e.message}`;
      }
      console.log(`\x1b[2m${output.slice(0, 500)}\x1b[0m`);

      results.push({ type: "tool_result", tool_use_id: block.id, content: output });
    }

    messages.push({ role: "user", content: results });
  }
}

// Run with CLI argument or default question
agent(process.argv[2] || "What files are in the current directory? Summarize the project.").catch(console.error);
