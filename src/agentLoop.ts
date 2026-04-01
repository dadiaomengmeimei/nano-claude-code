/**
 * Agent Loop - The core query/tool-use cycle
 *
 * This is the heart of nano-claude-code. It:
 * 1. Sends messages to the LLM
 * 2. Streams the response
 * 3. Detects tool calls
 * 4. Executes tools
 * 5. Feeds results back to the LLM
 * 6. Repeats until the LLM produces a final text response
 */

import chalk from "chalk";
import type {
  ContentBlock,
  LLMProvider,
  Message,
  StreamEvent,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";

const MAX_TOOL_ROUNDS = 30;

interface AgentLoopOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: Message[];
  toolContext: ToolContext;
  permissionMode: "ask" | "auto";
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  askPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

interface PendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<Message[]> {
  const {
    provider,
    tools,
    systemPrompt,
    model,
    maxTokens,
    messages,
    toolContext,
    permissionMode,
    onText,
    onThinking,
    onToolCall,
    onToolResult,
    askPermission,
  } = options;

  // Working copy of messages
  const conversationMessages = [...messages];
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Collect the assistant's response
    const assistantBlocks: ContentBlock[] = [];
    let currentToolUse: PendingToolUse | null = null;
    let hasToolUse = false;

    const stream = provider.stream({
      model,
      maxTokens,
      systemPrompt,
      tools,
      messages: conversationMessages,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "text":
          if (event.text) {
            onText?.(event.text);
          }
          // Accumulate text into the last text block or create a new one
          const lastBlock = assistantBlocks[assistantBlocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            lastBlock.text += event.text || "";
          } else {
            assistantBlocks.push({ type: "text", text: event.text || "" });
          }
          break;

        case "thinking":
          if (event.text) {
            onThinking?.(event.text);
          }
          // Accumulate thinking
          const lastThinking = assistantBlocks[assistantBlocks.length - 1];
          if (lastThinking && lastThinking.type === "thinking") {
            lastThinking.thinking += event.text || "";
          } else {
            assistantBlocks.push({ type: "thinking", thinking: event.text || "" });
          }
          break;

        case "tool_use_start":
          currentToolUse = {
            id: event.toolUseId || "",
            name: event.toolName || "",
            inputJson: "",
          };
          hasToolUse = true;
          break;

        case "tool_input_delta":
          if (currentToolUse && event.inputDelta) {
            currentToolUse.inputJson += event.inputDelta;
          }
          break;

        case "tool_use_end":
          if (currentToolUse) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(currentToolUse.inputJson || "{}");
            } catch {
              // If JSON parsing fails, try to use as-is
            }
            assistantBlocks.push({
              type: "tool_use",
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: parsedInput,
            });
            currentToolUse = null;
          }
          break;

        case "error":
          console.error(chalk.red(`\nAPI Error: ${event.error}`));
          // Add error as text
          assistantBlocks.push({
            type: "text",
            text: `[Error: ${event.error}]`,
          });
          break;

        case "done":
          break;
      }
    }

    // Add assistant message to conversation
    conversationMessages.push({
      role: "assistant",
      content: assistantBlocks,
    });

    // If no tool use, we're done
    if (!hasToolUse) {
      break;
    }

    // Process tool calls
    const toolUseBlocks = assistantBlocks.filter(
      (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use"
    );

    const toolResultBlocks: ContentBlock[] = [];

    for (const toolUse of toolUseBlocks) {
      const tool = tools.find((t) => t.name === toolUse.name);

      if (!tool) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: Unknown tool '${toolUse.name}'`,
          is_error: true,
        });
        continue;
      }

      onToolCall?.(toolUse.name, toolUse.input);

      // Permission check
      if (permissionMode === "ask" && !isReadOnlyTool(toolUse.name)) {
        const allowed = askPermission
          ? await askPermission(toolUse.name, toolUse.input)
          : true;

        if (!allowed) {
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Tool call was rejected by the user.",
            is_error: true,
          });
          onToolResult?.(toolUse.name, {
            output: "Tool call was rejected by the user.",
            isError: true,
          });
          continue;
        }
      }

      // Execute tool
      try {
        const result = await tool.call(toolUse.input, toolContext);
        const formatted = tool.formatResult(result);

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatted,
          is_error: result.isError,
        });

        onToolResult?.(toolUse.name, result);
      } catch (err: any) {
        const errorMsg = `Error executing ${toolUse.name}: ${err.message}`;
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: errorMsg,
          is_error: true,
        });
        onToolResult?.(toolUse.name, { output: errorMsg, isError: true });
      }
    }

    // Add tool results as a user message
    conversationMessages.push({
      role: "user",
      content: toolResultBlocks,
    });
  }

  if (round >= MAX_TOOL_ROUNDS) {
    console.warn(
      chalk.yellow(`\nWarning: Reached maximum tool rounds (${MAX_TOOL_ROUNDS})`)
    );
  }

  return conversationMessages;
}

/** Read-only tools that don't need permission */
function isReadOnlyTool(name: string): boolean {
  return ["FileRead", "Grep", "Glob"].includes(name);
}
