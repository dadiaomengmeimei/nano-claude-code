/**
 * FileReadTool - Read file contents
 *
 * @source ../src/tools/FileReadTool/FileReadTool.ts
 * @source ../src/tools/FileReadTool/prompt.ts
 *
 * Original FileReadTool.ts is ~1,182 lines with:
 * - Image reading (base64 encoding for vision)
 * - PDF reading (page extraction, inline threshold)
 * - Notebook reading (cell-by-cell rendering)
 * - Binary file detection
 * - File deduplication (readFileState cache)
 * - Token-based content truncation
 * - Skill discovery from file paths
 * - Similar file suggestion on ENOENT
 * - React rendering for UI
 *
 * Nano keeps: text file reading with line numbers, offset/limit.
 * Removed: image/PDF/notebook, dedup, skill discovery, token limits.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

/**
 * Input schema.
 * @source FileReadTool.ts - inputSchema()
 * Original has: file_path, offset, limit, pages (for PDF)
 * Nano keeps: file_path, offset, limit
 */
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

  /** @source FileReadTool.ts - isReadOnly() { return true } */
  isReadOnly() {
    return true;
  },

  /**
   * @source FileReadTool.ts - call()
   * Original has: image/PDF/notebook handling, dedup check, skill discovery,
   * token-based truncation, ENOENT with similar file suggestion.
   * Nano: simple text read with line numbers.
   */
  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const filePath = resolve(context.cwd, input.file_path);

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return {
          output: `Error: ${input.file_path} is not a file`,
          isError: true,
        };
      }

      // @source FileReadTool.ts - maxSizeBytes check
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
      output += "\u2500".repeat(60) + "\n";
      output += numberedLines.join("\n");

      return { output };
    } catch (err: any) {
      // @source FileReadTool.ts - ENOENT handling with similar file suggestion
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
