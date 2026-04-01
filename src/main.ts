/**
 * Main entry point - REPL and CLI
 *
 * @source ../src/main.tsx - main()
 * @source ../src/entrypoints/cli.tsx - CLI entry point
 *
 * Original design:
 * - React-based terminal UI (Ink framework)
 * - Complex CLI argument parsing (commander.js)
 * - Multiple modes: interactive, one-shot (-p), resume, MCP server
 * - Session management (save/restore)
 * - Telemetry and analytics
 * - Update checker
 * - Permission system initialization
 *
 * Nano keeps: simple readline REPL with streaming output.
 * Removed: React UI, CLI args, session management, telemetry, updates.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { createProvider } from "./api/index.js";
import { runAgentLoop } from "./agentLoop.js";
import { buildSystemPrompt } from "./prompt.js";
import { collectContext } from "./context.js";
import { compactConversation, estimateTokens } from "./compact.js";
import { ALL_TOOLS } from "./tools/index.js";
import { configureSubAgent } from "./tools/subAgent.js";
import type { Message, NanoConfig, ToolResult } from "./types.js";

/**
 * Token threshold for auto-compact.
 * @source ../src/services/compact/autoCompact.ts - shouldAutoCompact()
 * Original uses a dynamic threshold based on model's context window.
 * Nano uses a fixed threshold.
 */
const AUTO_COMPACT_THRESHOLD = 80000;

/**
 * Load configuration from environment variables.
 *
 * @source ../src/utils/config.ts - loadConfig()
 * Original reads from ~/.claude/config.json, env vars, CLI args.
 * Nano reads from env vars only.
 */
function loadConfig(): NanoConfig {
  const provider = (process.env.NANO_PROVIDER || "anthropic") as "anthropic" | "openai";
  const model = process.env.NANO_MODEL || "claude-sonnet-4-20250514";
  const maxTokens = parseInt(process.env.NANO_MAX_TOKENS || "16384", 10);
  const apiKey =
    process.env.NANO_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const baseURL = process.env.NANO_BASE_URL || "https://api.openai.com/v1";
  const permissionMode = (process.env.NANO_PERMISSION_MODE || "ask") as "ask" | "auto";

  if (!apiKey) {
    console.error(
      chalk.red(
        "Error: No API key found. Set NANO_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY."
      )
    );
    process.exit(1);
  }

  return { provider, model, maxTokens, apiKey, baseURL, permissionMode };
}

/**
 * Ask user for permission to execute a tool.
 *
 * @source ../src/hooks/useCanUseTool.ts - permission prompt
 * Original has a rich React-based permission UI with diff preview.
 * Nano uses simple readline prompt.
 */
async function askPermission(
  rl: readline.Interface,
  toolName: string,
  input: Record<string, unknown>
): Promise<boolean> {
  const preview = JSON.stringify(input, null, 2).slice(0, 200);
  console.log(chalk.yellow(`\n\u26a0 Tool: ${toolName}`));
  console.log(chalk.dim(preview));

  return new Promise((resolve) => {
    rl.question(chalk.yellow("Allow? [y/N] "), (answer) => {
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Main REPL loop.
 *
 * @source ../src/main.tsx - main()
 * Original initializes React app, session, telemetry, etc.
 * Nano runs a simple readline loop.
 */
async function main() {
  const config = loadConfig();
  const provider = createProvider(config);
  const cwd = process.cwd();

  // Configure sub-agent
  configureSubAgent({
    provider,
    model: config.model,
    maxTokens: config.maxTokens,
    tools: ALL_TOOLS,
  });

  // Collect project context
  const projectContext = await collectContext(cwd);
  const systemPrompt = buildSystemPrompt(projectContext, cwd);

  console.log(chalk.bold.cyan("\n\u2728 nano-claude-code"));
  console.log(chalk.dim(`Model: ${config.model} | Provider: ${config.provider}`));
  console.log(chalk.dim(`Working directory: ${cwd}`));
  console.log(chalk.dim('Type "exit" to quit, "/compact" to summarize conversation.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Conversation history
  // @source main.tsx: messages state managed by React
  let messages: Message[] = [];

  const prompt = () => {
    rl.question(chalk.green("\n> "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.dim("\nGoodbye!"));
        rl.close();
        process.exit(0);
      }

      // @source ../src/commands/ - slash commands
      if (trimmed === "/compact") {
        console.log(chalk.dim("\nCompacting conversation..."));
        const result = await compactConversation(
          messages,
          provider,
          config.model,
          config.maxTokens
        );
        messages = result.messages;
        console.log(
          chalk.dim(
            `Compacted: ${result.beforeTokens} -> ${result.afterTokens} tokens`
          )
        );
        prompt();
        return;
      }

      // Add user message
      messages.push({ role: "user", content: trimmed });

      // Auto-compact check
      // @source autoCompact.ts: shouldAutoCompact()
      const currentTokens = estimateTokens(messages);
      if (currentTokens > AUTO_COMPACT_THRESHOLD) {
        console.log(chalk.dim("\n[Auto-compacting conversation...]"));
        const result = await compactConversation(
          messages,
          provider,
          config.model,
          config.maxTokens
        );
        messages = result.messages;
        // Re-add the user message after compact
        messages.push({ role: "user", content: trimmed });
        console.log(
          chalk.dim(
            `[Compacted: ${result.beforeTokens} -> ${result.afterTokens} tokens]`
          )
        );
      }

      try {
        // Run agent loop
        process.stdout.write(chalk.dim("\n"));

        messages = await runAgentLoop({
          provider,
          tools: ALL_TOOLS,
          systemPrompt,
          model: config.model,
          maxTokens: config.maxTokens,
          messages,
          toolContext: { cwd },
          permissionMode: config.permissionMode,
          onText: (text) => {
            process.stdout.write(text);
          },
          onThinking: (text) => {
            process.stdout.write(chalk.dim.italic(text));
          },
          onToolCall: (name, toolInput) => {
            const summary = Object.entries(toolInput)
              .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`)
              .join(", ");
            console.log(chalk.blue(`\n\u25b6 ${name}(${summary})`));
          },
          onToolResult: (name, result) => {
            if (result.isError) {
              console.log(chalk.red(`\u2717 ${name} failed`));
            } else {
              const preview = result.output.split("\n")[0]?.slice(0, 80) || "";
              console.log(chalk.green(`\u2713 ${name}: ${preview}`));
            }
          },
          askPermission: (toolName, toolInput) =>
            askPermission(rl, toolName, toolInput),
        });

        console.log(""); // Newline after response
      } catch (err: any) {
        console.error(chalk.red(`\nError: ${err.message}`));
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
