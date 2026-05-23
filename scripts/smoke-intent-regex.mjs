// smoke-intent-regex.mjs — 验证 parseIntent 接受中文量词 (bug: 买50个kas 不识别)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = path.join(__dirname, '../kasia-console/data/console.db');

const { parseIntent } = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/retail-dex.js').replace(/\\/g, '/'));

const cases = [
  // 用户真实输入 (截图中)
  ['买kas',          null,                  '无数字应返 null 走兜底'],
  ['买50个kas',      {side:'buy_kas',qty:'50',order_type:'market'}, '中文量词 个 必须识别'],
  ['买50kas',        {side:'buy_kas',qty:'50',order_type:'market'}, '无空格紧贴'],
  ['买 50 KAS',      {side:'buy_kas',qty:'50',order_type:'market'}, '标准空格'],
  ['买 50 kas',      {side:'buy_kas',qty:'50',order_type:'market'}, '小写 kas'],
  ['buy 50 KAS',     {side:'buy_kas',qty:'50',order_type:'market'}, '英文 buy'],
  ['买 5 枚 KAS',    {side:'buy_kas',qty:'5',order_type:'market'}, '量词 枚'],
  ['买 3 只 KAS',    {side:'buy_kas',qty:'3',order_type:'market'}, '量词 只'],
  ['卖100个kas',     {side:'sell_kas',qty:'100',order_type:'market'}, '卖 + 量词'],
  ['买 50 KAS @ 0.04 USDT', {side:'buy_kas',qty:'50',order_type:'limit',price:'0.04'}, '限价'],
  ['买50个kas @0.04 USDT',  {side:'buy_kas',qty:'50',order_type:'limit',price:'0.04'}, '限价+量词'],
  ['买 50.5 KAS',    {side:'buy_kas',qty:'50.5',order_type:'market'}, '小数'],
  ['你好',           null, '无关消息'],
  ['',               null, '空消息'],
];

let pass = 0, fail = 0;
for (const [input, expected, desc] of cases) {
  const got = parseIntent(input);
  let ok;
  if (expected === null) {
    ok = got === null;
  } else {
    ok = got && got.side === expected.side && got.qty === expected.qty && got.order_type === expected.order_type
      && (expected.price === undefined || got.price === expected.price);
  }
  if (ok) { console.log(`  [PASS] "${input}" — ${desc}`); pass++; }
  else { console.log(`  [FAIL] "${input}" — ${desc} | got: ${JSON.stringify(got)}`); fail++; }
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
