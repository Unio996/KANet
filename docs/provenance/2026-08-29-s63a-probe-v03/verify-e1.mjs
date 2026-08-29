// 探针 v0.3 (D-016 A′) provenance 自证: 纯读本目录产物, 不依赖 kasia-relay / 编译器 / 网络。
// 跑法: node docs/provenance/2026-08-29-s63a-probe-v03/verify-e1.mjs   (任意 cwd)
// 证什么:
//   ① 两 phase 产物 script 恰 273 B, script sha256 / 整文件 sha256 = README 钉的值 (= J1 r20 在 younio 用 pinned silverc-zk-8065184 独立复现的值)
//   ② E1 字节证 (cfedc5c6 §1 E1 / §4; 期望序列按 J1 r20 §3 更正【写全】, 不再省略操作数 push 与 e>=0 块):
//      @225 起【相邻】: 0xc0 TxInputDaaScore · push 0x64(n_probe=100) · 0x93 Add · 0x76 Dup · 0x00 False · 0xa2 GreaterThanOrEqual · 0x69 Verify
//                       · 0x76 Dup · push 0088526a74(5e11 LE 最小正编码) · 0x9f LessThan · 0x69 Verify · 0x76 Dup · 0xb0 CLTV
//   ③ CLTV 共 2 处: #1 @198 操作数 push = 1,787,000,000,000 (ctor[0] t_recovery, ≥5e11 ⇒ 时间域, 无守卫); #2 @243 = ② 的末位 (DAA 域, A′ 双守卫)
//      ⇒ 同一脚本两条 CLTV 分处两域、靠数值区分 = D-016「域由数值判」的字节级佐证 (J1 r20 §4)
//   ④ 0xc0 全脚本恰 1 处 (只在 recovery_daa 入口)
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = dirname(fileURLToPath(import.meta.url));
const EXPECT = {
  0: { script: '31d506a91c8e46775f74b6292c33fe216d65093e457a52018515f3ae7af87ca4', file: 'fbb4fb80d322337e' },
  1: { script: 'e6e9c073387a347aa112a6aa3e572dc6b1d83080608fe1e17195f82060079189', file: '273227f3e14325c3' },
};
const OP = { TxInputDaaScore: 0xc0, Add: 0x93, Dup: 0x76, False: 0x00, GTE: 0xa2, LT: 0x9f, Verify: 0x69, CLTV: 0xb0, PD1: 0x4c, PD2: 0x4d, PD4: 0x4e };
function decode(b) {   // push/PUSHDATA1/2/4 规则; 返回 [{at, op, data?}]; 自检: 覆盖全部字节无残留
  const ops = []; let i = 0;
  while (i < b.length) {
    const op = b[i];
    if (op >= 0x01 && op <= 0x4b) { ops.push({ at: i, op, data: b.subarray(i + 1, i + 1 + op) }); i += 1 + op; }
    else if (op === OP.PD1) { const n = b[i + 1]; ops.push({ at: i, op, data: b.subarray(i + 2, i + 2 + n) }); i += 2 + n; }
    else if (op === OP.PD2) { const n = b.readUInt16LE(i + 1); ops.push({ at: i, op, data: b.subarray(i + 3, i + 3 + n) }); i += 3 + n; }
    else if (op === OP.PD4) { const n = b.readUInt32LE(i + 1); ops.push({ at: i, op, data: b.subarray(i + 5, i + 5 + n) }); i += 5 + n; }
    else { ops.push({ at: i, op }); i += 1; }
  }
  assert.strictEqual(i, b.length, `解码残留: 停在 ${i}/${b.length}`);
  return ops;
}
const leNum = (data) => { let v = 0n; for (let k = data.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(data[k]); return v; };   // 脚本数 LE, 最高位为符号位(这里都 <0x80)
let pass = 0, fail = 0;
const t = (n, f) => { try { const r = f(); pass++; console.log('[PASS] ' + n + (r ? ' :: ' + r : '')); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
for (const p of [0, 1]) {
  const raw = readFileSync(join(DIR, `probe_phase${p}.json`));
  const j = JSON.parse(raw.toString('utf8'));
  const b = Buffer.from(j.script);
  t(`phase${p} ① 273 B + script sha + file sha = README/J1 值`, () => {
    assert.strictEqual(b.length, 273);
    assert.strictEqual(createHash('sha256').update(b).digest('hex'), EXPECT[p].script);
    assert.strictEqual(createHash('sha256').update(raw).digest('hex').slice(0, 16), EXPECT[p].file);
    assert.strictEqual(j.abi.length, 4); assert.deepStrictEqual(j.state_layout, { start: 1, len: 36 });
    return `abi=[${j.abi.map((a) => a.name).join(',')}]`;
  });
  const ops = decode(b);
  t(`phase${p} ④ 0xc0 恰 1 处 @225`, () => { const c0 = ops.filter((o) => o.op === OP.TxInputDaaScore); assert.strictEqual(c0.length, 1); assert.strictEqual(c0[0].at, 225); });
  t(`phase${p} ② E1 完整相邻序列 @225.. (J1 r20 §3 更正形: 含 push n_probe 与 e>=0 块)`, () => {
    const i0 = ops.findIndex((o) => o.at === 225);
    const seq = ops.slice(i0, i0 + 13);
    const want = [OP.TxInputDaaScore, 'push:64', OP.Add, OP.Dup, OP.False, OP.GTE, OP.Verify, OP.Dup, 'push:0088526a74', OP.LT, OP.Verify, OP.Dup, OP.CLTV];
    const got = seq.map((o) => (o.data ? 'push:' + o.data.toString('hex') : o.op));
    assert.deepStrictEqual(got, want, `got ${JSON.stringify(got)}`);
    assert.strictEqual(leNum(seq[1].data), 100n, 'n_probe'); assert.strictEqual(leNum(seq[8].data), 500_000_000_000n, '5e11');
    return `@${seq.map((o) => o.at).join(',')}`;
  });
  t(`phase${p} ③ CLTV 2 处 @198/@243; #1 操作数 = 1787000000000 (时间域, 无守卫) / #2 = DAA 域 A′ 守卫后`, () => {
    const cl = ops.filter((o) => o.op === OP.CLTV).map((o) => o.at); assert.deepStrictEqual(cl, [198, 243]);
    const i1 = ops.findIndex((o) => o.at === 198); const operand = ops[i1 - 1];
    assert.ok(operand.data, 'CLTV#1 前应是 push'); assert.strictEqual(leNum(operand.data), 1_787_000_000_000n);
    const ctor = JSON.parse(readFileSync(join(DIR, `ctor_phase${p}.json`), 'utf8')); assert.strictEqual(ctor[0].data, 1787000000000); assert.strictEqual(ctor[5].data, 100);
    assert.ok(leNum(operand.data) >= 500_000_000_000n, '#1 ≥ 5e11 = 时间域');
    return `#1 push ${operand.data.toString('hex')} (${leNum(operand.data)})`;
  });
}
console.log(`s63a-probe-v03 provenance: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
