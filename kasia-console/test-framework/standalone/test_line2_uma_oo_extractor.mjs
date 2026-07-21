// 线2 slice-1 regression — UMA OO reader + extractor determinism / value-mapping / finality / ABSTAIN (J1).
//
// 纯逻辑 (无 DB/无链/无 RPC): mock OO reader → extractUmaOoFields → 验 determinism + GAP-B value-mapping +
// finality gate (J1-A) + ABSTAIN-not-guess + block-anchoring (J1-B)。继承 judgeLine/extractEspnFields 哲学。
// run: node test-framework/standalone/test_line2_uma_oo_extractor.mjs   (exit 0=PASS)

import {
  makeMockOoReader, makeRpcOoReader, UMA_YES, UMA_NO, UMA_INDETERMINATE,
} from '../../src/lib/uma-oo-reader.mjs';
import {
  extractUmaOoFields, mapUmaValueToOutcome, umaCanonicalFieldHash, UMA_ABSTAIN_TOKEN, __UMA_EVIDENCE_FIELDS__,
} from '../../src/lib/uma-oo-extractor.mjs';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const AID_YES = 'uma:q-yes';
const AID_NO = 'uma:q-no';
const AID_5050 = 'uma:q-5050';
const AID_WEIRD = 'uma:q-weird';
const AID_PROPOSED = 'uma:q-proposed';
const SETTLE_BLOCK = 50_000_000;

const reader = makeMockOoReader(new Map([
  [AID_YES, { value: UMA_YES, settled: true, settled_block: SETTLE_BLOCK }],
  [AID_NO, { value: UMA_NO, settled: true, settled_block: SETTLE_BLOCK }],
  [AID_5050, { value: UMA_INDETERMINATE, settled: true, settled_block: SETTLE_BLOCK }],
  [AID_WEIRD, { value: 123456789n, settled: true, settled_block: SETTLE_BLOCK }],
  [AID_PROPOSED, { value: UMA_YES, settled: false, settled_block: SETTLE_BLOCK }], // proposed-but-not-settled
]));

// ── 1) value-mapping (GAP-B 冻结映射) ──
check('map 1e18 → YES', mapUmaValueToOutcome(UMA_YES) === 'YES');
check('map 0 → NO', mapUmaValueToOutcome(UMA_NO) === 'NO');
check('map 0.5e18 → ABSTAIN (50-50)', mapUmaValueToOutcome(UMA_INDETERMINATE) === UMA_ABSTAIN_TOKEN);
check('map 意外值 → ABSTAIN (不猜)', mapUmaValueToOutcome(123456789n) === UMA_ABSTAIN_TOKEN);
check('map null → ABSTAIN', mapUmaValueToOutcome(null) === UMA_ABSTAIN_TOKEN);

// ── 2) extract YES/NO (settled) ──
const yes = extractUmaOoFields(reader.readOoResolution(AID_YES, SETTLE_BLOCK));
check('YES: final=YES + fields + field_hash', yes.final === 'YES' && !!yes.fields && /^[a-f0-9]{64}$/.test(yes.field_hash || ''));
check('YES: fields.resolved_outcome=YES', yes.fields?.resolved_outcome === 'YES');
check('YES: uma_value 是十进制 string', yes.fields?.uma_value === '1000000000000000000');
const no = extractUmaOoFields(reader.readOoResolution(AID_NO, SETTLE_BLOCK));
check('NO: final=NO', no.final === 'NO' && no.fields?.resolved_outcome === 'NO');

// ── 3) determinism: 同输入 → 同 field_hash (re-run + 独立 recompute) ──
const yes2 = extractUmaOoFields(reader.readOoResolution(AID_YES, SETTLE_BLOCK));
check('determinism: re-extract → 同 field_hash', yes.field_hash === yes2.field_hash);
check('determinism: umaCanonicalFieldHash(fields) == extract field_hash', umaCanonicalFieldHash(yes.fields) === yes.field_hash);
check('determinism: YES≠NO field_hash', yes.field_hash !== no.field_hash);
// hash 集 == 输入集 invariant (NWT): field_hash 只哈这 4 字段
check('field_hash 输入集 == __UMA_EVIDENCE_FIELDS__', JSON.stringify(Object.keys(yes.fields)) === JSON.stringify(__UMA_EVIDENCE_FIELDS__));

// ── 4) finality gate (J1-A): proposed-but-not-settled → ABSTAIN (禁 proposed) ──
const prop = extractUmaOoFields(reader.readOoResolution(AID_PROPOSED, SETTLE_BLOCK));
check('finality: proposed (settled=false) → ABSTAIN + fields null', prop.final === UMA_ABSTAIN_TOKEN && prop.fields === null && prop.field_hash === null);

// ── 5) 50-50 / 意外值 settled → ABSTAIN (value-mapping 弃权) ──
const f5050 = extractUmaOoFields(reader.readOoResolution(AID_5050, SETTLE_BLOCK));
check('50-50 settled → ABSTAIN', f5050.final === UMA_ABSTAIN_TOKEN && f5050.fields === null);
const weird = extractUmaOoFields(reader.readOoResolution(AID_WEIRD, SETTLE_BLOCK));
check('意外值 settled → ABSTAIN (不猜)', weird.final === UMA_ABSTAIN_TOKEN && weird.fields === null);

// ── 6) ABSTAIN: 错绑 ancillary_id (未知) → miss → ABSTAIN (J1-C) ──
const unknown = extractUmaOoFields(reader.readOoResolution('uma:q-does-not-exist', SETTLE_BLOCK));
check('错绑/未知 ancillary_id → ABSTAIN', unknown.final === UMA_ABSTAIN_TOKEN && unknown.fields === null);

// ── 7) block-anchoring (J1-B): 读在 settle block 之前 → 未终局 → ABSTAIN ──
const tooEarly = extractUmaOoFields(reader.readOoResolution(AID_YES, SETTLE_BLOCK - 1));
check('block < settle_block → 未终局 → ABSTAIN', tooEarly.final === UMA_ABSTAIN_TOKEN && tooEarly.fields === null);
const atSettle = extractUmaOoFields(reader.readOoResolution(AID_YES, SETTLE_BLOCK));
check('block == settle_block → settled → YES', atSettle.final === 'YES');

// ── 8) RPC reader stub = slice-2 (防 slice-1 误用真路径) ──
let threw = false;
try { makeRpcOoReader().readOoResolution('x', 1); } catch { threw = true; }
check('RPC reader throws (slice-2 stub, 防误用真链路)', threw);

console.log(fails === 0 ? '\n✅ 线2 slice-1 UMA OO extractor determinism/finality/ABSTAIN regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
