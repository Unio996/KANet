> **Status**: SUPERSEDED-BY D-020

> 📌 **状态注记（2026-09-15 · J2 · D-020 账本1446/1448/a4878d7d）**：本文档验证的是 bet_mint 两步设计（独立铸 stake 筹码 + register_append 消费它）下的构造/编码行为——NWT 用真实 cli-debugger 证明该设计存在更严重问题（ZERO32-owner 的筹码可被任意第三方连本带锁定的真实 KAS 一起偷走，见账本1446），Owner 裁定 D-020：取消步骤A，register_append 改单笔交易。本文档内容作为历史记录保留（不删除，不改原文），新的验证见 `docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification/`。

# KanetTestToken.transfer(binding=cov leader) 真实v1.0.0 sigScript编码验证(zero-out场景)

出处：register_append 的 tx 组装需要 held/stake 两个 KTT 输入各自的 `transfer` 调用 sigScript(shapeY:
`next_states=[]`)——这是 `#[covenant(binding=cov,...)]` 声明宏生成的入口，跟 `register_append`(普通
`entry`)是不同的调用约定，同样需要先查官方编码来源再决定性验证，不能凭 register_append 的经验直接
照搬（同账本1431对 register_append 的要求）。

## 官方编码来源(D-019 pin `3ed973335b59269293564805cc2c58a14595ec03`)

- `silverscript-abi/src/lib.rs:462-480` `encode_contract_covenant_decl_sig_script`：按声明名(`transfer`)
  解析出真实 entry，转调 `encode_entry_sig_script`——**跟普通 entry 走的是同一个函数**，区别只在"怎么
  找到 entry_name"，参数编码逻辑完全一样。`transfer` 的三个 witness 参数(声明顺序，来自真实编译产物
  `entries.transfer.params`)：`next_states: State[]`(`dynamic_array<struct>`) / `witness: bytes` /
  `owner_input_idx: int[]`(`dynamic_array<int>`)。
- `silverscript-abi/src/lib.rs:904-946` `push_sig_arg` 对 `DynamicArray<Struct>` **不是**走通用的
  `encode_array_payload`(那条路径对 struct 元素直接报 `UnsupportedType`，`:1079-1081`)——而是走
  `push_struct_array_fields`(`:967-1000`)：把 State 的**每个字段**转置成"这个字段在所有元素上的值"
  组成一个新的 `DynamicArray<字段类型>`，各自单独 push（结构体数组的 SoA 布局，不是逐元素 AoS）。
  `next_states=[]`(0元素)时，每个字段的转置数组也是空数组 ⇒ 每个字段一个空 push(`OP_0`)——State 有
  几个字段就有几个 `OP_0`，和"State 里有几个元素"这个数字本身无关。
- `owner_input_idx: int[]`走的是普通 `DynamicArray<Int>` 路径(`:938-941`)：`encode_array_payload`把每
  个元素 `serialize_fixed_i64(v,8)`(8字节小端)拼接成**一个** payload，整体当**一个** push（不是每个
  元素单独 push）。

## 决定性验证

在 D-019 pin 的干净检出临时加一行 `eprintln`(补丁手法同 `2026-09-15-j2-register-append-entry-witness-
abi-verification/debug-print.patch`，未改任何编码/执行逻辑，验证后已 `git checkout` 还原+重编回原始
二进制)，跑 `docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/` 已经真实 PASS 过的
向量 `①c_stake_transfer_owner_unbound_via_fee_input_pass`(`transfer(next_states=[],witness=[],
owner_input_idx=[3])`)，捕获真实 `active_sigscript`：

```
000000000000000803000000000000000424a3e4a8
```

逐字节解读：7个 `00`(6个 State 字段的空 push + witness 的空 push) + `08`+`0300000000000000`
(owner_input_idx=[3] 的 8 字节小端 payload，当一个 push) + `04`+`24a3e4a8`(dispatch_tag)。

用 `kasia-console/src/lib/proto-ktt-transfer-witness.mjs` 的 `encodeKttTransferZeroOutAction`(真实
`kaspa.ScriptBuilder`，State 字段数从 `runtime_state.fields.length` 现读，不硬编"6"这个数字本身)
独立编码出的字节，与上面这份真实值**逐字节完全一致**(`proto-ktt-transfer-witness.test.mjs` 向量①，
PASS)。

## 已知局限(本模块只覆盖的场景)

- 只验证了 `next_states=[]`(0元素)这一种情况——State 数组非空时的 SoA 转置字段顺序**没有**用真实数据
  验证过，若未来需要传非空 `next_states`，必须先补一次决定性验证，不能直接照搬本模块的字段数逻辑。
- 只覆盖"每个 KTT 输入自己是唯一成员的 covenant 组"场景(leader-of-one，从不需要 `transfer_delegator`)
  ——这正是 register_append 生产设计的真实形状(held/stake 各自独立血统，见
  `docs/provenance/2026-09-15-j2-ktt-dual-lineage-merge-cardinality-check/`)，`transfer_delegator`
  的编码本模块未覆盖，不在当前范围内。

## 文件清单

- `KanetTestToken.sil` / `ktt.reference.ctor.json`(冻结的编译输入)
- `real_action_from_debugger.hex`(真实 cli-debugger 构造出的 `active_sigscript`，冻结证据)
- `README.md`(本文件)
