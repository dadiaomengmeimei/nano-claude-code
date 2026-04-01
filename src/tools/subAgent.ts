/**
 * SubAgent Tool - Spawn a sub-agent to handle complex subtasks
 *
 * @source ../src/tools/AgentTool/AgentTool.tsx
 * @source ../src/tools/AgentTool/runAgent.ts
 * @source ../src/tools/AgentTool/built-in/generalPurposeAgent.ts
 *
 * Original AgentTool is a complex system with:
 * - Multiple built-in agent types (Explore, Plan, Code, etc.)
 * - User-defined agents from .claude/agents/ directory
 * - Fork mode (cache-sharing with parent)
 * - Coordinator pattern for multi-agent orchestration
 * - Agent memory and snapshot system
 * - Per-agent tool filtering and model selection
 * - Resume/background agent support
 *
 * Nano keeps: single general-purpose sub-agent with tool filtering.
 * Removed: agent types, fork mode, coordinator, memory, resume.
 */

import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult, LLMProvider, Message } from "../types.js";
import { runAgentLoop } from "../agentLoop.js";
import { buildSystemPrompt } from "../prompt.js";
import { collectContext } from "../context.js";

const inputSchema = z.object({
  task: z.string().describe(
    "A self-contained task description for the sub-agent. Be specific about what files to read/edit, what to search for, or what commands to run. The sub-agent has access to all the same tools."
  ),
});

// These will be injected at registration time
// @source AgentTool.tsx - agent configuration is passed via toolUseContext.options
let _provider: LLMProvider | null = null;
let _model: string = "";
let _maxTokens: number = 16384;
let _allTools: ToolDefinition[] = [];

/**
 * Configure the sub-agent with the current provider and settings.
 * Must be called before the tool is used.
 *
 * @source ../src/tools/AgentTool/runAgent.ts - runAgent()
 * Original receives configuration through toolUseContext.options.
 * Nano uses module-level state for simplicity.
 */
export function configureSubAgent(opts: {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  tools: ToolDefinition[];
}) {
  _provider = opts.provider;
  _model = opts.model;
  _maxTokens = opts.maxTokens;
  _allTools = opts.tools;
}

export const SubAgentTool: ToolDefinition = {
  name: "SubAgent",
  description: [
    "Spawns a sub-agent to handle a complex subtask independently.",
    "",
    "Use this when:",
    "- A task is complex and can be broken into independent subtasks",
    "- You need to explore a codebase without cluttering the main conversation",
    "- You want to do a focused task (e.g., refactor one file) in isolation",
    "",
    "The sub-agent has access to all the same tools (Bash, FileRead, FileEdit, etc.)",
    "but runs in its own conversation context. It will execute the task and return",
    "a summary of what it did.",
    "",
    "Tips:",
    "- Be specific in the task description",
    "- Include relevant file paths and context",
    "- The sub-agent cannot see the main conversation history",
  ].join("\n"),
  inputSchema,

  isReadOnly() {
    return false;
  },

  /**
   * @source ../src/tools/AgentTool/runAgent.ts - runAgent()
   * Original has: agent type selection, fork mode, cache sharing,
   * model override, tool filtering, memory injection, resume support.
   * Nano: simple sub-loop with filtered tools (no SubAgent to prevent recursion).
   */
  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);

    if (!_provider) {
      return {
        output: "Error: SubAgent not configured. Provider not set.",
        isError: true,
      };
    }

    // Collect fresh project context for the sub-agent
    const projectContext = await collectContext(context.cwd);
    const systemPrompt = buildSystemPrompt(projectContext, context.cwd);

    const messages: Message[] = [
      {
        role: "user",
        content: input.task,
      },
    ];

    let fullOutput = "";
    const toolActions: string[] = [];

    try {
      // Filter out SubAgent from available tools to prevent infinite recursion
      // @source AgentTool.tsx - tools are filtered per agent type
      const subTools = _allTools.filter((t) => t.name !== "SubAgent");

      const result = await runAgentLoop({
        provider: _provider,
        tools: subTools,
        systemPrompt: systemPrompt + "\n\nYou are a sub-agent executing a specific task. Be thorough but concise. Focus on completing the task and reporting what you did.",
        model: _model,
        maxTokens: _maxTokens,
        messages,
        toolContext: context,
        permissionMode: "auto", // Sub-agents auto-approve (parent already approved)
        onText: (text) => {
          fullOutput += text;
        },
        onToolCall: (name, toolInput) => {
          const summary = JSON.stringify(toolInput).slice(0, 100);
          toolActions.push(`${name}: ${summary}`);
        },
        onToolResult: () => {},
      });

      const summary = [
        "## Sub-agent completed",
        "",
        "### Task",
        input.task,
        "",
        "### Actions taken",
        ...toolActions.map((a) => `- ${a}`),
        "",
        "### Response",
        fullOutput || "(no text output)",
      ].join("\n");

      return { output: summary };
    } catch (err: any) {
      return {
        output: `Sub-agent error: ${err.message}\n\nPartial output:\n${fullOutput}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
