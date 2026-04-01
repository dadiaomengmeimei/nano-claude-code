/**
 * Tool registry - exports all available tools
 */

import type { ToolDefinition } from "../types.js";
import { BashTool } from "./bash.js";
import { FileReadTool } from "./fileRead.js";
import { FileEditTool } from "./fileEdit.js";
import { FileWriteTool } from "./fileWrite.js";
import { GrepTool } from "./grep.js";
import { GlobTool } from "./glob.js";
import { SubAgentTool } from "./subAgent.js";

export const ALL_TOOLS: ToolDefinition[] = [
  BashTool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GrepTool,
  GlobTool,
  SubAgentTool,
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export { BashTool, FileReadTool, FileEditTool, FileWriteTool, GrepTool, GlobTool, SubAgentTool };
