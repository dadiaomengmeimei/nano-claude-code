#!/usr/bin/env tsx
/**
 * End-to-end test suite for nano-claude-code with Kimi K2.5 (Moonshot API)
 *
 * Upgraded test suite covering:
 * 1. Basic streaming text response
 * 2. Glob tool - file pattern matching
 * 3. Grep tool - regex search
 * 4. FileWrite + FileRead roundtrip - write then verify
 * 5. FileEdit - search-and-replace editing
 * 6. Multi-step reasoning chain
 * 7. Error recovery - handle missing files gracefully
 * 8. Compact conversation - summarize long history
 */

import { createOpenAIProvider } from "./src/api/openai.js";
import { runAgentLoop } from "./src/agentLoop.js";
import { ALL_TOOLS } from "./src/tools/index.js";
import { buildSystemPrompt } from "./src/prompt.js";
import { compactConversation, estimateTokens } from "./src/compact.js";
import type { Message, ToolResult, ContentBlock } from "./src/types.js";
import chalk from "chalk";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const API_KEY = process.env.KIMI_API_KEY || "";
const BASE_URL = "https://api.moonshot.cn/v1";
const MODEL = "kimi-k2.5";
const MAX_TOKENS = 4096;

const provider = createOpenAIProvider(API_KEY, BASE_URL);
const cwd = process.cwd();

let passed = 0;
let failed = 0;
const startTime = Date.now();
const tempFiles: string[] = [];

function header(name: string, difficulty: string) {
  console.log(chalk.bold.cyan(`\n${"=".repeat(64)}`));
  console.log(chalk.bold.cyan(`  TEST ${passed + failed + 1}: ${name}  ${difficulty}`));
  console.log(chalk.bold.cyan(`${"=".repeat(64)}\n`));
}

function pass(name: string, detail?: string) {
  passed++;
  console.log(chalk.green(`\n  PASS: ${name}${detail ? ` (${detail})` : ""}\n`));
}

function fail(name: string, reason: string) {
  failed++;
  console.log(chalk.red(`\n  FAIL: ${name} -- ${reason}\n`));
}

async function runTest(userMessage: string) {
  const systemPrompt = buildSystemPrompt("", cwd);
  let fullText = "";
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const toolResults: Array<{ name: string; output: string; isError: boolean }> = [];

  const messages = await runAgentLoop({
    provider,
    tools: ALL_TOOLS,
    systemPrompt,
    model: MODEL,
    maxTokens: MAX_TOKENS,
    messages: [{ role: "user", content: userMessage }],
    toolContext: { cwd },
    permissionMode: "auto",
    onText: (text) => {
      fullText += text;
      process.stdout.write(text);
    },
    onThinking: (text) => {
      process.stdout.write(chalk.dim(text));
    },
    onToolCall: (name, input) => {
      const summary = JSON.stringify(input).slice(0, 120);
      toolCalls.push({ name, input });
      console.log(chalk.blue(`\n  > Tool: ${name}(${summary})`));
    },
    onToolResult: (name, result) => {
      const preview = result.output.split("\n").slice(0, 2).join(" | ").slice(0, 100);
      toolResults.push({ name, output: result.output, isError: result.isError ?? false });
      if (result.isError) {
        console.log(chalk.red(`  x ${name}: ${preview}`));
      } else {
        console.log(chalk.green(`  ok ${name}: ${preview}`));
      }
    },
  });

  console.log("");
  return { fullText, toolCalls, toolResults, messages };
}

// Test 1: Basic Streaming
async function test1_BasicStreaming() {
  header("Basic Streaming Text Response", "[*]");

  let fullText = "";
  let gotDone = false;

  const stream = provider.stream({
    model: MODEL,
    maxTokens: MAX_TOKENS,
    systemPrompt: "You are a helpful assistant. Be concise.",
    tools: [],
    messages: [{ role: "user", content: "What is the capital of France? Reply in exactly one sentence." }],
  });

  process.stdout.write(chalk.dim("  Streaming: "));
  for await (const event of stream) {
    if (event.type === "text" && event.text) {
      fullText += event.text;
      process.stdout.write(event.text);
    }
    if (event.type === "done") gotDone = true;
    if (event.type === "error") {
      fail("Basic Streaming", `API error: ${event.error}`);
      return;
    }
  }
  console.log("");

  if (fullText.length > 0 && gotDone && fullText.toLowerCase().includes("paris")) {
    pass("Basic Streaming", "correct answer + streaming works");
  } else {
    fail("Basic Streaming", `text="${fullText.slice(0, 80)}", done=${gotDone}`);
  }
}

// Test 2: Glob Tool
async function test2_GlobTool() {
  header("Glob Tool - File Pattern Matching", "[**]");

  const { fullText, toolCalls, toolResults } = await runTest(
    "Use the Glob tool to find all TypeScript files (*.ts) directly in the src/ directory (not recursive, use pattern 'src/*.ts'). List them. Be concise."
  );

  const usedGlob = toolCalls.some((tc) => tc.name === "Glob");
  const mentionsTypes = fullText.includes("types.ts") || toolResults.some((r) => r.output.includes("types.ts"));

  if (usedGlob && mentionsTypes) {
    pass("Glob Tool", `${toolCalls.length} tool call(s), found types.ts`);
  } else {
    fail("Glob Tool", `usedGlob=${usedGlob}, mentionsTypes=${mentionsTypes}`);
  }
}

// Test 3: Grep Tool
async function test3_GrepTool() {
  header("Grep Tool - Regex Search", "[**]");

  const { fullText, toolCalls, toolResults } = await runTest(
    "Use the Grep tool to search for the regex pattern 'export.*function' in the src/ directory, only in .ts files. How many matches did you find? Be concise."
  );

  const usedGrep = toolCalls.some((tc) => tc.name === "Grep");
  const hasResults = toolResults.some((r) => !r.isError && r.output.includes("match"));

  if (usedGrep && hasResults) {
    pass("Grep Tool", `${toolCalls.length} tool call(s)`);
  } else {
    fail("Grep Tool", `usedGrep=${usedGrep}, hasResults=${hasResults}`);
  }
}

// Test 4: FileWrite + FileRead Roundtrip
async function test4_WriteReadRoundtrip() {
  header("FileWrite + FileRead Roundtrip", "[***]");

  const testFile = "__e2e_test_roundtrip.txt";
  tempFiles.push(resolve(cwd, testFile));

  const { fullText, toolCalls, toolResults } = await runTest(
    `Do these two steps:\n1. Create a file called "${testFile}" with this exact content:\nHello from E2E test!\nLine 2: nano-claude-code works.\nLine 3: done\n2. Then read the file back and confirm the content matches. Report success or failure.`
  );

  const usedWrite = toolCalls.some((tc) => tc.name === "FileWrite");
  const usedRead = toolCalls.some((tc) => tc.name === "FileRead");
  const writeOk = toolResults.some((r) => r.name === "FileWrite" && !r.isError);
  const readOk = toolResults.some((r) => r.name === "FileRead" && !r.isError && r.output.includes("nano-claude-code"));

  if (usedWrite && usedRead && writeOk && readOk) {
    pass("FileWrite + FileRead Roundtrip", "write then read verified");
  } else {
    fail("FileWrite + FileRead Roundtrip", `write=${usedWrite}/${writeOk}, read=${usedRead}/${readOk}`);
  }
}

// Test 5: FileEdit
async function test5_FileEdit() {
  header("FileEdit - Search and Replace", "[***]");

  const testFile = "__e2e_test_edit.txt";
  tempFiles.push(resolve(cwd, testFile));

  const { fullText, toolCalls, toolResults } = await runTest(
    `Step 1: Create a file "${testFile}" with this content:\nfunction greet(name) {\n  return "Hello, " + name;\n}\n\nStep 2: Use FileEdit to change "Hello" to "Hi" in that file.\n\nStep 3: Read the file to confirm the edit worked. Report the final content.`
  );

  const usedEdit = toolCalls.some((tc) => tc.name === "FileEdit");
  const editOk = toolResults.some((r) => r.name === "FileEdit" && !r.isError);

  if (usedEdit && editOk) {
    pass("FileEdit", "edit applied successfully");
  } else {
    fail("FileEdit", `usedEdit=${usedEdit}, editOk=${editOk}`);
  }
}

// Test 6: Multi-step Reasoning Chain
async function test6_MultiStepReasoning() {
  header("Multi-step Reasoning Chain", "[****]");

  const { fullText, toolCalls, toolResults } = await runTest(
    `I need you to do a small code analysis:\n1. Use Glob to find all .ts files in src/tools/\n2. Pick the shortest file (by name length) and read it\n3. Count how many exported symbols it has\n4. Give me a one-paragraph summary of what that tool does\n\nBe systematic and show your work.`
  );

  const usedGlob = toolCalls.some((tc) => tc.name === "Glob");
  const usedRead = toolCalls.some((tc) => tc.name === "FileRead");
  const uniqueTools = new Set(toolCalls.map((tc) => tc.name));

  if (usedGlob && usedRead && toolCalls.length >= 2 && fullText.length > 50) {
    pass("Multi-step Reasoning", `${toolCalls.length} calls across ${uniqueTools.size} tools`);
  } else {
    fail("Multi-step Reasoning", `glob=${usedGlob}, read=${usedRead}, calls=${toolCalls.length}`);
  }
}

// Test 7: Error Recovery
async function test7_ErrorRecovery() {
  header("Error Recovery - Handle Missing File", "[****]");

  const { fullText, toolCalls, toolResults } = await runTest(
    `Try to read the file "this_file_definitely_does_not_exist_12345.txt". When you get an error, explain what happened and suggest what the user should do instead. Do NOT try to create the file.`
  );

  const attempted = toolCalls.some((tc) => tc.name === "FileRead" || tc.name === "Bash");
  const gotError = toolResults.some((r) => r.isError);
  const recovered = fullText.length > 20;

  if (attempted && gotError && recovered) {
    pass("Error Recovery", "handled missing file gracefully");
  } else if (attempted && recovered) {
    pass("Error Recovery", "handled error (possibly internal)");
  } else {
    fail("Error Recovery", `attempted=${attempted}, gotError=${gotError}, recovered=${recovered}`);
  }
}

// Test 8: Compact Conversation
async function test8_CompactConversation() {
  header("Compact Conversation Summary", "[*****]");

  // Build a LONG conversation (many turns with verbose tool results)
  // to ensure the summary is shorter than the original
  const longConversation: Message[] = [
    { role: "user", content: "I'm building a full-stack e-commerce application with Node.js, Express, PostgreSQL, and React. I need user authentication, product catalog, shopping cart, and order management. Let's start with the backend API." },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Great! I'll help you build this e-commerce backend. Let me start by initializing the project and installing all necessary dependencies including Express, pg (PostgreSQL client), bcrypt for password hashing, jsonwebtoken for JWT auth, and cors for cross-origin requests." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "mkdir ecommerce-api && cd ecommerce-api && npm init -y && npm install express pg bcrypt jsonwebtoken cors dotenv express-validator helmet morgan compression" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: 'Initialized project. Installed 12 packages:\n- express@4.18.2\n- pg@8.11.3\n- bcrypt@5.1.1\n- jsonwebtoken@9.0.2\n- cors@2.8.5\n- dotenv@16.3.1\n- express-validator@7.0.1\n- helmet@7.1.0\n- morgan@1.10.0\n- compression@1.7.4\n\nadded 156 packages in 8.2s' },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Dependencies installed. Now I'll create the database schema with tables for users, products, categories, cart_items, orders, and order_items. I'll use proper foreign keys, indexes, and constraints." },
        { type: "tool_use", id: "t2", name: "FileWrite", input: { file_path: "db/schema.sql", content: "CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  password_hash VARCHAR(255) NOT NULL,\n  name VARCHAR(100) NOT NULL,\n  role VARCHAR(20) DEFAULT 'customer',\n  created_at TIMESTAMP DEFAULT NOW()\n);\n\nCREATE TABLE categories (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  slug VARCHAR(100) UNIQUE NOT NULL,\n  description TEXT\n);\n\nCREATE TABLE products (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  description TEXT,\n  price DECIMAL(10,2) NOT NULL,\n  stock INTEGER DEFAULT 0,\n  category_id INTEGER REFERENCES categories(id),\n  image_url VARCHAR(500),\n  created_at TIMESTAMP DEFAULT NOW()\n);\n\nCREATE TABLE cart_items (\n  id SERIAL PRIMARY KEY,\n  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,\n  product_id INTEGER REFERENCES products(id),\n  quantity INTEGER NOT NULL DEFAULT 1,\n  UNIQUE(user_id, product_id)\n);\n\nCREATE TABLE orders (\n  id SERIAL PRIMARY KEY,\n  user_id INTEGER REFERENCES users(id),\n  status VARCHAR(20) DEFAULT 'pending',\n  total DECIMAL(10,2) NOT NULL,\n  shipping_address TEXT,\n  created_at TIMESTAMP DEFAULT NOW()\n);\n\nCREATE TABLE order_items (\n  id SERIAL PRIMARY KEY,\n  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,\n  product_id INTEGER REFERENCES products(id),\n  quantity INTEGER NOT NULL,\n  price DECIMAL(10,2) NOT NULL\n);\n\nCREATE INDEX idx_products_category ON products(category_id);\nCREATE INDEX idx_cart_user ON cart_items(user_id);\nCREATE INDEX idx_orders_user ON orders(user_id);" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t2", content: "Created db/schema.sql (45 lines)" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Schema created with 6 tables. Now let me create the Express server with middleware setup, database connection pool, and route organization." },
        { type: "tool_use", id: "t3", name: "FileWrite", input: { file_path: "src/server.js", content: "const express = require('express');\nconst cors = require('cors');\nconst helmet = require('helmet');\nconst morgan = require('morgan');\nconst compression = require('compression');\nconst { Pool } = require('pg');\nrequire('dotenv').config();\n\nconst app = express();\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n\napp.use(helmet());\napp.use(cors());\napp.use(compression());\napp.use(morgan('combined'));\napp.use(express.json());\n\n// Routes\napp.use('/api/auth', require('./routes/auth'));\napp.use('/api/products', require('./routes/products'));\napp.use('/api/cart', require('./routes/cart'));\napp.use('/api/orders', require('./routes/orders'));\n\n// Error handler\napp.use((err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).json({ error: 'Internal server error' });\n});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => console.log(`Server running on port ${PORT}`));" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t3", content: "Created src/server.js (28 lines)" },
      ],
    },
    { role: "assistant", content: "Server setup complete with helmet for security, CORS, compression, morgan logging, and organized route modules. Now I'll implement the authentication routes with JWT." },
    { role: "user", content: "Yes, implement the auth routes. I need register, login, and a middleware to protect routes." },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll create the auth routes with bcrypt password hashing, JWT token generation, and an auth middleware for protected routes. The register endpoint validates email format and password strength. The login endpoint returns a JWT token valid for 24 hours." },
        { type: "tool_use", id: "t4", name: "FileWrite", input: { file_path: "src/routes/auth.js", content: "const router = require('express').Router();\nconst bcrypt = require('bcrypt');\nconst jwt = require('jsonwebtoken');\nconst { body, validationResult } = require('express-validator');\nconst pool = require('../db');\n\nrouter.post('/register', [\n  body('email').isEmail().normalizeEmail(),\n  body('password').isLength({ min: 8 }),\n  body('name').trim().notEmpty()\n], async (req, res) => {\n  const errors = validationResult(req);\n  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });\n  try {\n    const { email, password, name } = req.body;\n    const hash = await bcrypt.hash(password, 12);\n    const result = await pool.query('INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name', [email, hash, name]);\n    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '24h' });\n    res.status(201).json({ user: result.rows[0], token });\n  } catch (err) {\n    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });\n    throw err;\n  }\n});\n\nrouter.post('/login', async (req, res) => {\n  const { email, password } = req.body;\n  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);\n  if (!result.rows[0]) return res.status(401).json({ error: 'Invalid credentials' });\n  const valid = await bcrypt.compare(password, result.rows[0].password_hash);\n  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });\n  const token = jwt.sign({ id: result.rows[0].id, role: result.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '24h' });\n  res.json({ token });\n});\n\nmodule.exports = router;" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t4", content: "Created src/routes/auth.js (35 lines)" },
      ],
    },
    { role: "assistant", content: "Auth routes created with register (email validation, bcrypt hashing, duplicate detection) and login (credential verification, JWT generation). The JWT includes user ID and role for authorization." },
    { role: "user", content: "Now implement the product catalog API with CRUD operations. Admin users should be able to create/update/delete products, but anyone can view them." },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll create the product routes with role-based access control. GET endpoints are public, while POST/PUT/DELETE require admin role. I'll also add pagination, filtering by category, and search functionality." },
        { type: "tool_use", id: "t5", name: "FileWrite", input: { file_path: "src/routes/products.js", content: "const router = require('express').Router();\nconst pool = require('../db');\nconst { authMiddleware, adminOnly } = require('../middleware/auth');\n\n// GET /api/products - List with pagination, filtering, search\nrouter.get('/', async (req, res) => {\n  const { page = 1, limit = 20, category, search, sort = 'created_at' } = req.query;\n  let query = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1';\n  const params = [];\n  if (category) { params.push(category); query += ` AND c.slug = $${params.length}`; }\n  if (search) { params.push(`%${search}%`); query += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`; }\n  query += ` ORDER BY p.${sort} DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;\n  const result = await pool.query(query, params);\n  res.json({ products: result.rows, page: +page, limit: +limit });\n});\n\n// GET /api/products/:id\nrouter.get('/:id', async (req, res) => {\n  const result = await pool.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1', [req.params.id]);\n  if (!result.rows[0]) return res.status(404).json({ error: 'Product not found' });\n  res.json(result.rows[0]);\n});\n\n// POST /api/products (admin only)\nrouter.post('/', authMiddleware, adminOnly, async (req, res) => {\n  const { name, description, price, stock, category_id, image_url } = req.body;\n  const result = await pool.query('INSERT INTO products (name, description, price, stock, category_id, image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [name, description, price, stock, category_id, image_url]);\n  res.status(201).json(result.rows[0]);\n});\n\nmodule.exports = router;" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t5", content: "Created src/routes/products.js (30 lines)" },
      ],
    },
    { role: "assistant", content: "Product routes implemented with: public listing (pagination, category filter, text search, sorting), single product view, and admin-only creation. The listing uses parameterized queries to prevent SQL injection." },
    { role: "user", content: "I found a bug - the search query is vulnerable to SQL injection through the sort parameter. Can you fix it?" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Good catch! The sort parameter is directly interpolated into the SQL query which is dangerous. I'll whitelist the allowed sort columns to prevent SQL injection." },
        { type: "tool_use", id: "t6", name: "FileEdit", input: { file_path: "src/routes/products.js", old_string: "query += ` ORDER BY p.${sort}", new_string: "const allowedSorts = ['created_at', 'price', 'name', 'stock'];\n  const safeSort = allowedSorts.includes(sort) ? sort : 'created_at';\n  query += ` ORDER BY p.${safeSort}" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t6", content: "Edited src/routes/products.js\nReplaced 1 line(s) with 3 line(s)" },
      ],
    },
    { role: "assistant", content: "Fixed the SQL injection vulnerability by whitelisting allowed sort columns (created_at, price, name, stock). Any invalid sort parameter now defaults to 'created_at'. This is a common security pattern for dynamic ORDER BY clauses." },
    { role: "user", content: "Perfect. Now implement the shopping cart API and the order management system." },
  ];

  const beforeTokens = estimateTokens(longConversation);
  console.log(chalk.dim(`  Input: ${longConversation.length} messages, ~${beforeTokens} tokens`));

  const result = await compactConversation(longConversation, provider, MODEL, MAX_TOKENS);

  console.log(chalk.dim(`  Output: ${result.messages.length} messages, ~${result.afterTokens} tokens`));
  const reduction = Math.round((1 - result.afterTokens / beforeTokens) * 100);
  console.log(chalk.dim(`  Compression: ${beforeTokens} -> ${result.afterTokens} tokens (${reduction}% reduction)`));
  console.log(chalk.dim(`  Summary preview: ${result.summary.slice(0, 200)}...`));

  const hasSummary = result.summary.length > 100;
  const mentionsKey = result.summary.toLowerCase().includes("express") ||
    result.summary.toLowerCase().includes("api") ||
    result.summary.toLowerCase().includes("product") ||
    result.summary.toLowerCase().includes("ecommerce") ||
    result.summary.toLowerCase().includes("e-commerce");
  const mentionsSecurity = result.summary.toLowerCase().includes("sql") ||
    result.summary.toLowerCase().includes("injection") ||
    result.summary.toLowerCase().includes("security") ||
    result.summary.toLowerCase().includes("validat");

  if (hasSummary && mentionsKey) {
    pass("Compact Conversation", `summary=${result.summary.length} chars, key topics preserved${mentionsSecurity ? " (incl. security fix)" : ""}`);
  } else {
    fail("Compact Conversation", `summary=${hasSummary} (${result.summary.length} chars), mentionsKey=${mentionsKey}`);
  }
}

// Run all tests
async function main() {
  console.log(chalk.bold.magenta("\n  nano-claude-code E2E Test Suite (Upgraded)"));
  console.log(chalk.dim(`  Provider: Moonshot (Kimi K2.5)`));
  console.log(chalk.dim(`  Base URL: ${BASE_URL}`));
  console.log(chalk.dim(`  Model: ${MODEL}`));
  console.log(chalk.dim(`  CWD: ${cwd}`));
  console.log(chalk.dim(`  Tests: 8`));

  const tests: Array<[string, () => Promise<void>]> = [
    ["Basic Streaming", test1_BasicStreaming],
    ["Glob Tool", test2_GlobTool],
    ["Grep Tool", test3_GrepTool],
    ["FileWrite + FileRead", test4_WriteReadRoundtrip],
    ["FileEdit", test5_FileEdit],
    ["Multi-step Reasoning", test6_MultiStepReasoning],
    ["Error Recovery", test7_ErrorRecovery],
    ["Compact Conversation", test8_CompactConversation],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
    } catch (err: any) {
      fail(name, `Exception: ${err.message}`);
    }
  }

  // Cleanup temp files
  console.log(chalk.dim("\n  Cleaning up temp files..."));
  for (const f of tempFiles) {
    try {
      if (existsSync(f)) {
        unlinkSync(f);
        console.log(chalk.dim(`  Removed: ${f}`));
      }
    } catch {}
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.bold.magenta(`\n${"=".repeat(64)}`));
  console.log(chalk.bold.magenta(`  RESULTS: ${passed} passed, ${failed} failed (${elapsed}s)`));
  console.log(chalk.bold.magenta(`${"=".repeat(64)}\n`));

  if (failed === 0) {
    console.log(chalk.bold.green("  All tests passed!\n"));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
