/**
 * FileEditTool - Edit files using search and replace
 *
 * @source ../src/tools/FileEditTool/FileEditTool.ts
 * @source ../src/tools/FileEditTool/prompt.ts
 *
 * Original FileEditTool.ts has:
 * - Fuzzy matching with Levenshtein distance for near-misses
 * - File history tracking (before/after snapshots)
 * - Commit attribution tracking
 * - Lint diagnostics integration
 * - Skill discovery from edited paths
 * - React diff rendering
 *
 * Nano keeps: exact string replacement with ambiguity detection.
 * Removed: fuzzy matching, file history, attribution, lint, skills.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

/**
 * Input schema.
 * @source FileEditTool.ts - inputSchema
 * Original has: file_path, old_string, new_string
 * Nano adds: replace_all option
 */
const inputSchema = z.object({
  file_path: z.string().describe("The path of the file to edit"),
  old_string: z
    .string()
    .describe("The exact text to find and replace. Must match exactly including whitespace and indentation."),
  new_string: z
    .string()
    .describe("The replacement text. Can be empty to delete the old_string."),
  replace_all: z
    .boolean()
    .optional()
    .describe("If true, replace all occurrences. Default is false (replace first occurrence only)."),
});

export const FileEditTool: ToolDefinition = {
  name: "FileEdit",
  description: [
    "Edits a file by replacing exact text matches.",
    "",
    "Usage notes:",
    "- old_string must match the file content EXACTLY (including whitespace, indentation)",
    "- Always read the file first to get the exact content before editing",
    "- For creating new files, use FileWrite instead",
    "- The tool will show a diff of the changes made",
  ].join("\n"),
  inputSchema,

  /** @source FileEditTool.ts - isReadOnly() { return false } */
  isReadOnly() {
    return false;
  },

  /**
   * @source FileEditTool.ts - call()
   * Original has: fuzzy matching fallback, file history snapshot,
   * attribution tracking, lint check, skill discovery.
   * Nano: exact match with ambiguity check.
   */
  async call(
    rawInput: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const input = inputSchema.parse(rawInput);
    const filePath = resolve(context.cwd, input.file_path);
    const displayPath = relative(context.cwd, filePath);

    try {
      const content = await readFile(filePath, "utf-8");

      if (!content.includes(input.old_string)) {
        return {
          output: `Error: old_string not found in ${displayPath}. Make sure it matches exactly (including whitespace and indentation). Read the file first to get the exact content.`,
          isError: true,
        };
      }

      // Check for ambiguous matches
      if (!input.replace_all) {
        const count = content.split(input.old_string).length - 1;
        if (count > 1) {
          return {
            output: `Error: old_string found ${count} times in ${displayPath}. Provide more context to uniquely identify the location, or set replace_all to true.`,
            isError: true,
          };
        }
      }

      // Perform replacement
      let newContent: string;
      if (input.replace_all) {
        newContent = content.split(input.old_string).join(input.new_string);
      } else {
        newContent = content.replace(input.old_string, input.new_string);
      }

      await writeFile(filePath, newContent, "utf-8");

      const oldLines = input.old_string.split("\n").length;
      const newLines = input.new_string.split("\n").length;
      const output = [
        `\u2713 Edited ${displayPath}`,
        `  Replaced ${oldLines} line(s) with ${newLines} line(s)`,
      ].join("\n");

      return { output };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return {
          output: `Error: File not found: ${displayPath}. Use FileWrite to create new files.`,
          isError: true,
        };
      }
      return {
        output: `Error editing file: ${err.message}`,
        isError: true,
      };
    }
  },

  formatResult(result: ToolResult): string {
    return result.output;
  },
};
