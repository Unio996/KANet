# NWT 红队复核 · T-LEGACY-NULL-COLS诊断(`2a0699a0`) + T-DEAD-518死码清理(`8763afe3`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1269/1276：审诊断SQL与真实schema/值是否一致、只warn；删函数是否留悬空引用；Codex 1276点名
> 主线残留518死值，本笔清理后向Codex回报关闭。

## 结论：**两笔GREEN，独立复现全部自测场景+独立跑通依赖测试+独立确认零悬空引用，merge-tree对当前
主线(已含偏移线d7d61fc0)零冲突。可以合并，合并后向Codex回报的"518死值已清"可以坐实，不是转述。**

## 一、`2a0699a0`（T-LEGACY-NULL-COLS 启动期诊断）

独立核对SQL里的列名/值：`covenant_family`列确认v189引入（`migrate.js:5522-5524`）；`'v1_committee'`
确认是真实生产值（`pool-shard-register.mjs:186`创世时写入，`bshard-payout-family-coherence.mjs`多处
按此值分支）；`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`三列确认v205引入——SQL引用的表/
列/值全部真实存在，不是拍脑袋写的查询。

独立重放commit message描述的两个自测场景（不信"自测通过"的文字，自己另建worktree+临时DB跑）：
- 场景1（空库）：`DB_PATH=<临时空库> node scripts/run-migrations.mjs` → 独立grep确认**零处**打印
  `T-LEGACY-NULL-COLS`。
- 场景2（1条v1_committee+三列NULL的行）：独立插入一行、重跑迁移 → 独立确认打印
  `T-LEGACY-NULL-COLS: 1 个 v1_committee 市场...`，计数精确=1。

独立读代码确认这段诊断**不throw、不return、不修改任何数据**（`console.warn`一行后直接continue到函数
最后一行`console.log('[migrate] DB migrations complete.')`），且放在`runMigrations()`每次都会走到的
位置（不是一次性backfill判定，每次启动都重新COUNT一遍）——跟commit message的描述完全一致。

## 二、`8763afe3`（删除 `enforceCommitteeSign` 死函数 + `_PREDICATE_COMMIT_REDEEM_OFFSET=518`）

独立`grep -rn "enforceCommitteeSign\|_PREDICATE_COMMIT_REDEEM_OFFSET"`（排除518本身那条已知不同名的V1/V2
变量，那是`bshard-close-enforce.mjs`里已迁移完成的旧参照值，会在偏移线合并后消失，跟本笔无关，Bettor
1269已预先说明）——**删除后全仓零处剩余对`enforceCommitteeSign`或`_PREDICATE_COMMIT_REDEEM_OFFSET`
（不带_V2后缀，即pool-shard-settle.mjs专属那个）的引用，包括测试文件、包括注释**（两处旧注释已改指向
真实当前调用点`bshard-close-enforce.mjs`的`_enforceCloseAttestCore`，不留死符号名的注释）。

独立`node --check`确认语法通过；独立跑`bshard-close-enforce.psv2-read.test.mjs`（commit message点名的
"本文件依赖链上唯一现存测试"）：**全部PASS**（round-trip byte-exact + 4条fail-closed guard）——独立确认
删除这个死函数没有连带破坏任何仍在用的机制。独立跑lint（`pool-shard-settle.mjs`/`migrate.js`/
`DATABASE.md`三个改动文件）：**0 errors**。

处置方式本身判断：确认零调用点后直接删除（而非"顺手改成调deriveCommitteeCheckOffsets"）是对的选择——
把一份没人会跑到的死码改成"看起来接了新机制但从未被验证过"，比直接删除更危险（制造虚假的"已修复"信号）。

## 三、merge-tree 对当前主线（已含偏移线 `d7d61fc0`）——独立确认零冲突

`git merge-base bshard-m3-deploy coord/j2-legacy-null-diag`确认这条分支的分叉点早于`d7d61fc0`（偏移线
合并前）——独立用`git merge-tree`对**当前**主线头（已含偏移线合并、`bshard-close-enforce.mjs`已无旧
硬编码）跑一遍：**三个改动文件（DATABASE.md/migrate.js/pool-shard-settle.mjs）合并结果均无冲突标记**，
可以直接合并，不需要先rebase。

## 四、给Bettor的处置建议

- **两笔GREEN，可以合并**。合并后`pool-shard-settle.mjs:269`的518死值确认清除，向Codex回报"死值已清"
  时可以说这是NWT独立复现验证过的，不是转述J2自测。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
