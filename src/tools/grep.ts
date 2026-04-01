/**
 * GrepTool - Search file contents using regex
 *
 * @source ../src/tools/GrepTool/GrepTool.ts
 * @source ../src/tools/GrepTool/prompt.ts
 *
 * Original GrepTool.ts uses ripgrep (rg) directly with:
 * - Configurable max results
 * - File type filtering
 * - Context lines
 * - React rendering for search results
 *
 * Nano: same ripgrep-first approach with grep fallback.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
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

  /** @source GrepTool.ts - isReadOnly() { return true } */
  isReadOnly() {
    return true;
  },

  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const searchPath = input.path
      ? resolve(context.cwd, input.path)
      : context.cwd;

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
          if (line.startsWith(context.cwd)) {
            return line.slice(context.cwd.length + 1);
          }
          if (line.startsWith(searchPath)) {
            return line.slice(searchPath.length + 1);
          }
          return line;
        });

      return {
        output: `Found ${lines.length} match(es):\n\n${lines.join("\n")}`,
      };
    } catch (err: any) {
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
