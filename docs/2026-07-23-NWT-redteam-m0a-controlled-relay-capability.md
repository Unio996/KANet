# M0a 窄 capability `m0c-controlled-relay-endpoint` — NWT diff 审 verdict（review_ref 锚）

> **Status**: NWT diff 审 GREEN（2026-07-23）· M0a considered amendment 定稿
> **审对象**：worktree `agent-ad3889c1e8689450c` — 初稿 `6c612df5`（m0a-lib.mjs + m0a-lint.test.mjs）+ 去-warn `5d013865`。KANet-UI（M0a owner）会话死期间 Bettor spawn 落码，NWT 作唯一 load-bearing 闸。
> **本文档用途**：给 operator-settle.js 的 manifest `m0c-controlled-relay-endpoint` 条目当 **review_ref 锚**（稳定可验证的 verdict 引用，非频道 txid）。

---

## verdict：GREEN（4 约束全实现正确 + 去-warn fail-closed）

**初稿 `6c612df5` — NWT 4 约束逐条实读核**：
- **① 受控非裸连 = NWT diff 审语义判，lint 不校**：lint 只校 manifest schema（capability 合法 / 七字段全 / content_digest 匹配 / 白名单命中）；"端点必过 authorizeCommand + 命令白名单 fail-closed + 不裸透传"由 NWT diff 审判。✅
- **② lint 完整性门 / NWT diff 审唯一 load-bearing 闸**：✅
- **③ 白名单有界、shrink-only**：`CONTROLLED_FUNNEL_ALLOWLIST` 仅含 `kasia-console/src/api/operator-settle.js`，未来项留注释不预塞占位；非白名单文件用此 capability = 拒；扩张走 NWT 审 + Owner 知情。✅
- **④ TOCTOU 防御 = content_digest**：条目 `content_digest` 锚该文件"批准时"内容 sha256，每次核现内容（`readStagedContent` 读 index 版本防 staged 藏私货），失配 = 批准后被改过没重审 = 拒。这是我最担心的"批准文件后被改成裸透传混过去"那条，digest 失配挡住。`content_digest` 仅此 capability 必填，不并入 `MANIFEST_FIELDS`（db-readonly/test-fixture 存量条目向后兼容）。✅

**去-warn `5d013865`（NWT 调整采纳）**：4 处新 check 的 `severity:'warn'` 彻底消失（独立 grep 零残留）→ 默认 fail-closed block。理由：relay-import 是**安全控制**，判据精确（白名单命中 + digest 匹配）无误拦 dev 活风险，该硬 block 非 warn-first；NWT diff 审 GREEN = 规则65"NWT GREEN 后升 block"的触发点。测试 #16（非白名单用此 cap → block 非 warn）+ #17（digest 失配 → block）验证。✅

---

## note（进 manifest 条目落码 + 我 diff 核那条真条目时把关）

- **content_digest 必须锚 operator-settle.js 的最终内容（NWT TOCTOU 前提·J2 顺序坑）**：批B 会把 operator-settle.js 的 transfer 档二从单 header 改成独立 header（MUST-FIX）。**content_digest 必须在 MUST-FIX 修完后、对最终 operator-settle.js 内容算 sha256**——若锚旧版（7e511b15 单 header）则 MUST-FIX 一改就 digest 失配拒。正确序：批B 先修 operator-settle.js（transfer 独立 header）→ 对最终内容算 content_digest → 填 manifest 条目。这正是 TOCTOU 防御的题中之义（digest 跟真实内容绑死）。
- **我 diff 核那条真 manifest 条目时核三点**：①content_digest == operator-settle.js 实际内容 sha256（round-trip 自证，别填错让 TOCTOU 失效）②path 在白名单内 ③operator-settle.js 受控非裸连（过 auth 三层 + 命令白名单 fail-closed + 不裸透传 + transfer MUST-FIX 闭合）。

**关联**：`scripts/m0a-lib.mjs`（amendment 实现）、`docs/2026-07-23-m0c-1-operator-settle-lane-design.md`（受控端点设计）、`docs/2026-07-23-NWT-redteam-operator-settle-lane.md`（专道红队 verdict）、频道 M0a diff 审（2026-07-23 04:31Z）。
