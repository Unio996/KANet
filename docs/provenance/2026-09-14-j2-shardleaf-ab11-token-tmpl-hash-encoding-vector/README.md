> **Status**: CURRENT

# AB11 `stateBytes` 拷贝 `token_tmpl_hash` — 最小编码向量

出处：Bettor 要求"§4③ AB11 stateBytes 拷贝 token_tmpl_hash：写一条 T4-lite 核清单条目 + 一个最小编码向量的草案（不改生产码），等④定了直接用"。

**不改任何生产 `.sil` 文件**——本目录另存一份 `ShardLeaf_direct.v4-with-ab11-fix.sil`（在 `docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/` 那份实验性副本基础上，补上 AB11 `stateBytes` 拷贝 `token_tmpl_hash` 这一行 + 同步更新 `OWN_STATE_LEN` 常量为真实值 69），编译取其真实 `templatePrefix`/`templateSuffix`，用纯 JS 精确复刻 `register_append` 里 AB11 手写 `stateBytes` 的编码逻辑，验证"续约前后 `token_tmpl_hash` 保持不变"这条性质。

**为什么不复用旧 provenance 目录里那份同名文件**：那份是①②③三项 hash 不变性验证用的快照，当时还没加这一行 AB11 修复（其 `OWN_STATE_LEN` 仍是旧值 36，与真实 `state_layout.len=69` 不一致）——这个不一致在那份 provenance 的"已知限制"一节已经诚实标注过，不是本次才发现的新问题，本目录的工作正是补上那个被标注但当时未做的缺口。

## 这不是完整的端到端交易向量

本向量**聚焦"这一处编码本身对不对"**，不构造满足 `register_append` 全部 `require`（`ps` ticket genesis via `validateOutputStateWithTemplate`、`scanOwnedTokenInputs`、`readInputStateWithTemplate` 读代币输入等）的完整 cli-debugger 交易——那需要额外构造真实 `PoolSideTicket`/`KanetTestToken` 实例并让全部检查同时通过，工作量大得多，且不是"编码对不对"这个问题的必要条件。落码阶段仍需要一条完整的端到端向量（同本 session 其余 provenance 的严格程度），本向量只是"最小"这个要求下的合理范围。

## 结果（`encoding-vector.mjs`）

1. **`state_layout.len` 实测 = 69**，与手写常量 `OWN_STATE_LEN` 吻合——由 `36`（原 4 个 `int` 字段，各"1B长度头+8B值"）+ `33`（新增 `token_tmpl_hash`："1B长度头+32B内容"）组成。**订正设计稿 v0.2 §4③原文"32 字节，无需长度前缀"这一句是错的**——真实编译产物证明 `byte[32]` State 字段的编码同样带 1 字节长度头，跟其余字段的编码惯例一致，不是特例。
2. genesis 态（`count=0, pool_value=0`）与续约态（`count=1, pool_value=100000`，模拟一笔 `stake=100000` 的下注）用**同一个** `token_tmpl_hash` 编码，两次都得到 `stateBytes.length===69`，`blake2b(prefix+stateBytes+suffix)` 各自算出一个确定、可复现的完整脚本哈希（`d3e0746a...`/`28fd7cb7...`）——`token_tmpl_hash` 在这个过程里被正确地"原样携带"，不是被重新赋值或丢弃。
3. 对照组：如果续约时漏掉这一行、退回旧的 4 字段编码，`stateBytes.length` 直接变成 `36`（比正确值少 33 字节）——**这个漏洞会在编码长度层面就直接暴露**，不需要等到真实广播失败或者链上出现语义错误才发现，落码阶段的单元测试可以直接断言 `stateBytes.length === OWN_STATE_LEN` 来堵死这条回归。

## T4-lite 核清单新增条目（供 §4③ 落码时使用）

- [ ] `register_append` 的 AB11 `stateBytes` 手写编码包含全部 **5** 个字段（`local_yes`/`local_no`/`count`/`pool_value`/`token_tmpl_hash`），逐字段核对编码顺序与源码 `struct` 字段声明顺序一致。
- [ ] `token_tmpl_hash` 编码是"1 字节长度头(`32`) + 32 字节内容"，不是裸 32 字节。
- [ ] `OWN_STATE_LEN` 常量与真实 `compileSilV100(...).state_layout.len` 逐字节核对一致（不是凭公式推算，是拿真实编译产物验证——同源码里既有 `OWN_PREFIX_LEN`/`OWN_STATE_LEN` 注释"常量按本文件*实际编译产物*量测得出"的既有纪律）。
- [ ] 单元测试断言：构造 genesis 态与续约态两组 `stateBytes`，`token_tmpl_hash` 部分逐字节相同（拷贝正确）；故意漏掉该字段的编码，断言 `stateBytes.length` 与 `OWN_STATE_LEN` 不匹配（回归防护，见本 provenance ③）。

## 已知限制

- 未构造满足 `register_append` 全部 `require` 的完整交易（见上"这不是完整的端到端交易向量"）。
- `TOKEN_TMPL_HASH`/其余字段值均为任意占位值，落码时应换成真实市场的 `KTT_M_hash`（候选④）或 `market_tmpl_hash`（候选②，若最终选型是②）重新验证一遍，不假设占位值和真实值之间没有编码差异（本次未发现有差异，但没有专门验证"任意真实值"都满足同一编码规则，只是逻辑上没有理由不同）。

## 文件清单

- `ShardLeaf_direct.v4-with-ab11-fix.sil`（实验性副本，含 AB11 拷贝 `token_tmpl_hash` 修复 + `OWN_STATE_LEN=69`，内部自洽）
- `encoding-vector.mjs`
- `run.log`
- `README.md`
- `MANIFEST.sha256`
