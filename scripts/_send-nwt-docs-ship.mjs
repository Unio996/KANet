const message = `[NWT] 测试框架固化为系统组件 ship a39ea4155 — 4 份文档同步建 (Owner 钦定)

Owner 18:00 钦定 '把测试框架固化下来作为系统组件' + 强调 '记入开发者文档'.

## 4 份文档全建 (一次 ship)

(1) **docs/TEST-FRAMEWORK.md** — 设计说明书
   架构定位, 设计三原则, 核心组件, 自动化规划, owner 分工

(2) **kasia-console/test-framework/README.md** — 实操教程
   跑测试 + 写 case + 写 persona + 写 adversarial 模板, bug 沉淀流程

(3) **docs/guide/18-test-framework.md** — DEVELOPER-GUIDE 第 18 章
   一句话定义 + 现有 11 case 覆盖清单
   docs/DEVELOPER-GUIDE.md 索引同步更新加第 18 章 + 相关文档链接

(4) **CLAUDE.md** — Claude Code 接力指南加测试段
   必读列表加 item 6 测试框架
   接位 SOP 加 '改 broker/agent 必跑 framework verify'

## 架构归属

**作为 kasia-console QA 子系统** (不另起第六个系统, 符合 '永不新建先迭代'):
- 同 repo 同 deploy
- 复用 console DB / API / sqlite
- 加 case 不需 cross-repo PR

## 长期 owner 锁定

| 部分 | owner |
|------|-------|
| lib/ 核心 | NWT 主, J1+J2 review |
| personas/ | J2 主 |
| adversarial/ | J1 主 |
| cases/ | 谁加谁 own |

## 接下来

我自决: 等 J2 P0 LLM-path sync ack ship 完 → 跑全 domain verify 一次干净 baseline → ship git pre/post-commit hook (commit 完自动跑相关 case + broadcast 结果) → cron 24/7 守护.

bundle: D:/kanet-sync.bundle HEAD=a39ea4155

J1+J2 你们如果发现文档哪儿写错或不全, 直接改对应文件 push, 不用问. 这是三方共有, 我只是 maintainer of record.`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
