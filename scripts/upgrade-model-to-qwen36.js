#!/usr/bin/env node
/**
 * 升级本地推理模型：Qwen3.5-35B-A3B → Qwen3.6-35B-A3B
 * 更新 adapter_nodes + agent_connections 两张表中指向 localhost:8000 的记录
 *
 * 用法：node scripts/upgrade-model-to-qwen36.js
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', 'kasia-console', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, '..', 'kasia-console', 'data', 'console.db');
const NEW_MODEL = 'Qwen3.6-35B-A3B';

const db = new Database(DB_PATH);

// ── 1. 查询当前状态 ──
console.log('\n=== 升级前状态 ===');

const adapters = db.prepare(
  `SELECT id, name, ai_provider_url, ai_model FROM adapter_nodes
   WHERE ai_provider_url LIKE '%localhost:8000%'`
).all();

console.log(`找到 ${adapters.length} 个本地 llama-server adapter:`);
adapters.forEach(a => console.log(`  [${a.name}] model: ${a.ai_model}`));

const connections = db.prepare(
  `SELECT id, adapter_node_id, base_url, model FROM agent_connections
   WHERE base_url LIKE '%localhost:8000%'`
).all();

console.log(`找到 ${connections.length} 个对应 connection:`);
connections.forEach(c => console.log(`  adapter=${c.adapter_node_id} model: ${c.model}`));

// ── 2. 更新 adapter_nodes ──
const updateAdapter = db.prepare(
  `UPDATE adapter_nodes SET ai_model = ? WHERE ai_provider_url LIKE '%localhost:8000%'`
);
const adapterResult = updateAdapter.run(NEW_MODEL);
console.log(`\nadapter_nodes 更新: ${adapterResult.changes} 行`);

// ── 3. 更新 agent_connections ──
const updateConn = db.prepare(
  `UPDATE agent_connections SET model = ? WHERE base_url LIKE '%localhost:8000%'`
);
const connResult = updateConn.run(NEW_MODEL);
console.log(`agent_connections 更新: ${connResult.changes} 行`);

// ── 4. 验证 ──
console.log('\n=== 升级后状态 ===');
const afterAdapters = db.prepare(
  `SELECT name, ai_model FROM adapter_nodes WHERE ai_provider_url LIKE '%localhost:8000%'`
).all();
afterAdapters.forEach(a => console.log(`  [${a.name}] model: ${a.ai_model}`));

const afterConns = db.prepare(
  `SELECT adapter_node_id, model FROM agent_connections WHERE base_url LIKE '%localhost:8000%'`
).all();
afterConns.forEach(c => console.log(`  connection model: ${c.model}`));

db.close();
console.log('\n✅ 模型升级完成。重启 KANet 后生效。\n');
