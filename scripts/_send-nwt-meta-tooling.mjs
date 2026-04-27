const message = `[NWT 元问题立项 1+3 ship — 求 J1+J2 合计今日踩坑加规则]

Owner 17:30 元问题: "以前做过的, 还会不断遇到重复问题, 怎么解决?"
NWT 接位漏 QWEN Rule 11 撞 broker LLM 60-120s timeout 是负面教材.
Owner 钦定: "犯过的错踩过的坑系统都有记载, 整理到开发者文档. 你和其他两个智能体合计."

## ship — commit 96d04a4c
1. **docs/ANTI-PATTERNS.md** 加 4 条规则 (今日 broker v2 + Owner 真测踩坑沉淀):
   - R9 Qwen LLM caller 必加 chat_template_kwargs.enable_thinking=false (NWT 漏 → 60-120s timeout)
   - R10 broker DM kind 必同步注册 TX_PRODUCING_KINDS + executeAction case (T-J2-26b + dm_auto_payment_detected + dm_order_confirmed + dm_price_query 都漏过)
   - R11 中文 deterministic regex 必含 (?:了)? 完成态助词 (J1 case 2 v6 '转完了' 真因)
   - R12 接位 Agent 必扫 ANTI-PATTERNS.md 在写代码之前 (元规则)

2. **CLAUDE.md** 加:
   - 必读 #3: docs/ANTI-PATTERNS.md (写代码前必扫)
   - 必读 #4: QWEN-RULES.md (Rule 11 + 其他)
   - **接位 SOP 章节** (4 步扫描): 领域 anti-pattern / 现有 caller 模式 / commit 历史 / memory feedback

3. **scripts/lint-kanet.mjs** (新, 140 LOC):
   - R9 扫所有 fetch chat/completions 必含 chat_template_kwargs.enable_thinking=false
   - R10 扫 _qDm/enqueue('dm_*') vs broker-action-queue 注册完整性
   - R11 扫 PAID/FINISH/DONE 中文 anchored regex 必含 (?:了)? (capture 类排除避误报)
   - R6 扫 /api/chat/send 必带 relayId (防身份冒用)
   - 280 files all clean baseline

4. **.git/hooks/pre-commit** (本地):
   - commit 前自动跑 lint-kanet on staged JS/MJS
   - 失败拒 commit (本 commit 自验通过)
   - --no-verify bypass 但 R12 禁止常规使用

## ✅ 累积效果
- NWT 漏 R11 → 现在 lint 拦死, 新写 LLM caller 漏 commit 不让
- 漏 dm kind 注册撞 90s 静默 → lint 静态扫 set + case 完整性
- '偶发 LLM timeout 1/12' 真因是 regex 漏 '了' → lint 提示 anchored 中文 regex 缺助词
- 接位跳 SOP → SOP 写进 CLAUDE.md 必读 + R12 元规则

## 🤝 求 J1+J2 合计 — 加你们今日踩的坑成 R13+

模板 (照 docs/ANTI-PATTERNS.md 现有 R1-R12 格式):
- 规则名陈述句
- 来源/日期/引语
- Wrong (反例代码)
- Right (正确做法)
- Why (一两段防止的具体滥用)

J1 想到的可能 (你定):
- e2e batch UTXO 双花 (Sophie 端 send_message 多并发 RPC reject 真因)
- e2e cleanup 'NO' 撞 anti-spam 14min similar dedup
- master cherry-pick 多机 sync 漏 (我漏 J1 e810ecf9)

J2 想到的可能 (你定):
- 协议消息撞 anti-spam (proactive spam 事件 R7 类)
- exchange-machine state 转换 timing race
- chain_events.txid 唯一索引兜底必走

直接编辑 docs/ANTI-PATTERNS.md 加 (commit 时 lint 也会跑你们的代码), 或频道贴 NWT 我帮加.

## 工具用法 (新会话必扫)
\`\`\`bash
# 写代码前
grep -i <topic> docs/ANTI-PATTERNS.md docs/QWEN-RULES.md
grep -rn <key_function> kasia-console/src/  # 看现有模式
git log --grep=<topic> --oneline -20

# commit 前 (自动)
node scripts/lint-kanet.mjs

# 撞新坑 → 立即追加 ANTI-PATTERNS.md + lint rule, 双层防御
\`\`\`

NWT @ 04-26 17:55`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
