// D2-MULTIPLICITY MUST-FIX 回归用例 —— 「close_attest continuation output 的【基数】必须被绑」
// (J2, 2026-08-11, CARD-J2-B 第一件 · Codex 最小闭合四条之②「两同 SPK 异 value 对抗用例」)
//
// 设计: docs/2026-08-11-d2-multiplicity-fix-design-v0.1.md (rev-3)
// allowlist: docs/2026-08-04-call-module-export-action-spec.md §12 (v5, Bettor 批 / NWT 审 PASS)
// 缺陷来源: NWT 2026-08-10 06:58 发现 / J2 复核 / Codex 三方确认
//
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd D:/kanet-tn12/kasia-console
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/d2_multiplicity_binding.test.mjs
//
// ── 修前/修后读数(设计稿 §6-bis, 探针 scratch/_j2_d2_t2_probe.mjs) ──────────────
//   修前: T2 两个同 SPK 异 value ⇒ **pass**(matchedOutputs=2) · T4 单个但 value 任意 ⇒ **pass**
//   修后: 两条都 reject。**没有"修之前的 pass", 就证明不了修的是个真存在的洞。**
//
// 🔴🔴 本用例【不覆盖 N3(value 守恒)】, 原因写在这里而不是省略:
//   N3 要触发, 必须先过 root 检查 ⇒ 需要一个与 psRedeemHex 匹配的 expectedSpk。
//   而 expectedSpk 只有两种拿法: ①先调一次函数从 reject 路取回(**声明式 args 是静态的, 做不到**),
//   ②我自己算 P2SH(**= 复刻内部逻辑, 正是本 spec §0 要挡的**)。
//   ⇒ 两条都不可取 ⇒ **N3 在 runner 里没有回归哨兵**, 它的证据停留在设计稿 §6-bis 那次探针实测。
//   🔨 **这是一个已知缺口, 不是"已覆盖"** —— 谁要补它, 需要框架支持"把上一步返回值喂给下一步 args"
//      (今天 runner 只认 `$db` 一个占位符, :878)。**别把本用例的绿读成 N3 也被守着。**
//
// 🔵 psRedeemHex 用**合成定长十六进制**而非真实 redeem: 本用例只需要它别在 splice 阶段就返回,
//   N1 在 root 检查【之前】触发 ⇒ 与真实 redeem 的读数一致(已实测 512/2048/4096/16564 四种长度同结果)。
//   **不内联真实 16KB redeem**: 那份东西一旦格式变了, 用例会以"看起来还在跑"的方式腐烂。

const SYNTH_REDEEM = 'ab'.repeat(1024);          // 2048 hex chars, 合成定长
const RE_DERIVED_ROOT = 'aa'.repeat(32);
const COV_ID = 'cc'.repeat(32);

// ── 🔴 N3 覆盖(v0.2 补 · @J1 摘闸复核 73aea286 §1 抓出 N3 两支都"摘掉不红")─────────
//  他的机制诊断准确(§2): 原用例唯一使用 V2 的那格构造了 2 个 covOuts ⇒ **N1 先拒并早退**
//  ⇒ N3 那几行【从来没被执行到】。修法按他给的形状: 一格只有 1 个 covOut 且 value 不符。
//
//  🔵 为此需要与 SYNTH_REDEEM 匹配的 expectedSpk。**这不是复刻内部逻辑** ——
//    是把生产函数在【固定输入】下的输出记成【测试向量】(取法: 用必然不匹配的 SPK 触发一次
//    reject, 函数自己在 reject 路回传 expectedSpk; 全程没碰 _p2shSpkHex/_splice*)。
//  🔴 向量会不会腐烂: 会 —— 若 splice/hash 逻辑变了它就不再匹配。**而那时用例变【红】**,
//    不是变绿。fail-loud 方向正确, 这正是可以接受它的理由。
const SPK_V1 = '0000aa200339cd51d8cb75dd723b9ec32fdef93ad9f4995e9b8b11790d9e0fb35645852b87';
const SPK_V2 = '0000aa20c4ff3547bcab50b81aa7929635d42e9787bd8a6d04b0e17f3bdfa566ae17543a87';
//  合成 redeem 的那几个字节按 i64LE 解出来是个负数 —— 不是 bug, 是"合成输入不是真 state"的
//  必然结果。N3 只判"等不等", 与它是不是一个语义合理的池值无关。
const SYNTH_POOL = '-6076574518398440533';
const WRONG_VALUE = '12345';                      // 任取, 只要 != SYNTH_POOL
const spk = (b) => String(b).repeat(35);
const covOut = (s, v) => ({ value: String(v), scriptPublicKey: s, covenant: { covenantId: COV_ID } });
const tx = (outs) => JSON.stringify({ version: 1, outputs: outs });

export default {
  id: 'd2_multiplicity_binding',
  description: 'D2 MUST-FIX 回归: close_attest continuation 的【基数】必须恰好 1 — 修前两个同 SPK 异 value 会全部放行(matchedOutputs=2), 而 self_out_idx 指谁由 settler 事后决定。V1/V2 两支同测。🔴 不覆盖 N3(value 守恒), 原因见文件头',
  domain: 'predictions',
  tags: ['regression', 'money-path', 'covenant', 'd2', 'offline'],
  skip_in_batch: false,

  steps: [
    // ══ T2 · 本修法的存在理由: 两个 covenant continuation ⇒ 必须拒(N1) ═══════════
    //   🔴 修前这一步会 pass。SPK 用两个不同的假值即可 —— N1 在 root 检查之前触发。
    { id: 'T2_v1_two_continuations_rejected', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([covOut(spk('11'), 100), covOut(spk('22'), 900)]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: ['"ok":false', 'N1 基数'] } } },

    // ══ T2-V2 · 孪生同测(Codex 条件③: V2 与 V1 同批修, 不许只修一支)═════════════
    //   ⚠ V2 这一支【已经接线】(:592 在 enforceCloseAttestV2 内, 被 bshard-close-voter.js:143 引用)
    { id: 'T2_v2_two_continuations_rejected', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutV2Binding',
      args: [{ txSafeJson: tx([covOut(spk('11'), 100), covOut(spk('22'), 900)]),
               psv2RedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT,
               attestedWinner: 1, betsRootHex: 'bb'.repeat(32), refundRootHex: 'dd'.repeat(32), attestedAtMs: 1786000000000 }],
      expect: { must: { reply_contains: ['"ok":false', 'N1 基数'] } } },

    // ══ T3 · 既有 root 检查不许被新逻辑短路 ════════════════════════════════════
    //   单个 continuation + 错 SPK ⇒ 仍须因 root 不符而拒(**不是**因为基数)
    { id: 'T3_v1_single_wrong_spk_still_root_reject', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([covOut(spk('11'), 100)]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: ['"ok":false', '!= re-derive'] } } },

    // ══ T0 · 零 covenant 输出的既有行为不许变 ═════════════════════════════════
    { id: 'T0_v1_zero_continuation_rejected', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([{ value: '1', scriptPublicKey: spk('11'), covenant: null }]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: ['"ok":false', '无 covenant continuation output'] } } },

    // ══ T4 · N3 value 守恒必须真的挡(v0.2 补, @J1 摘闸抓出这格原先没被执行到)═══════
    //   1 个 covOut · SPK 用向量(过 root 检查)· value 不符 ⇒ 必须命中 N3
    { id: 'T4_v1_single_wrong_value_rejected_by_N3', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([covOut(SPK_V1, WRONG_VALUE)]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: ['"ok":false', 'N3 value'] } } },

    { id: 'T4_v2_single_wrong_value_rejected_by_N3', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutV2Binding',
      args: [{ txSafeJson: tx([covOut(SPK_V2, WRONG_VALUE)]),
               psv2RedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT,
               attestedWinner: 1, betsRootHex: 'bb'.repeat(32), refundRootHex: 'dd'.repeat(32), attestedAtMs: 1786000000000 }],
      expect: { must: { reply_contains: ['"ok":false', 'N3 value'] } } },

    // ══ T1 · N3 的阳性对照 —— 没有它, 一个"恒拒"的 N3 会让 T4 两格照样绿 ═════════════
    //   🔴 在册: 全拒型装饰。value 对上 ⇒ 必须 pass, 证明 N3 判的是"等不等"而不是"一律拒"。
    { id: 'T1_v1_correct_value_passes_positive_control', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([covOut(SPK_V1, SYNTH_POOL)]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: ['"ok":true', '"matchedOutputs":1'] } } },

    // ══ I0 · 仪器自检: 三个 reject 若都因为同一个早退原因(如 splice fail), 上面全绿是假的 ══
    //   🔴 这一步存在的理由: T0/T2/T3 期望的都是 "ok:false"。若函数在 splice 阶段就恒返回 false,
    //      三条会一起绿而【一条都没测到要测的东西】。本步用一个【必然走到 root 检查】的构造,
    //      断言它的失败理由**不是** N1、**不是** splice —— 以此证明前面几条各自到达了各自的判定点。
    { id: 'I0_reasons_are_distinct_not_early_exit', action: 'call_module_export',
      module: 'bshard-close-enforce', export: 'verifyClosePayoutRootBinding',
      args: [{ txSafeJson: tx([covOut(spk('33'), 7)]),
               psRedeemHex: SYNTH_REDEEM, reDerivedRoot: RE_DERIVED_ROOT }],
      expect: { must: { reply_contains: '!= re-derive', reply_does_not_contain: ['N1 基数', 'splice fail'] } } },
  ],
};
