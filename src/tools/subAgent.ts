/**
 * SubAgent Tool - Spawn a sub-agent to handle complex subtasks
 *
 * This mirrors Claude Code's "Task" tool. The main agent can delegate
 * work to a sub-agent that has its own conversation context and tool access.
 * The sub-agent runs to completion and returns a summary.
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
let _provider: LLMProvider | null = null;
let _model: string = "";
let _maxTokens: number = 16384;
let _allTools: ToolDefinition[] = [];

/**
 * Configure the sub-agent with the current provider and settings.
 * Must be called before the tool is used.
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

    // Create sub-agent conversation with the task
    const messages: Message[] = [
      {
        role: "user",
        content: input.task,
      },
    ];

    // Collect sub-agent output
    let fullOutput = "";
    const toolActions: string[] = [];

    try {
      // Filter out SubAgent from available tools to prevent infinite recursion
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
        onToolCall: (name, input) => {
          const summary = JSON.stringify(input).slice(0, 100);
          toolActions.push(`${name}: ${summary}`);
        },
        onToolResult: () => {},
      });

      // Build a summary of what the sub-agent did
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
