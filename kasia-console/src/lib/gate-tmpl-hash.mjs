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
// ZK_PROVE_WORKER_ENABLED 后面(zk-prove-worker.mjs 已有,默认 OFF,复用不新开一个)——除非调用方传
// opts.force=true(genesis-bake/witness-rebuild 三个调用点专用: 这三处本身就要 WASM 才能继续往下走,
// 到这里 WASM 必然可用,flag 在这几处没有"炸非 ZK 节点"的可用性意义,不该被它挡住检查,见 finding②)。
//
// 🔴 根修(2026-07-09, NWT 红队 finding①HIGH·docs/2026-07-09-NWT-redteam-gate-tmplhash-live-derive-66de59c6.md):
// 首版只验了同文件内 ZK_GATE.imageId↔ZK_GATE.gateTmplHash 是否配对新鲜,但真正被烤进 covenant genesis 的值
// 读的是 process.env.ZK_GATE_TMPL_HASH(kanet.env,三处消费点: bshard-close-transport.mjs buildZkHandoffRequestV2
// /pool.js _resolveZkNativeCtorExtras/pool.js debugger endpoint)——ZK_GATE 常量本身新鲜不代表 env 也新鲜,
// 两者是纯人肉同步的两份拷贝(7/8 J2 修值就是手动改两处)。下次改 imageId 若只改一处漏另一处,guard 会全绿
// (它验的那份确实新鲜),但 stale 的那份照样烤进新 genesis——比没检查更糟(假安全感)。加一条跨源断言堵死。
//
// 调用点(设计稿钉死 + finding①(b) 补齐 genesis 上游两处): zkProveWorkerTick() 真正跑 proving 之前(lazy,
// 走 ZK_PROVE_WORKER_ENABLED 开关,这是后台 cron,每个节点无论是否用 ZK 都会跑,必须 lazy 防炸非 ZK 节点)/
// _resolveZkNativeCtorExtras 的 zkNative 分支内(force=true,mint 侧 genesis-bake,非 ZK 节点走不进这个分支)/
// buildZkHandoffRequestV2 的 gateTmplHash 读取处(force=true,handoff 侧 genesis-bake)/
// rebuildZkCloseGateWitness 首次被调用之前(force=true,zk_close 真广播+门②彩排共用入口)。
let _zkGateVerified = false;
export function ensureGateTmplHashFresh(ZK_GATE, kaspaZk, opts = {}) {
  const { force = false } = opts;
  if (_zkGateVerified) return;
  if (!force && process.env.ZK_PROVE_WORKER_ENABLED !== '1') return;
  // finding①(a): 跨源漂移断言——env(若已设)必须跟 ZK_GATE 常量一致。这条堵的是"两份拷贝各自看着都新鲜,
  // 但彼此不一致"这个 ZK_GATE 内部一致性检查照不到的盲区(env 才是真正烤进 genesis 的那份)。
  if (process.env.ZK_GATE_TMPL_HASH && process.env.ZK_GATE_TMPL_HASH !== ZK_GATE.gateTmplHash) {
    throw new Error(`gateTmplHash 跨源漂移: kanet.env ZK_GATE_TMPL_HASH=${process.env.ZK_GATE_TMPL_HASH.slice(0, 16)}... != zk-close-builder.mjs ZK_GATE.gateTmplHash=${ZK_GATE.gateTmplHash.slice(0, 16)}... — 两处是手动同步的两份拷贝,改一处漏另一处即复发(规则55同族雷), fail-loud 不静默沿用任一方`);
  }
  const { receiptHex, journalHash } = loadCanonicalSample();
  const computed = computeGateTmplHash(ZK_GATE.imageId, receiptHex, journalHash, kaspaZk);
  if (computed !== ZK_GATE.gateTmplHash) {
    throw new Error(`gateTmplHash 配置漂移: 烤死值=${ZK_GATE.gateTmplHash} != 现算=${computed}(imageId=${ZK_GATE.imageId.slice(0, 16)}...) — imageId 刚变过或常量已过期(规则55同族雷), fail-loud 不静默沿用可能错的值`);
  }
  _zkGateVerified = true;
}

// 仅测试/诊断用: 重置 memo,不导出进正常业务路径。
export function _resetVerifiedForTest() { _zkGateVerified = false; }
