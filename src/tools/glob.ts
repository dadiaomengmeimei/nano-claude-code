/**
 * GlobTool - Find files by name pattern
 */

import { glob } from "glob";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  pattern: z.string().describe("The glob pattern to match files against (e.g., '**/*.ts', 'src/**/*.py')"),
  path: z
    .string()
    .optional()
    .describe("The directory to search in. Defaults to current working directory."),
});

export const GlobTool: ToolDefinition = {
  name: "Glob",
  description: [
    "Finds files matching a glob pattern.",
    "",
    "Usage notes:",
    "- Returns a list of file paths matching the pattern",
    "- Results are limited to 100 files",
    "- Common patterns: '**/*.ts' (all TypeScript files), 'src/**' (all files in src)",
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

    try {
      const files = await glob(input.pattern, {
        cwd: searchPath,
        nodir: true,
        dot: false,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          "**/coverage/**",
        ],
        maxDepth: 20,
      });

      // Sort and limit
      const sorted = files.sort();
      const limited = sorted.slice(0, 100);
      const truncated = sorted.length > 100;

      if (limited.length === 0) {
        return { output: "No files found matching the pattern." };
      }

      let output = limited.join("\n");
      if (truncated) {
        output += `\n\n(Results truncated. ${sorted.length} total files found, showing first 100.)`;
      } else {
        output = `Found ${limited.length} file(s):\n\n${output}`;
      }

      return { output };
    } catch (err: any) {
      return {
        output: `Error searching files: ${err.message}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
