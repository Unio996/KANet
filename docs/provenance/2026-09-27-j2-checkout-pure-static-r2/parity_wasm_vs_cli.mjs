// parity_wasm_vs_cli.mjs — item①(b) 核心验证: silverscript-lang 编译成 wasm32 的 compile() 与
// D-019 锚定的 silverc v1.0.0 CLI 二进制, 对 CommissionSplit/ChannelDeposit/InstantSplit 三份合约,
// 各 ≥200 组随机 ctor 向量逐字节 parity。任何一组不一致即判失败(Bettor 要求: 不接受抽样归纳)。
//
// 存档拷贝(记录跑过什么、结果如何——见同目录 parity_wasm_vs_cli.log)。要重跑: wasm 编译产物是
// scratch/(gitignored, 不入库)按 vendor/silverc-wasm/README.md 的构建命令本机重建的临时输出,
// 路径按重建时的实际落点调整下面第一个 import。
import { compile as wasmCompile } from 'file:///D:/kanet-tn12/scratch/_j2_commission_impl_research/silverc-wasm-out-node/silverc_lang.js';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from 'file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { randomBytes } from 'node:crypto';

const ctorBytesN = (buf) => ({ kind: 'bytes', value: [...(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))] });
const ctorBool = (b) => ({ kind: 'bool', value: !!b });
const padSpk37 = (b) => { const out = Buffer.alloc(37, 0); Buffer.from(b).copy(out, 0, 0, Math.min(37, b.length)); return out; };

const randInt = (maxBits = 40) => {
  // 覆盖: 0, 小值, 大值(直到 2^53-1 安全整数上限), 也覆盖 magnitude 边界(2^32 附近)
  const roll = Math.random();
  if (roll < 0.1) return 0n;
  if (roll < 0.2) return BigInt(Number.MAX_SAFE_INTEGER);
  if (roll < 0.3) return (1n << 32n) - 1n;
  if (roll < 0.4) return 1n << 32n;
  const bits = 1 + Math.floor(Math.random() * maxBits);
  let v = 0n;
  for (let i = 0; i < bits; i++) v = (v << 1n) | BigInt(Math.random() < 0.5 ? 0 : 1);
  return v;
};
const randSpk = () => {
  // 模拟真实 SPK: P2PK(34B) / P2SH(35B) / P2PKH(可变) 等长度分布, 覆盖 order-template.js 30 场景
  const lens = [34, 35, 36, 37, 25, 22];
  const len = lens[Math.floor(Math.random() * lens.length)];
  return randomBytes(len);
};

function diffArtifacts(label, wasmArtifactJson, cliArtifact, contractName) {
  const w = JSON.parse(wasmArtifactJson);
  const wc = w?.contracts?.[contractName]?.compiled;
  const cc = cliArtifact?._raw?.contracts?.[contractName]?.compiled;
  if (!wc || !cc) return `${label}: missing .compiled (wasm=${!!wc} cli=${!!cc})`;
  if (wc.bytecode.length !== cc.bytecode.length) return `${label}: bytecode length mismatch wasm=${wc.bytecode.length} cli=${cc.bytecode.length}`;
  for (let i = 0; i < wc.bytecode.length; i++) {
    if (wc.bytecode[i] !== cc.bytecode[i]) return `${label}: bytecode byte[${i}] mismatch wasm=${wc.bytecode[i]} cli=${cc.bytecode[i]}`;
  }
  if (JSON.stringify(wc.state_span) !== JSON.stringify(cc.state_span)) return `${label}: state_span mismatch wasm=${JSON.stringify(wc.state_span)} cli=${JSON.stringify(cc.state_span)}`;
  if (JSON.stringify(wc.template_hash) !== JSON.stringify(cc.template_hash)) return `${label}: template_hash mismatch`;
  return null;
}

const results = { CommissionSplit: { pass: 0, fail: 0 }, ChannelDeposit: { pass: 0, fail: 0 }, InstantSplit: { pass: 0, fail: 0 } };
const failures = [];

const CS_SIL = 'D:/kanet-tn12/kasia-console/src/lib/sil-v1/CommissionSplit.sil';
const CD_SIL = 'D:/kanet-tn12/kasia-console/src/lib/sil-v1/ChannelDeposit.sil';
const IS_SIL = 'D:/kanet-tn12/kasia-console/src/lib/sil-v1/InstantSplit.sil';
const CS_SRC = (await import('node:fs')).readFileSync(CS_SIL, 'utf8');
const CD_SRC = (await import('node:fs')).readFileSync(CD_SIL, 'utf8');
const IS_SRC = (await import('node:fs')).readFileSync(IS_SIL, 'utf8');

const N = 210;

// ── CommissionSplit: role_count(1) + 7*(spk37,len,amt) + refund_spk37+len + deadline+maxSplitFee+maxRefundFee + ruleCommit32+chainCommit32+nonce16 = 30 ctor params
for (let iter = 0; iter < N; iter++) {
  const roleCount = 1 + (iter % 7); // sweep 1..7 deterministically across the run, randomize the rest
  const ctor = [ctorIntV100(roleCount)];
  for (let i = 0; i < 7; i++) {
    if (i < roleCount) {
      const spk = randSpk();
      ctor.push(ctorBytesN(padSpk37(spk)), ctorIntV100(spk.length), ctorIntV100(randInt()));
    } else {
      ctor.push(ctorBytesN(Buffer.alloc(37, 0)), ctorIntV100(0), ctorIntV100(0));
    }
  }
  const refundSpk = randSpk();
  ctor.push(ctorBytesN(padSpk37(refundSpk)), ctorIntV100(refundSpk.length));
  ctor.push(ctorIntV100(randInt()), ctorIntV100(randInt()), ctorIntV100(randInt()));
  ctor.push(ctorBytesN(randomBytes(32)), ctorBytesN(randomBytes(32)), ctorBytesN(randomBytes(16)));

  const cli = compileSilV100(CS_SIL, ctor, 'CommissionSplit');
  const wasmOut = wasmCompile(CS_SRC, JSON.stringify(ctor));
  const err = diffArtifacts(`CommissionSplit#${iter}`, wasmOut, cli, 'CommissionSplit');
  if (err) { results.CommissionSplit.fail++; failures.push(err); } else results.CommissionSplit.pass++;
}

// ── ChannelDeposit: depositor_pk(bytes32) + max_withdraw_fee(int)
for (let iter = 0; iter < N; iter++) {
  const ctor = [ctorBytes32V100(randomBytes(32)), ctorIntV100(randInt())];
  const cli = compileSilV100(CD_SIL, ctor, 'ChannelDeposit');
  const wasmOut = wasmCompile(CD_SRC, JSON.stringify(ctor));
  const err = diffArtifacts(`ChannelDeposit#${iter}`, wasmOut, cli, 'ChannelDeposit');
  if (err) { results.ChannelDeposit.fail++; failures.push(err); } else results.ChannelDeposit.pass++;
}

// ── InstantSplit: merchantPk(b32)+amt, brokerPk(b32)+amt, hasReferrer(bool)+referrerPk(b32)+amt,
//    refundPk(b32), deadline, maxSplitFee, maxRefundFee, ruleCommit(b32), orderNonce(bytes16) = 13 params
for (let iter = 0; iter < N; iter++) {
  const hasReferrer = iter % 2 === 0;
  const ctor = [
    ctorBytes32V100(randomBytes(32)), ctorIntV100(randInt()),
    ctorBytes32V100(randomBytes(32)), ctorIntV100(randInt()),
    ctorBool(hasReferrer), ctorBytes32V100(randomBytes(32)), ctorIntV100(hasReferrer ? randInt() : 0n),
    ctorBytes32V100(randomBytes(32)),
    ctorIntV100(randInt()), ctorIntV100(randInt()), ctorIntV100(randInt()),
    ctorBytes32V100(randomBytes(32)),
    ctorBytesN(randomBytes(16)),
  ];
  const cli = compileSilV100(IS_SIL, ctor, 'InstantSplit');
  const wasmOut = wasmCompile(IS_SRC, JSON.stringify(ctor));
  const err = diffArtifacts(`InstantSplit#${iter}`, wasmOut, cli, 'InstantSplit');
  if (err) { results.InstantSplit.fail++; failures.push(err); } else results.InstantSplit.pass++;
}

console.log('=== parity results ===');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v.pass}/${v.pass + v.fail} pass`);
if (failures.length) {
  console.log('\n=== first 10 failures ===');
  failures.slice(0, 10).forEach(f => console.log(f));
  process.exit(1);
} else {
  console.log('\nALL PASS — wasm compile() byte-identical to pinned silverc v1.0.0 CLI across', N * 3, 'random ctor vectors.');
}
