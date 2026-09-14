# ShardLeaf_direct.sil v1.0.0 纯语法迁移（T3 v0.3 §7 第一步，四文件收官）

Bettor ledger 1131/1133，机械迁移到编译通过，不动业务逻辑、不加 scan。至此 §7 第一步（RootClose/ShardLeaf/
ShardLeaf_direct/CloseZkV2）四文件全部完成，均可用真实 ctor 参数完整编译（触达 entry body 类型检查）。

## 改动清单（全部机械，零逻辑变化）

1. `entrypoint function` → `entry`（2 处：register_append/convert_to_rootclose）。
2. 裸 struct 字面量 → 显式命名：`Tk {...}`（dust-ticket 桥, 同 ShardLeaf）/ `RootCloseState {...}`
   （convert_to_rootclose 桥 RootClose 的 7 字段 State, 本文件独有的第二个 foreign-template struct）/
   `State {...}`（本合约自身续约）。
3. **本文件未见 `tx.time` 用法**（实查确认——ShardLeaf/RootClose/CloseZkV2 都撞了 tx.time→temporal 的坑，本文件
   的 deadline sweep 逻辑没有搬进来，如实记录不是漏迁移）。
4. 未见 P2PK/两参 `byte[](x,N)` 用法。

## 验证：无既有 test.json，新增 2 条冒烟向量全 PASS（`run.log`）

- `SMOKE-register_append_pass`：与 ShardLeaf 的 register_append **byte-identical**（文件注释自称），复用同一个
  `PoolSideStub2` 派生产物验证 dust-ticket 桥。
- `SMOKE-convert_to_rootclose_pass`：本文件独有的第二个 foreign-template 桥——目标是 **已完成迁移的
  `RootClose.sil`**（`RootCloseTarget.ctor.json`/`.compiled.json`），真编译一个 7 字段状态完全匹配调用点
  计算结果的 RootClose 实例，取其 `prefix`/`suffix`/`template_hash`/P2SH 作为向量的 `rc_prefix`/`rc_suffix`/
  `rootclose_tmpl_hash`/输出 `script_hex`。

## 踩坑记录（跨合约 foreign-template 桥接的一个新坑，值得记一遍）

第一次构造 `convert_to_rootclose` 向量时，`ShardLeaf_direct` 自身的 `local_yes` ctor 值填了 0，而"目标"
`RootCloseTarget` 却编译烤了 `local_yes=100`——两者本该是**同一个数**（`convert_to_rootclose` 把自己的
`local_yes` 原样 carry 进新建的 RootClose genesis），我在构造两个独立的编译产物时让它们各自输入了不一致的值,
导致 `validateOutputStateWithTemplate` 内部重算的期望字节与我声明的输出 `script_hex` 对不上，报"script ran,
but verification failed"且定位只到调用行本身(没有更细的行号)。**教训**：foreign-template 桥接测试必须先固定
"被 carry 过去的字段值"，用**同一组数字**分别喂给"调用方合约的 ctor"和"目标合约的 ctor"，不能先编译目标、
再随手给调用方一个不同的占位值。
