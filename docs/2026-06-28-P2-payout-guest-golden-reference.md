# P2 — 结算 guest golden-reference (payout 算术 byte-equal 锚)

**作者**: J2 · **日期**: 2026-06-28 · **状态**: 交付 J1(P2 guest 移植对照)+ Bettor(byte-equal 闸)
**触发**: ZK-settle 实施方案 P2 (`docs/2026-06-28-ZK-settle-implementation-plan.md`)。J1 把 `computePariMutuelPayout`/`deriveFeeLeaves`/`settlePayoutRoot` 移植成 RISC0 guest(Rust)·**必 byte-equal 现 JS·否则白证**。本文 = 该算术的精确 spec + 确定性测试向量(inputs→payoutRoot 字节)。
**源**(单源·勿重抄): `kasia-console/src/lib/pool-shard-settle.mjs` + `kasia-console/src/lib/pool-payout-root.mjs`。

---

## 1. 命门(guest 必守)
- **byte-equal**: Rust guest 算的 `payout_root` 必 == 现 JS `settlePayoutRoot` 逐字节(本文向量是闸)。漂一 bit = 链上 covenant 验 `journal.payout_root` 不符 = 白证。
- **journal 绑链上真相**(plan P2/P3·防 vacuous): journal 公开 `inputs_commit`(押注集 merkle==covenant 已 commit)/ `verdict`(预言机判决)/ `fee_rules_commit`(==genesis 烤 feeRules)/ `payout_root`(本算术输出)。**covenant 校验时必读得到那些 commit**(verify-value-source 的 ZK 版·NWT 红队死盯)。
- **整数零浮点**: 全 BigInt floor 除。dust 确定性归位(见下)。

## 2. 原语(byte-critical·先对死这两个)
### 2.1 serializeI64(num, size=8) — LE sign-magnitude
rusty-kaspa `data_stack.rs serialize_i64()` 的精确 JS port(= 链上 `byte[](int,8)` OpNum2Bin 行为)。**sompi >0 且 <2^63 → 就是 8-byte 无符号小端**(低字节在前)。
```js
function serializeI64(num, size) {           // num: BigInt
  const sign = num < 0n ? -1 : (num > 0n ? 1 : 0);
  let positive = num < 0n ? -num : num;
  const bytes = []; let lastSaturated = false;
  while (true) {
    if (positive === 0n) { if (lastSaturated) { bytes.push(0); lastSaturated = false; } else break; }
    else { const v = Number(positive & 0xffn); lastSaturated = (v & 0x80) !== 0; positive >>= 8n; bytes.push(v); }
  }
  if (size != null) { if (bytes.length > size) throw 'NumberTooLong'; while (bytes.length < size) bytes.push(0); }
  if (sign === -1) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}
```
**自测向量**(guest 必复现):
| num (sompi) | serializeI64(num,8) hex |
|---|---|
| 1 | `0100000000000000` |
| 255 | `ff00000000000000` |
| 256 | `0001000000000000` |
| 20000000000 | `00c817a804000000` |
| 9223372036854775807 (2^63-1) | `ffffffffffffff7f` |

### 2.2 payoutLeaf(pkHex, amountSompi)
```
leaf = blake2b( pk32_bytes ‖ serializeI64(amount, 8) , dkLen=32 )
```
- `pk` 必 32 字节(x-only·hex64)。`amount` 必 > 0(min-pot guard·≤0 抛)。
- 例: pk=`01`×32, amount=`1000000000` → leaf=`c39d4d1cdc14f349aa7a28d3e238c4a14480bacaba1214c1b7c64a4ecfabb316`

## 3. payoutRoot merkle(depth-10·pad ZERO32)
```
DEPTH=10, CAP=1024, ZERO32 = 32 个 0x00 字节
level0 = [payoutLeaf(w0)..payoutLeaf(wN-1), ZERO32, ZERO32, ...]   // 填到 1024 slot·空位=ZERO32(NOT dup-last)
for d in 0..DEPTH:  next[i] = blake2b( level[2i] ‖ level[2i+1] , dkLen=32 )   // position-aware
payoutRoot = level[DEPTH][0]   (32-byte hex)
```
- winners > 1024 → 抛(需 rolling payout-shard·非本 guest 范围)。

## 4. computePariMutuelPayout(算 payoutLeaves)
入: `{ bettors:[{pk,stake,direction}], winningDirection(0|1), poolTotalSompi?, feeBps=0, feeLeaves=[] }`
```
pool          = poolTotalSompi ?? Σ stake
feeSompi      = (Σ feeLeaves.amount) > 0 ? Σ feeLeaves.amount : pool*feeBps/10000   // BigInt floor
distributable = pool - feeSompi
winners       = bettors.filter(direction == winningDirection)
totalWinStake = Σ winners.stake
若 winners 空 / totalWinStake==0 → { degenerate:true }   (单边池→refund 路·不出 payoutRoot)
payout_i      = winner_i.stake * distributable / totalWinStake     // BigInt floor
dust          = distributable - Σ payout_i  →  payout[0] += dust   // 归 winners[0]·Σ==distributable exact
payoutLeaves  = winnerLeaves ‖ feeLeaves     // fee leaf 接在 winner 后(顺序确定)
```
**payoutRoot = settlePayoutRoot(payoutLeaves)**(= §3 merkle on payoutLeaves)。

## 5. deriveFeeLeaves(fee-recipient leaves·canonical 序)
入: `{ poolSompi, feeConfig:{brokerBps,oracleBps,introBps,nodeBps}, brokerPk, introducerPk?, committeePks[] }`
```
bpsAmt(bps)   = pool * bps / 10000           // BigInt floor
leaves 顺序(canonical·确定):
  1. broker      (brokerBps>0 且 brokerPk)   pk lowercased
  2. introducer  (introBps>0 且 introducerPk)
  3. committee   commBps = oracleBps+nodeBps; total=bpsAmt(commBps);
                 committeePks 按 pk lowercase 排序; each = total/N;
                 dust = total - each*N  →  committee[0] += dust    // 归 sorted committee[0]
```

## 6. golden 向量(guest 必逐个 byte-equal·完整 JSON 见生成器)
| case | 输入摘要 | distributable | feeSompi | leaves | **payoutRoot** |
|---|---|---|---|---|---|
| V1 equal 2winners nofee | 2×1e9 win / 1×1e9 lose, win=0 | 3000000000 | 0 | 2 | `a9460e6f8ffd643b9f5a1ceca94f538eb8a75ae672be9a42873a125bc6828267` |
| V2 unequal dust | 2.065+5 win / 10 lose, win=0 | 17065000000 | 0 | 2 | `715dfe505cea311a2e87f6c2b2e5354cde01381bea3c80ce28577385d3e7436d` |
| V3 with fees | V2 + broker190bps + committee100bps(3 委员) | 16570115000 | 494885000 | 6 | `759b6e2682d053f7fa18e9b6b2498f30afbc429cc53a6307fe03fbe5b722e669` |
| V4 single winner | 3 win / 7 lose, win=0 | 10000000000 | 0 | 1 | `9ac50d0822c4cca31da0809c550c0fd96ea5aea494bd5d43a69ac4f813f49f9c` |
| V5 degenerate | 仅 lose-side, win=0 | (5e9) | 0 | — | DEGENERATE(refund 路) |

**V3 完整 payoutLeaves(winners‖fees·验 dust+canonical)**:
```
[0] pk=01..  amount=4843211250    (winner stake 2065000000·含 winners[0] dust)
[1] pk=02..  amount=11726903750   (winner stake 5000000000)
[2] pk=09..  amount=324235000     (broker = 17065000000*190/10000)
[3] pk=10..  amount=56883334      (committee[0] sorted·含 fee-dust +1)
[4] pk=11..  amount=56883333      (committee[1])
[5] pk=12..  amount=56883333      (committee[2])
Σ = 16570115000(dist) + 494885000(fee) = 17065000000(pool) ✓
```
(测试 pk = 单字节 padStart 重复 32 次·见生成器)

## 7. 复现(确定性·勿手抄)
生成器: `scratch/_j2_gen_golden_vectors.mjs`(import 真 JS fn → 跑 → 出 `scratch/_j2_golden_vectors.json`)。
```
cd kasia-console && node ../scratch/_j2_gen_golden_vectors.mjs > ../scratch/_j2_golden_vectors.json
```
**P2 byte-equal 闸**(Bettor): Rust guest 跑同输入 → 比每个 payoutRoot == 本表。漂 = 移植有 bug(查 serializeI64 字节序 / blake2b dkLen / dust 归位 / 排序)。

## 8. 移植红旗(J1 Rust guest 易踩)
- **serializeI64 字节序**: LE sign-magnitude·非 BE。sompi 正数 = 纯 8-byte LE·但实现要带 sign-magnitude(负数 / saturate 分支)以防边界。
- **blake2b dkLen=32**(blake2b-256·Kaspa native)·非 512。
- **pad = ZERO32**·非 dup-last-leaf(malleability)。
- **dust 归位**: winners[0](payout)+ committee[0](fee·按 sorted 后第0)。漏 = Σ≠pool。
- **fee leaf 顺序**: broker→introducer→committee(pk lowercase 排序)。winner‖fee 拼接顺序固定。
- **pk lowercase**: fee pk 全 lowercase 再 hash/排序。
- **整数除**: BigInt floor·非浮点 round。
