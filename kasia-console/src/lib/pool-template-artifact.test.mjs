// pool-template-artifact.test.mjs — silverscript v1.0.0 template_hash 公式回归(J2 2026-09-15,
// 账本 1412/1413, NWT+Bettor 核过)。留证: golden 长度前缀字节序(小端, 不是最初以为的大端)+
// extractTemplateArtifactV100 对真实 compileSilV100(...) 产物的断言不炸。
// Run: cd kasia-console && node src/lib/pool-template-artifact.test.mjs

import { blake3 } from '@noble/hashes/blake3';
import { extractTemplateArtifactV100 } from './pool-template-artifact.mjs';
import { compileSilV100, ctorIntV100, ctorBytes32V100 } from './pool-bshard-artifacts.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] template_hash length-prefix byte order (golden vectors from silverscript-lang/src/template.rs):');

// 逐字节复刻 template.rs 里的 le8()/blake3 调用方式, 不复用文件内部的私有 le8(未导出) —— 这里独立重写
// 一份最简版本, 目的正是验证"两处各自独立写的实现算出同一个值", 不是自己抄自己。
function le8(n) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(n >>> 0, 0);
  b.writeUInt32LE(Math.floor(n / 0x100000000) >>> 0, 4);
  return b;
}
function templateHashLE(prefix, suffix) {
  return Buffer.from(blake3(Buffer.concat([le8(prefix.length), prefix, le8(suffix.length), suffix])));
}

// golden_empty_parts (template.rs)
ok(
  templateHashLE(Buffer.alloc(0), Buffer.alloc(0)).toString('hex') === 'e572dff82304700b856a555ac3a4558d0df3646a3727816500270a93c66aac1e',
  'golden_empty_parts: template_hash([], []) 匹配 template.rs 内置单元测试值'
);

// golden_classic (template.rs) — 这条向量是判定"长度前缀是小端还是大端"的决定性证据(2026-09-15 实测:
// 大端编码算出的 hash 与此值完全对不上，小端逐字节相同)。
ok(
  templateHashLE(Buffer.from([0x00, 0xff]), Buffer.from([0x10, 0x00, 0x80])).toString('hex') ===
    '6616a66757315de0221cb2acba729113cebde31f8d3ca7fa93878a0584b96905',
  'golden_classic: template_hash([0x00,0xff], [0x10,0x00,0x80]) 匹配 template.rs 内置单元测试值(小端长度前缀确认)'
);

console.log('[test] extractTemplateArtifactV100 against a real compileSilV100(...) artifact:');

const dir = mkdtempSync(join(tmpdir(), 'j2-tmpl-artifact-v100-'));
const silPath = join(dir, 'Probe.sil');
writeFileSync(
  silPath,
  'pragma silverscript ^0.1.0;\n' +
    'contract Probe(int init_amount, byte[32] init_owner) {\n' +
    '    int amount = init_amount;\n' +
    '    byte[32] owner = init_owner;\n' +
    '    entry noop() { require(amount >= 0); }\n' +
    '}\n'
);
const compiled = compileSilV100(silPath, [ctorIntV100(1), ctorBytes32V100('11'.repeat(32))], 'Probe');
const artifact = extractTemplateArtifactV100(compiled);
ok(artifact.templateHashHex.length === 64, 'templateHashHex 是 32 字节(64 hex 字符)');
ok(artifact.templatePrefix.length + artifact.templateSuffix.length + compiled.state_layout.len === compiled.script.length,
  'prefix.length + suffix.length + state_layout.len == 完整脚本长度(切片无遗漏无重叠)');
// extractTemplateArtifactV100 内部已经做过"重算 blake3(len8LE+prefix+len8LE+suffix) == compiled.template_hash_bytes"
// 的断言(不通过会 throw, 走到这里说明已经通过) —— 再显式复算一遍留痕。
const independentRecompute = templateHashLE(artifact.templatePrefix, artifact.templateSuffix);
ok(independentRecompute.toString('hex') === artifact.templateHashHex,
  '本文件独立重算的 blake3(len8LE+prefix+len8LE+suffix) 与 extractTemplateArtifactV100 返回值一致');

if (fails > 0) {
  console.error(`\n${fails} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
