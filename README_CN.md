# nano-claude-code

一个极简的、可 hack 的终端 AI 编程助手 —— 灵感来自 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，提炼至其本质。

> **1,646 行 TypeScript。15 个源文件。4 个运行时依赖。**
> 在终端中与 LLM 结对编程所需的一切。没有多余的东西。

## 为什么做这个？

Claude Code 是一个强大的 512K+ 行代码库，包含 1,900+ 个文件。这对于生产级产品来说很棒，但很难理解、修改或学习。**nano-claude-code** 将其精简到 AI 编程助手的核心循环：

```
用户输入 → LLM 推理 → 工具调用 → 执行 → 结果回传 → 重复
```

## 功能特性

- 🔄 **Agent 循环** — 核心的 查询 → 工具调用 → 结果 → 推理 循环（最多 30 轮）
- 🌊 **流式输出** — LLM 思考时逐 token 实时显示
- 🛠️ **6 个核心工具** — Bash、FileRead、FileEdit、FileWrite、Grep、Glob
- 🔐 **权限系统** — 只读工具自动放行；写入/Shell 操作需要用户确认
- 📋 **上下文感知** — 自动读取 `CLAUDE.md`、检测项目类型、收集 Git 信息
- 💬 **交互式 REPL** — 斜杠命令（`/help`、`/clear`、`/history`、`/exit`）
- 📡 **管道模式** — 非交互模式，支持脚本化：`echo "修复这个 bug" | nano-claude`
- 🔌 **Provider 抽象** — `LLMProvider` 接口，可扩展 OpenAI/Ollama/本地模型

## 架构

```
nano-claude-code/
├── src/
│   ├── main.ts               # 入口：终端 REPL + 斜杠命令 + 权限交互
│   ├── agentLoop.ts           # 核心：LLM 调用 → 工具检测 → 执行 → 循环
│   ├── types.ts               # 类型定义：Message, Tool, Provider, Config
│   ├── prompt.ts              # 系统提示词构建器
│   ├── context.ts             # 上下文收集器（CLAUDE.md + 项目检测 + Git）
│   ├── api/
│   │   └── anthropic.ts       # Anthropic 流式 API Provider
│   ├── tools/
│   │   ├── index.ts           # 工具注册表
│   │   ├── bash.ts            # Shell 命令执行
│   │   ├── fileRead.ts        # 文件读取（带行号）
│   │   ├── fileEdit.ts        # 搜索替换编辑
│   │   ├── fileWrite.ts       # 文件创建/写入
│   │   ├── grep.ts            # 正则搜索（ripgrep/grep）
│   │   └── glob.ts            # 文件名模式匹配
│   └── utils/
│       ├── config.ts          # 配置加载（环境变量 + JSON 文件）
│       └── schema.ts          # Zod → JSON Schema 转换
├── package.json
└── tsconfig.json
```

### 与 Claude Code 的对比

| 指标 | Claude Code | nano-claude-code |
|---|---|---|
| 源码文件数 | ~1,900 | **15** |
| 代码行数 | 512,000+ | **1,646** |
| 运行时依赖 | 50+ | **4** |
| 工具数量 | 40+ | **6** |
| 运行时 | Bun | **Node.js ≥ 20** |

## 快速开始

### 前置要求

- Node.js ≥ 20
- Anthropic API Key

### 安装与运行

```bash
# 克隆
git clone https://github.com/dadiaomengmeimei/nano-claude-code.git
cd nano-claude-code

# 安装依赖
npm install

# 编译
npm run build

# 设置 API Key
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# 运行
npm start
```

### 配置

配置从环境变量和 `~/.nano-claude.json` 加载：

| 环境变量 | 配置键 | 默认值 | 说明 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `apiKey` | — | Anthropic API Key |
| `NANO_MODEL` | `model` | `claude-sonnet-4-20250514` | 使用的模型 |
| `NANO_MAX_TOKENS` | `maxTokens` | `16384` | 每次响应的最大 token 数 |
| `NANO_PERMISSION_MODE` | `permissionMode` | `ask` | `ask`（询问）或 `auto`（自动） |

配置文件示例 `~/.nano-claude.json`：

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 16384,
  "permissionMode": "ask"
}
```

### 使用方式

**交互模式：**

```bash
npm start
# 然后输入你的请求：
❯ 读取 package.json 并介绍这个项目
❯ 查找代码库中所有的 TODO 注释
❯ 修复 src/utils.ts 中的类型错误
❯ /help
❯ /clear
❯ /exit
```

**管道模式（用于脚本化）：**

```bash
echo "列出 src/ 下所有 TypeScript 文件" | ANTHROPIC_API_KEY=sk-ant-xxx npm start
```

## 工作原理

核心是 **Agent Loop**（`agentLoop.ts`）：

```
┌─────────────────────────────────────────────┐
│                 Agent Loop                   │
│                                              │
│  1. 发送消息到 LLM（流式）                    │
│  2. 实时接收响应 token                        │
│  3. 如果响应包含 tool_use 块：                │
│     a. 解析工具名称 + 输入参数                │
│     b. 检查权限（ask/auto）                   │
│     c. 执行工具                              │
│     d. 将工具结果追加到对话                    │
│     e. 回到步骤 1                            │
│  4. 如果响应是纯文本：结束                    │
│                                              │
│  最大轮次：30                                │
└─────────────────────────────────────────────┘
```

## 扩展

### 添加新工具

```typescript
// src/tools/myTool.ts
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  query: z.string().describe("搜索内容"),
});

export const MyTool: ToolDefinition = {
  name: "MyTool",
  description: "做一些有用的事情",
  inputSchema,
  async call(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    // 你的逻辑
    return { output: `结果：${input.query}` };
  },
  formatResult(result) {
    return result.output;
  },
};
```

然后在 `src/tools/index.ts` 中注册。

### 添加新的 LLM Provider

实现 `LLMProvider` 接口：

```typescript
export interface LLMProvider {
  name: string;
  stream(options: ProviderOptions): AsyncIterable<StreamEvent>;
}
```

参考 `src/api/anthropic.ts` 的实现。

## 许可证

MIT
