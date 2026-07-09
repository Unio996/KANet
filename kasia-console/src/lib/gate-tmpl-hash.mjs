// gate-tmpl-hash.mjs — gateTmplHash live-derive + round-trip 自证(J1tn, 2026-07-09 落码)。
//
// 根修 docs/2026-07-08-gate-tmplhash-live-derive-design.md(Bettor 方向审 GREEN-with-notes + NWT 红队 GREEN,
// J1 落码 GO)。解 D-009 冻结门(docs/DECISIONS.md)+ ANTI-PATTERNS.md 规则55(手工配对常量必失同步)的具体病灶:
// zk-close-builder.mjs 的 ZK_GATE.gateTmplHash 此前是跟 imageId 手动配对维护的硬编码常量,7/7 改 imageId
// 时忘了同步重算,潜伏一天多才在 zk_close 结算阶段炸(pxvml genesis 出生缺陷)。
//
// 关键洞察(§2.1, Bettor 双样本交叉验证+NWT 复核确认不需要再验): gate redeem 的 suffix(800B)只依赖
// imageId,不依赖具体 journalHash/receipt 内容(fixed-per-image_id)——所以任何一份该 imageId 的合法
// receipt(哪怕是旧的、别的市场用过的)都能推出同一个 gateTmplHash,不需要为每个新市场现跑一次 proving。

import { blake2b } from '@noble/hashes/blake2b';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// canonical sample = 7/7 3o6cs 那笔真实落链 receipt(zk-payout-guest/proofs/3o6cs-attest-0a358fa0/)。
// 写死引用路径(§2.1 落地清单第2条),不是每次现找/现跑 proving——suffix 只认 imageId,这份旧 receipt 永久够用。
const CANONICAL_SAMPLE_DIR = process.env.ZK_GATE_TMPL_CANONICAL_SAMPLE_DIR
  || join(HERE, '..', '..', '..', 'zk-payout-guest', 'proofs', '3o6cs-attest-0a358fa0');

let _sample = null;
function loadCanonicalSample() {
  if (_sample) return _sample;
  const receiptHex = readFileSync(join(CANONICAL_SAMPLE_DIR, '3o6cs_receipt.hex'), 'utf8').trim();
  const summary = JSON.parse(readFileSync(join(CANONICAL_SAMPLE_DIR, '3o6cs_receipt.summary.json'), 'utf8'));
  if (!summary.journal_digest) throw new Error(`loadCanonicalSample: ${CANONICAL_SAMPLE_DIR}/3o6cs_receipt.summary.json 缺 journal_digest 字段`);
  _sample = { receiptHex, journalHash: summary.journal_digest };
  return _sample;
}

/**
 * computeGateTmplHash — gate_tmpl_hash = blake2b(prefix(1B,0x20) ‖ suffix(800B)),suffix 从
 * ZkScriptBuilder 真实编译产物切出(跟 zk-close-dispatch.mjs rebuildZkCloseGateWitness 用的
 * 同一条切法 redeemBuf.subarray(33) ——两处各自实现是因为 rebuildZkCloseGateWitness 是已审查过的
 * 生产 witness 重建函数,本次改动不碰它;drift 风险由 gate-tmpl-hash.selftest.mjs 的交叉断言兜底,
 * 不是"两套并行实现互不知道对方"）。
 * @param {string} imageId 32B hex, 结算 guest image_id
 * @param {string} sampleReceiptHex 该 imageId 任一份合法 receipt 的 borsh hex(canonical sample 够用)
 * @param {string} sampleJournalHash 该 receipt 对应的 journal digest hex(内容无关,只影响 commit 不影响 suffix)
 * @param {() => object} kaspaZk ctx.kaspaZk() 同款签名(ZK-SDK isolated WASM 加载器)
 * @returns {string} gate_tmpl_hash hex(32B)
 */
export function computeGateTmplHash(imageId, sampleReceiptHex, sampleJournalHash, kaspaZk) {
  const kaspa = kaspaZk();
  const builder = kaspa.ZkScriptBuilder.newR0({ flags: { covenantsEnabled: true } });
  builder.commitToGroth16WithFixedJournal(imageId, sampleJournalHash);
  const { redeemScript } = builder.finalizeWithGroth16FixedJournalProof(sampleReceiptHex);
  const redeemBuf = Buffer.from(redeemScript, 'hex');
  if (redeemBuf.length <= 33) throw new Error(`computeGateTmplHash: redeemScript 太短(${redeemBuf.length}B) — 无法切出 suffix`);
  const suffix = redeemBuf.subarray(33); // prefix(1B)+journalHash(32B) 之后即 suffix,同 rebuildZkCloseGateWitness 切法
  return Buffer.from(blake2b(Buffer.concat([Buffer.from([0x20]), suffix]), { dkLen: 32 })).toString('hex');
}

// round-trip 自证(§2.2, Bettor 注3 + NWT 审强制折入): 不在 console 进程启动那一刻无条件跑——非 ZK 节点
// 没装 ZKSDK_WASM_PATH,无条件跑会让这些实例因为一个跟它们无关的新增强校验直接炸掉整个进程启动(#22族
// 教训: 根治一个 drift 风险不该引入一个更 broad 的可用性风险)。改成 lazy,gate 在既有生产开关
// ZK_PROVE_WORKER_ENABLED 后面(zk-prove-worker.mjs 已有,默认 OFF,复用不新开一个)。
// 调用点(设计稿钉死): zkProveWorkerTick() 首次真正跑 proving 之前 / rebuildZkCloseGateWitness 首次被调用之前
// (两个 ZK 功能真正被使用的入口,而非"进程启动"这个跟是否使用 ZK 无关的时间点)。
let _zkGateVerified = false;
export function ensureGateTmplHashFresh(ZK_GATE, kaspaZk) {
  if (_zkGateVerified || process.env.ZK_PROVE_WORKER_ENABLED !== '1') return;
  const { receiptHex, journalHash } = loadCanonicalSample();
  const computed = computeGateTmplHash(ZK_GATE.imageId, receiptHex, journalHash, kaspaZk);
  if (computed !== ZK_GATE.gateTmplHash) {
    throw new Error(`gateTmplHash 配置漂移: 烤死值=${ZK_GATE.gateTmplHash} != 现算=${computed}(imageId=${ZK_GATE.imageId.slice(0, 16)}...) — imageId 刚变过或常量已过期(规则55同族雷), fail-loud 不静默沿用可能错的值`);
  }
  _zkGateVerified = true;
}

// 仅测试/诊断用: 重置 memo,不导出进正常业务路径。
export function _resetVerifiedForTest() { _zkGateVerified = false; }
