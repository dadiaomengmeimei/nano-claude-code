/**
 * Tool registry - exports all available tools
 *
 * @source ../src/tools/ - Each tool is in its own directory
 * @source ../src/Tool.ts - findToolByName(), Tools type
 *
 * Original has 40+ tools organized in directories. Each tool directory
 * contains: ToolName.ts (or .tsx), prompt.ts, UI.tsx, constants.ts.
 * Tools are assembled into a pool by assembleToolPool() in toolPool.ts.
 *
 * Nano exports the 7 core tools as a flat array.
 */

import type { ToolDefinition } from "../types.js";
import { BashTool } from "./bash.js";
import { FileReadTool } from "./fileRead.js";
import { FileEditTool } from "./fileEdit.js";
import { FileWriteTool } from "./fileWrite.js";
import { GrepTool } from "./grep.js";
import { GlobTool } from "./glob.js";
import { SubAgentTool } from "./subAgent.js";

/**
 * All available tools.
 * @source ../src/utils/toolPool.ts - assembleToolPool()
 */
export const ALL_TOOLS: ToolDefinition[] = [
  BashTool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GrepTool,
  GlobTool,
  SubAgentTool,
];

/**
 * Find a tool by name.
 * @source ../src/Tool.ts - findToolByName(tools, name)
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export { BashTool, FileReadTool, FileEditTool, FileWriteTool, GrepTool, GlobTool, SubAgentTool };
