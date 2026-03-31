/**
 * FileReadTool - Read file contents
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  file_path: z.string().describe("The absolute or relative path of the file to read"),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z
    .number()
    .optional()
    .describe("Number of lines to read"),
});

export const FileReadTool: ToolDefinition = {
  name: "FileRead",
  description: [
    "Reads the contents of a file and returns it with line numbers.",
    "",
    "Usage notes:",
    "- Use this to read files before editing them",
    "- For large files, use offset and limit to read specific sections",
    "- The output includes line numbers for reference",
    "- Binary files will return an error",
  ].join("\n"),
  inputSchema,

  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const filePath = resolve(context.cwd, input.file_path);

    try {
      // Check file exists and get size
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return {
          output: `Error: ${input.file_path} is not a file`,
          isError: true,
        };
      }

      // Warn if file is very large
      const MAX_SIZE = 2 * 1024 * 1024; // 2MB
      if (fileStat.size > MAX_SIZE) {
        return {
          output: `Error: File is too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB). Use offset/limit to read specific sections.`,
          isError: true,
        };
      }

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      // Apply offset and limit
      const startLine = input.offset ? Math.max(1, input.offset) : 1;
      const endLine = input.limit
        ? Math.min(lines.length, startLine + input.limit - 1)
        : lines.length;

      const selectedLines = lines.slice(startLine - 1, endLine);
      const numberedLines = selectedLines.map(
        (line, i) => `${String(startLine + i).padStart(5)} | ${line}`
      );

      const displayPath = relative(context.cwd, filePath);
      let output = `File: ${displayPath}\n`;
      output += `Lines: ${startLine}-${endLine} of ${lines.length}\n`;
      output += "─".repeat(60) + "\n";
      output += numberedLines.join("\n");

      return { output };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return {
          output: `Error: File not found: ${input.file_path}. Current working directory: ${context.cwd}`,
          isError: true,
        };
      }
      return {
        output: `Error reading file: ${err.message}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
