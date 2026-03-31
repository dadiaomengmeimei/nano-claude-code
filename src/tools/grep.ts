/**
 * GrepTool - Search file contents using regex
 */

import { execSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for"),
  path: z
    .string()
    .optional()
    .describe("Directory or file to search in. Defaults to current working directory."),
  include: z
    .string()
    .optional()
    .describe("File glob pattern to include (e.g., '*.ts', '*.py')"),
});

export const GrepTool: ToolDefinition = {
  name: "Grep",
  description: [
    "Searches file contents using regular expressions.",
    "Uses ripgrep (rg) if available, falls back to grep.",
    "",
    "Usage notes:",
    "- Returns matching lines with file paths and line numbers",
    "- Results are limited to 100 matches",
    "- Use 'include' to filter by file type",
  ].join("\n"),
  inputSchema,

  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const searchPath = input.path
      ? resolve(context.cwd, input.path)
      : context.cwd;

    // Try ripgrep first, fall back to grep
    const useRg = hasCommand("rg");
    let cmd: string;

    if (useRg) {
      cmd = `rg --line-number --no-heading --color=never --max-count=100`;
      if (input.include) {
        cmd += ` --glob '${input.include}'`;
      }
      cmd += ` -- '${escapeShellArg(input.pattern)}' '${escapeShellArg(searchPath)}'`;
    } else {
      cmd = `grep -rn --color=never`;
      if (input.include) {
        cmd += ` --include='${input.include}'`;
      }
      cmd += ` -E '${escapeShellArg(input.pattern)}' '${escapeShellArg(searchPath)}'`;
      cmd += ` | head -100`;
    }

    try {
      const result = execSync(cmd, {
        cwd: context.cwd,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 15000,
      });

      if (!result.trim()) {
        return { output: "No matches found." };
      }

      // Relativize paths
      const lines = result
        .trim()
        .split("\n")
        .map((line) => {
          // Replace absolute paths with relative ones
          if (line.startsWith(context.cwd)) {
            return line.slice(context.cwd.length + 1);
          }
          if (line.startsWith(searchPath)) {
            return line.slice(searchPath.length + 1);
          }
          return line;
        });

      const matchCount = lines.length;
      return {
        output: `Found ${matchCount} match(es):\n\n${lines.join("\n")}`,
      };
    } catch (err: any) {
      // grep returns exit code 1 when no matches found
      if (err.status === 1) {
        return { output: "No matches found." };
      }
      return {
        output: `Error searching: ${err.message}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};

function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''");
}
