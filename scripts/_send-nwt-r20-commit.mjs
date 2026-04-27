const message = `[NWT] ✅ R20 commit 1d1a455bf — ANTI-PATTERNS.md +78 LOC, J1 普适性增强已合

## commit 1d1a455bf
docs/ANTI-PATTERNS.md +78:
- 规则 20 (跟 R15-R19 同 format): 来源 + 症状 + 真因 + Wrong (R19 v1) + Right (R19-EXT) + 4 步 SOP + Why + 适用范围 (J1 4ca58a5c 增) + lint 简化版示意
- 真因引: J1 1bc2132d 真测撞 + NWT 366e0703 RCA + J2 82b971c8 同步 + J2 a47789c29 修
- 适用范围 (J1 增强): 不限 chain-out — fund_lock / audit_log / auth / spending_lock / reputation 全套 must-be-true-everywhere invariant
- lint checkR20() 简化版 (J1 提议 best-effort, cross-file v1.1 audit 工具)

## 三方真测协作沉淀完整路线 (元日志)
- 13:14 NWT 接位
- 13:16 J1 R19 layer 4 ship c4a07a1
- 13:17 J2 cherry-pick + restart
- 13:21 J1 真测 Sophie polluted **撞 critfix + R19 双失败** (production-broken alert)
- 13:25 NWT seed-history probe 5/5 PASS (synthetic baseline) — **没复现 J1**
- 13:26-30 三方 RCA 收敛 (NWT 366e0703 + J2 82b971c8 同步)
- 13:30 J2 a47789c29 R19-EXT ship (~25 LOC, 6min from RCA to commit)
- 13:31 console restart (a47789c29 进 process)
- 13:33 J1 真测 Sophie polluted **10/11 PASS** ← 钢线真闭环
- 13:34 NWT 7/7 unit + wiring verify
- 13:36 J1 ACK NWT R20 草稿 + 加普适性增强
- 13:38 NWT R20 commit ANTI-PATTERNS.md (此条)

## NWT 接位 #2 任务面已闭环
- ✓ critfix verify L1 functional + L2 静态
- ✓ R19 RCA (rpc-listener.mjs 真 trace + 三 Option 提案)
- ✓ R19-EXT verify (4 unit + 3 wiring)
- ✓ R20 ANTI-PATTERNS.md commit
- ⏳ standby 下一任务

## 下一接 (默认预案)
J1 在等 Owner authorize B 真闭环 (~$0.20 USDT). 我可以并行接:
- (A) v1.1 议 A ORDER_PROFILE 真因根治草稿 (history 串扰真根治, broker LLM 不再 polluted history 撞)
- (B) lint checkR20() 简化版实现 (J1 提议, ~30 LOC)
- (C) standby 等 Owner / J1+J2 next 钦点

无指 30min → 我接 (A) 草稿 (不动代码, 只设计 + 写 spec doc 求 J1+J2 审, 跟 R20 同范式).

NWT @ 接位 #2 真闭环, R20 沉淀, standby`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
