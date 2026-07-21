#!/usr/bin/env node
// coord-status-verify.mjs — D-010 落地① 读端验签 CLI(J1tn, 2026-07-10)。
//
// 接位者用这个命令验一条 coord-status 消息的签名(不需要跑 console API/relay 进程,
// 纯本地 crypto 验证,可离线跑)。验签不过 = 消息不存在(D-010 §2.1 铁律)。
//
// 用法:
//   node scripts/coord-status-verify.mjs <消息文件路径> <relay公钥hex>
//   cat message.txt | node scripts/coord-status-verify.mjs - <relay公钥hex>
//
// 退出码: 0=验签通过, 1=验签失败/参数错误。

import { readFileSync } from 'node:fs';
import { verifyCoordStatusMessage } from '../src/lib/coord-status-sign.mjs';

const [, , fileArg, pubkeyArg] = process.argv;

if (!fileArg || !pubkeyArg) {
  console.error('用法: node scripts/coord-status-verify.mjs <消息文件路径|-> <relay公钥hex>');
  process.exit(1);
}

const fullText = fileArg === '-'
  ? readFileSync(0, 'utf8')
  : readFileSync(fileArg, 'utf8');

const result = await verifyCoordStatusMessage(fullText, pubkeyArg);

if (result.valid) {
  console.log('✅ 验签通过');
  console.log('---正文---');
  console.log(result.content);
  process.exit(0);
} else {
  console.error(`❌ 验签失败: ${result.error || 'signature mismatch'}`);
  console.error('⚠ 按 D-010 铁律: 验签不过 = 这条消息不存在, 不要据此做任何决策');
  process.exit(1);
}
