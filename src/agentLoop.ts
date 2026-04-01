/**
 * Agent Loop - The core query/tool-use cycle
 *
 * @source ../src/query.ts - queryLoop(), query()
 *
 * This is the heart of nano-claude-code. The original query.ts is a 1,729-line
 * async generator with:
 * - Mutable State object carried between iterations
 * - Auto-compact tracking and reactive compact (413 recovery)
 * - Skill discovery prefetch
 * - Token budget tracking
 * - Tool result persistence and content replacement
 * - Max output tokens recovery
 * - Stop hooks and tool use summaries
 *
 * Nano preserves the core while(true) loop pattern:
 *   1. Send messages to the LLM
 *   2. Stream the response
 *   3. Detect tool_use blocks
 *   4. Execute tools (with permission checks)
 *   5. Feed tool_results back as user messages
 *   6. Repeat until no more tool calls (or max turns reached)
 *
 * Removed: generator pattern, reactive compact, skill prefetch, token budget,
 * tool result persistence, max output recovery, stop hooks, analytics.
 */

import chalk from "chalk";
import type {
  ContentBlock,
  LLMProvider,
  Message,
  StreamEvent,
  ToolUseContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";

/**
 * Max tool rounds before forced stop.
 *
 * @source ../src/query.ts - maxTurns parameter (default unlimited, but
 * subagents use maxTurns from agent definition). Nano uses a fixed limit.
 */
const MAX_TOOL_ROUNDS = 30;

/**
 * Agent loop options.
 *
 * @source ../src/query.ts - QueryParams
 * Original has: messages, systemPrompt, userContext, systemContext,
 * canUseTool, toolUseContext, fallbackModel, querySource, maxTurns, etc.
 */
interface AgentLoopOptions {
  provider: LLMProvider;
  tools: ToolDefinition[];
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: Message[];
  toolContext: ToolUseContext;
  permissionMode: "ask" | "auto";
  /** Callbacks for streaming UI - mirrors query.ts yield events */
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  askPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Pending tool use being streamed.
 *
 * @source ../src/query.ts - The streaming executor accumulates tool_use
 * blocks from content_block_start/delta/stop events. Nano does the same
 * inline instead of using a separate StreamingToolExecutor class.
 */
interface PendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

/**
 * Run the agent loop.
 *
 * @source ../src/query.ts - async function* queryLoop(params, consumedCommandUuids)
 *
 * Original is an async generator that yields StreamEvents. Nano uses
 * callbacks (onText, onToolCall, etc.) instead, which is simpler but
 * equivalent - the REPL consumes events synchronously anyway.
 *
 * The core loop structure is identical:
 *   while (true) {
 *     stream = api.call(messages)
 *     assistantBlocks = collect(stream)
 *     messages.push({ role: "assistant", content: assistantBlocks })
 *     if (!hasToolUse) break
 *     toolResults = execute(toolUseBlocks)
 *     messages.push({ role: "user", content: toolResults })
 *   }
 */
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

  // Working copy of messages - mutated across iterations
  // @source query.ts: let state: State = { messages: params.messages, ... }
  const conversationMessages = [...messages];

  /**
   * Turn counter.
   * @source query.ts: turnCount: 1 in State, incremented each iteration
   */
  let round = 0;

  // -- Main loop --
  // @source query.ts: while (true) { ... }
  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Collect the assistant response blocks
    const assistantBlocks: ContentBlock[] = [];
    let currentToolUse: PendingToolUse | null = null;
    let hasToolUse = false;

    // -- Stream API response --
    // @source query.ts: yield { type: 'stream_request_start' }
    // then streams via Anthropic SDK messages.stream()
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
          const lastThinking = assistantBlocks[assistantBlocks.length - 1];
          if (lastThinking && lastThinking.type === "thinking") {
            lastThinking.thinking += event.text || "";
          } else {
            assistantBlocks.push({ type: "thinking", thinking: event.text || "" });
          }
          break;

        // -- Tool use streaming --
        // @source query.ts uses StreamingToolExecutor to handle these
        // events. It supports parallel tool execution. Nano handles
        // them inline and executes tools sequentially.
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
              // If JSON parsing fails, use empty object
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
          assistantBlocks.push({
            type: "text",
            text: `[Error: ${event.error}]`,
          });
          break;

        case "done":
          break;
      }
    }

    // -- Add assistant message --
    // @source query.ts: assistantMessages are pushed to the messages array
    conversationMessages.push({
      role: "assistant",
      content: assistantBlocks,
    });

    // If no tool use, the turn is complete
    if (!hasToolUse) {
      break;
    }

    // -- Execute tool calls --
    // @source query.ts: tool execution happens via processToolCalls()
    // which uses StreamingToolExecutor for parallel execution.
    // Nano executes sequentially for simplicity.
    const toolUseBlocks = assistantBlocks.filter(
      (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use"
    );

    const toolResultBlocks: ContentBlock[] = [];

    for (const toolUse of toolUseBlocks) {
      // @source query.ts: findToolByName(tools, name)
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

      // -- Permission check --
      // @source ../src/Tool.ts: checkPermissions() + ../src/hooks/useCanUseTool.ts
      // Original has a complex permission system with:
      // - Tool-specific checkPermissions() method
      // - Global permission rules (always allow/deny/ask)
      // - Auto-mode classifier (yoloClassifier.ts)
      // - Pre/Post tool use hooks
      // Nano simplifies to: read-only tools auto-approve, others ask user.
      if (permissionMode === "ask" && !tool.isReadOnly()) {
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

      // -- Execute tool --
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

    // -- Feed tool results back --
    // @source query.ts: toolResults are pushed as user messages
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
