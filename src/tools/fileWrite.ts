/**
 * FileWriteTool - Write/create files
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  file_path: z.string().describe("The path of the file to write"),
  content: z.string().describe("The content to write to the file"),
});

export const FileWriteTool: ToolDefinition = {
  name: "FileWrite",
  description: [
    "Writes content to a file, creating it if it doesn't exist.",
    "If the file exists, its content will be completely replaced.",
    "",
    "Usage notes:",
    "- Use this for creating new files or completely rewriting existing ones",
    "- For partial edits, use FileEdit instead",
    "- Parent directories will be created automatically if they don't exist",
  ].join("\n"),
  inputSchema,

  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const filePath = resolve(context.cwd, input.file_path);
    const displayPath = relative(context.cwd, filePath);

    try {
      // Check if file already exists
      let isNew = true;
      try {
        await stat(filePath);
        isNew = false;
      } catch {
        // File doesn't exist, will create
      }

      // Ensure parent directory exists
      await mkdir(dirname(filePath), { recursive: true });

      // Write the file
      await writeFile(filePath, input.content, "utf-8");

      const lineCount = input.content.split("\n").length;
      const action = isNew ? "Created" : "Wrote";
      return {
        output: `✓ ${action} ${displayPath} (${lineCount} lines)`,
      };
    } catch (err: any) {
      return {
        output: `Error writing file: ${err.message}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
