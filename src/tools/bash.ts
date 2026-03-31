/**
 * BashTool - Execute shell commands
 */

import { exec } from "node:child_process";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default: 30000)"),
});

export const BashTool: ToolDefinition = {
  name: "Bash",
  description: [
    "Executes a given bash command and returns its output.",
    "The working directory is the project root.",
    "",
    "Rules:",
    "- Use this for running shell commands, scripts, and system operations",
    "- Prefer dedicated tools (FileRead, FileEdit, Grep, Glob) over bash equivalents when possible",
    "- For long-running commands, consider adding timeouts",
    "- Do not use interactive commands that require user input",
  ].join("\n"),
  inputSchema,

  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const timeout = input.timeout ?? 30000;

    return new Promise<ToolResult>((resolve) => {
      const child = exec(
        input.command,
        {
          cwd: context.cwd,
          env: { ...process.env, TERM: "dumb" },
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
          shell: "/bin/bash",
        },
        (error, stdout, stderr) => {
          let stdoutStr = String(stdout || "");
          const stderrStr = String(stderr || "");

          // Truncate output if too large
          const maxLen = 30000;
          if (stdoutStr.length > maxLen) {
            stdoutStr =
              stdoutStr.slice(0, maxLen / 2) +
              "\n\n... [output truncated] ...\n\n" +
              stdoutStr.slice(-maxLen / 2);
          }

          let output = "";
          if (stdoutStr) output += stdoutStr;
          if (stderrStr) output += (output ? "\n" : "") + `STDERR:\n${stderrStr}`;
          if (!output) output = "(no output)";

          const exitCode = error?.code;
          if (exitCode !== undefined && exitCode !== 0) {
            output += `\nExit code: ${exitCode}`;
          }

          resolve({
            output,
            isError: !!error && exitCode !== 0,
          });
        }
      );

      // Handle abort signal
      if (context.abortSignal) {
        context.abortSignal.addEventListener("abort", () => {
          child.kill("SIGTERM");
        });
      }
    });
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
