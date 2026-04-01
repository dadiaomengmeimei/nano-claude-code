#!/usr/bin/env node

/**
 * nano-claude-code - A minimal AI coding assistant
 *
 * Main entry point: handles terminal I/O and orchestrates the agent loop.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { loadConfig } from "./utils/config.js";
import { AnthropicProvider } from "./api/anthropic.js";
import { OpenAIProvider } from "./api/openai.js";
import { ALL_TOOLS } from "./tools/index.js";
import { collectContext } from "./context.js";
import { buildSystemPrompt } from "./prompt.js";
import { runAgentLoop } from "./agentLoop.js";
import { compactConversation, estimateTokens } from "./compact.js";
import { configureSubAgent } from "./tools/subAgent.js";
import type { Message, LLMProvider, ToolResult } from "./types.js";

// ============================================================
// Terminal UI helpers
// ============================================================

const BANNER = `
${chalk.bold.cyan("nano-claude-code")} ${chalk.dim("v0.2.0")}
${chalk.dim("A minimal AI coding assistant")}
${chalk.dim("Type your message, or use:")}
  ${chalk.yellow("/help")}    - Show commands
  ${chalk.yellow("/clear")}   - Clear conversation
  ${chalk.yellow("/compact")} - Summarize conversation to save tokens
  ${chalk.yellow("/exit")}    - Quit
${"\u2500".repeat(50)}
`;

function printToolCall(name: string, input: Record<string, unknown>) {
  const summary = getToolSummary(name, input);
  process.stdout.write(chalk.dim(`\n\u26A1 ${name}: ${summary}\n`));
}

function printToolResult(name: string, result: ToolResult) {
  if (result.isError) {
    process.stdout.write(chalk.red(`  \u2717 Error\n`));
  } else {
    // Show a brief summary
    const lines = result.output.split("\n");
    const preview = lines[0]?.slice(0, 80) || "(empty)";
    process.stdout.write(chalk.green(`  \u2713 `) + chalk.dim(preview) + "\n");
  }
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
      return String(input.command || "").slice(0, 60);
    case "FileRead":
      return String(input.file_path || "");
    case "FileEdit":
      return String(input.file_path || "");
    case "FileWrite":
      return String(input.file_path || "");
    case "Grep":
      return `/${input.pattern}/ in ${input.path || "."}`;
    case "Glob":
      return `${input.pattern} in ${input.path || "."}`;
    case "SubAgent":
      return String(input.task || "").slice(0, 60);
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}

// ============================================================
// Permission prompt
// ============================================================

async function askPermission(
  rl: readline.Interface,
  toolName: string,
  input: Record<string, unknown>
): Promise<boolean> {
  const summary = getToolSummary(toolName, input);
  process.stdout.write(
    chalk.yellow(`\n\u26A0 Permission required: ${toolName}: ${summary}\n`)
  );

  // Show relevant details
  if (toolName === "Bash") {
    process.stdout.write(chalk.dim(`  Command: ${input.command}\n`));
  } else if (toolName === "FileEdit") {
    process.stdout.write(chalk.dim(`  File: ${input.file_path}\n`));
  } else if (toolName === "FileWrite") {
    process.stdout.write(chalk.dim(`  File: ${input.file_path}\n`));
  } else if (toolName === "SubAgent") {
    process.stdout.write(chalk.dim(`  Task: ${String(input.task || "").slice(0, 100)}\n`));
  }

  return new Promise<boolean>((resolve) => {
    rl.question(chalk.yellow("  Allow? [y/N] "), (answer) => {
      const allowed = answer.trim().toLowerCase() === "y";
      if (!allowed) {
        process.stdout.write(chalk.red("  Denied.\n"));
      }
      resolve(allowed);
    });
  });
}

// ============================================================
// Slash commands
// ============================================================

interface SlashCommandContext {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
}

async function handleSlashCommand(
  cmd: string,
  conversationMessages: Message[],
  ctx?: SlashCommandContext
): Promise<{ handled: boolean; shouldExit?: boolean; messages?: Message[] }> {
  const trimmed = cmd.trim().toLowerCase();

  switch (trimmed) {
    case "/help":
      console.log(`
${chalk.bold("Available commands:")}
  ${chalk.yellow("/help")}    - Show this help
  ${chalk.yellow("/clear")}   - Clear conversation history
  ${chalk.yellow("/compact")} - Summarize conversation to save tokens
  ${chalk.yellow("/history")} - Show conversation summary
  ${chalk.yellow("/exit")}    - Quit (also Ctrl+C)
`);
      return { handled: true };

    case "/clear":
      console.log(chalk.dim("Conversation cleared."));
      return { handled: true, messages: [] };

    case "/compact": {
      if (!ctx) {
        console.log(chalk.red("Compact not available."));
        return { handled: true };
      }

      const tokensBefore = estimateTokens(conversationMessages);
      console.log(chalk.dim(`\nCompacting conversation (${conversationMessages.length} messages, ~${tokensBefore} tokens)...`));

      try {
        const result = await compactConversation(
          conversationMessages,
          ctx.provider,
          ctx.model,
          ctx.maxTokens
        );

        if (result.summary) {
          console.log(chalk.green(`\n\u2713 Compacted: ${result.beforeTokens} \u2192 ${result.afterTokens} tokens (${Math.round((1 - result.afterTokens / result.beforeTokens) * 100)}% reduction)`));
          console.log(chalk.dim(`  ${result.messages.length} messages remaining`));
          return { handled: true, messages: result.messages };
        } else {
          console.log(chalk.yellow("Conversation too short to compact."));
          return { handled: true };
        }
      } catch (err: any) {
        console.log(chalk.red(`Compact failed: ${err.message}`));
        return { handled: true };
      }
    }

    case "/history": {
      const userMsgs = conversationMessages.filter((m) => m.role === "user");
      const assistantMsgs = conversationMessages.filter(
        (m) => m.role === "assistant"
      );
      const tokens = estimateTokens(conversationMessages);
      console.log(
        chalk.dim(
          `Conversation: ${userMsgs.length} user messages, ${assistantMsgs.length} assistant messages, ~${tokens} tokens`
        )
      );
      return { handled: true };
    }

    case "/exit":
    case "/quit":
    case "/q":
      return { handled: true, shouldExit: true };

    default:
      if (trimmed.startsWith("/")) {
        console.log(chalk.red(`Unknown command: ${trimmed}. Type /help for available commands.`));
        return { handled: true };
      }
      return { handled: false };
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  // Load config
  const config = await loadConfig();

  // Validate API key
  if (!config.apiKey) {
    console.error(
      chalk.red(
        "Error: No API key found. Set NANO_API_KEY (or ANTHROPIC_API_KEY) environment variable, or add apiKey to ~/.nano-claude.json"
      )
    );
    process.exit(1);
  }

  // Initialize provider
  let provider: LLMProvider;
  if (config.provider === "anthropic") {
    provider = new AnthropicProvider(config.apiKey);
  } else if (config.provider === "openai") {
    provider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  } else {
    console.error(chalk.red(`Unsupported provider: ${config.provider}`));
    process.exit(1);
  }

  // Configure SubAgent with current provider and settings
  configureSubAgent({
    provider,
    model: config.model,
    maxTokens: config.maxTokens,
    tools: ALL_TOOLS,
  });

  // Collect project context
  const cwd = process.cwd();
  const projectContext = await collectContext(cwd);
  const systemPrompt = buildSystemPrompt(projectContext, cwd);

  // Print banner
  console.log(BANNER);
  console.log(chalk.dim(`Provider: ${config.provider} | Model: ${config.model}`));
  console.log(chalk.dim(`Working directory: ${cwd}`));
  console.log(chalk.dim(`Permission mode: ${config.permissionMode}`));
  console.log(chalk.dim(`Tools: ${ALL_TOOLS.map((t) => t.name).join(", ")}\n`));

  // Setup readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.cyan("\n\u276F "),
  });

  let conversationMessages: Message[] = [];

  // Slash command context for /compact
  const slashCtx: SlashCommandContext = {
    provider,
    model: config.model,
    maxTokens: config.maxTokens,
  };

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log(chalk.dim("\nGoodbye!"));
    process.exit(0);
  });

  // Check if input is piped (non-interactive mode)
  const isPiped = !process.stdin.isTTY;

  if (isPiped) {
    // Non-interactive mode: read all stdin and process as a single message
    let input = "";
    for await (const line of rl) {
      input += line + "\n";
    }
    input = input.trim();
    if (!input) {
      process.exit(0);
    }

    conversationMessages.push({ role: "user", content: input });

    await runAgentLoop({
      provider,
      tools: ALL_TOOLS,
      systemPrompt,
      model: config.model,
      maxTokens: config.maxTokens,
      messages: conversationMessages,
      toolContext: { cwd },
      permissionMode: "auto", // Auto-allow in piped mode
      onText: (text) => process.stdout.write(text),
      onThinking: (text) => process.stderr.write(chalk.dim(text)),
      onToolCall: printToolCall,
      onToolResult: printToolResult,
    });

    console.log(); // Final newline
    process.exit(0);
  }

  // Interactive mode
  const promptUser = () => {
    rl.prompt();
  };

  promptUser();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      promptUser();
      return;
    }

    // Handle slash commands
    const cmdResult = await handleSlashCommand(input, conversationMessages, slashCtx);
    if (cmdResult.handled) {
      if (cmdResult.shouldExit) {
        console.log(chalk.dim("Goodbye!"));
        process.exit(0);
      }
      if (cmdResult.messages !== undefined) {
        conversationMessages = cmdResult.messages;
      }
      promptUser();
      return;
    }

    // Add user message
    conversationMessages.push({ role: "user", content: input });

    // Run agent loop
    process.stdout.write("\n");

    try {
      conversationMessages = await runAgentLoop({
        provider,
        tools: ALL_TOOLS,
        systemPrompt,
        model: config.model,
        maxTokens: config.maxTokens,
        messages: conversationMessages,
        toolContext: { cwd },
        permissionMode: config.permissionMode,
        onText: (text) => process.stdout.write(text),
        onThinking: (text) => {
          // Show thinking in dim
          process.stderr.write(chalk.dim(text));
        },
        onToolCall: printToolCall,
        onToolResult: printToolResult,
        askPermission: (toolName, toolInput) =>
          askPermission(rl, toolName, toolInput),
      });
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
    }

    process.stdout.write("\n");
    promptUser();
  });
}

// Run
main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
