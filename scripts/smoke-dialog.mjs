// smoke-dialog.mjs — 真金实测 LLM 对话层
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = path.join(__d, '../kasia-console/data/console.db');

const { interpret, validateOrder, clearHistory } = await import('file:///' + path.join(__d, '../kasia-console/src/services/retail-dex-dialog.js').replace(/\\/g, '/'));

const USER = 'kaspa:qsmoketest1';

async function turn(msg) {
  console.log(`\n===== 用户: ${msg}`);
  const t0 = Date.now();
  const r = await interpret(USER, msg);
  console.log(`===== Broker (${Date.now() - t0}ms): ${r.ready ? 'ORDER READY' : (r.cancel ? 'CANCEL' : 'ASK')}`);
  console.log(r.ready ? JSON.stringify(r.order, null, 2) : r.reply);
  return r;
}

clearHistory(USER);

await turn('买kas');
await turn('买50个kas');
await turn('BSC 链');
await turn('我的地址是 0x0000000000000000000000000000000000001234');
