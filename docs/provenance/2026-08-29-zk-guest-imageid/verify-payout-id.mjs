// ZK guest imageId provenance 自证 (零依赖, 任意 cwd): node docs/provenance/2026-08-29-zk-guest-imageid/verify-payout-id.mjs
// ① methods.rs (2026-07-12 da9 WSL 构建产物副本) 的 PAYOUT_ID 8×u32 LE 拼 32 B == canonical c9918501…
// ② payout.bin (guest ELF 副本) 字节数 366748 + sha256 前缀 885c6fca…; methods.rs 里 PAYOUT_PATH 指向的就是它
// ③ guest.rustc_info.json: release 1.94.1-dev, commit 06e01cb0d… (= ~/.risc0/toolchains/v1.94.1 那把 guest 编译器)
// ④ canonical 与仓内 3o6cs receipt summary / zk-close-builder.mjs ZK_GATE.imageId 一致 (若文件存在)
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..', '..', '..');
const CANON = 'c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30';
let pass = 0, fail = 0;
const t = (n, f) => { try { const r = f(); pass++; console.log('[PASS] ' + n + (r ? ' :: ' + r : '')); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
t('① methods.rs PAYOUT_ID 8 词 LE == canonical', () => {
  const src = readFileSync(join(DIR, 'methods.rs'), 'utf8');
  const m = src.match(/PAYOUT_ID: \[u32; 8\] = \[([^\]]+)\]/); assert.ok(m, 'PAYOUT_ID 不在');
  const words = m[1].split(',').map((s) => Number(s.trim())); assert.strictEqual(words.length, 8);
  const b = Buffer.alloc(32); words.forEach((w, i) => b.writeUInt32LE(w, i * 4));
  assert.strictEqual(b.toString('hex'), CANON);
  assert.ok(/PAYOUT_PATH: &str = "\/mnt\/d\/kanet-tn12\/zk-payout-guest\/target\/riscv-guest\/methods\/payout\/riscv32im-risc0-zkvm-elf\/release\/payout\.bin"/.test(src), 'PAYOUT_PATH 应指向 /mnt/d 构建树');
  return words.join(',');
});
t('② payout.bin 366748 B, sha256 885c6fca4914cd3fce4463d94acd517c…', () => {
  const b = readFileSync(join(DIR, 'payout.bin')); assert.strictEqual(b.length, 366748);
  const h = createHash('sha256').update(b).digest('hex'); assert.ok(h.startsWith('885c6fca4914cd3fce4463d94acd517c'), h);
  // 🔴 不是裸 ELF: risc0-build 3.x 产出的 payout.bin 是 risc0-binfmt 程序格式, magic 'R0BF' (0x52304246); 首版我按 ELF 7f454c46 断错了一次
  assert.strictEqual(b.subarray(0, 4).toString('ascii'), 'R0BF', 'risc0-binfmt magic'); return h;
});
t('③ guest.rustc_info.json = 1.94.1-dev / 06e01cb0d', () => {
  const s = readFileSync(join(DIR, 'guest.rustc_info.json'), 'utf8');
  assert.ok(/release: 1\.94\.1-dev/.test(s), 'release'); assert.ok(/commit-hash: 06e01cb0d0077cdbda6b930b2f23c2f05c8a2421/.test(s), 'commit'); assert.ok(/host: x86_64-unknown-linux-gnu/.test(s), 'host');
});
t('④ canonical == 仓内 receipt summary / ZK_GATE.imageId (存在则核)', () => {
  const out = [];
  const rs = join(ROOT, 'zk-payout-guest/proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.summary.json');
  if (existsSync(rs)) { assert.strictEqual(JSON.parse(readFileSync(rs, 'utf8')).image_id, CANON); out.push('receipt✓'); }
  const zb = join(ROOT, 'kasia-console/src/lib/zk-close-builder.mjs');
  if (existsSync(zb)) { assert.ok(readFileSync(zb, 'utf8').includes(CANON), 'zk-close-builder 不含 canonical'); out.push('zk-close-builder✓'); }
  return out.join(' ') || 'n/a';
});
console.log(`zk-guest-imageid provenance: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
