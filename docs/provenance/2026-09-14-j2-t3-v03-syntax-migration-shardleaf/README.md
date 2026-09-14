# ShardLeaf.sil v1.0.0 纯语法迁移（T3 v0.3 §7 第一步）

Bettor ledger 1131/1133，机械迁移到编译通过，不动业务逻辑、不加 scan。

## 改动清单（全部机械，零逻辑变化）

1. `entrypoint function` → `entry`（2 处：register_append/consolidate_to_payout）。
2. 裸 struct 字面量 → 显式命名：`validateOutputStateWithTemplate(psOutIdx, Tk {...}, ...)`（dust-ticket 桥,
   1 处）+ `validateOutputState(leafOutIdx, State {...})`（本合约自身续约, 1 处）。
3. `tx.time` 只收 `temporal`（同 CloseZkV2/RootClose 撞的坑）：`require(tx.time >= deadline * 1000)` →
   `require(tx.time >= temporal(deadline * 1000))`。
4. 未见 P2PK/两参 `byte[](x,N)` 用法（实查确认）。

## 验证：无既有 test.json（如实记，非本次引入的缺口），新增 2 条冒烟向量全 PASS

新增 `register_append`/`consolidate_to_payout` 各一条正向量，均用真实 ctor 参数完整编译触达 entry body 类型
检查（非空 ctor 假阴性检查）：

- `SMOKE-register_append_pass`：leaf 续约(`State{}`) + dust-ticket 桥(`Tk{}`, `validateOutputStateWithTemplate`)
  双检查同笔命中。
- `SMOKE-consolidate_to_payout_pass_sealed`：sealed(count==seal_count) 路径, cov_id-bind + 全额守恒 weld。

## 踩坑记录（`validateOutputStateWithTemplate` 目标输出在测试 JSON 里怎么表达，供后续省排查）

第一次尝试用 `state: {bettorPk,...}`（Tk 字段名）标注 psOutIdx 输出，报 `"struct field 'local_yes' must be
initialized"`——**`state:` 字段永远按被测合约自己的默认 `State` 类型解释，不会按调用点指定的目标 struct
（这里是 `Tk`）自动切换**。第二次尝试 `constructor_args: [...]`（Tk 字段位置值），报
`"constructor expects 11 arguments, got 4"`——**输出上的 `constructor_args` 表示"这是被测合约自身的一个新
genesis 实例"，不是"某个外部 struct 的字段值"**。真正做法（同 T1 v0.2 探针 `MarketScanProbe.sil` 系列已确立
的手法）：`validateOutputStateWithTemplate` 在执行期是**从 entry 调用点的实参重新计算期望字节**（prefix +
序列化后的 struct + suffix），再跟 `tx.outputs[idx]` 的**实际 `script_hex`**（P2SH 锁定脚本）比对——测试构造
必须真编译一个字段值完全匹配调用点计算结果的目标合约实例（本例是 `PoolSideStub2.sil`, ctor=
`{bettorPk:0x22*32, direction:0, stake:50, shardPoolId:0x37*32}`, 严格对应 `register_append(side=0,stake=50,
bettorPk=0x22*32)` 的调用参数), 取其编译产物 P2SH 作为该输出的 `script_hex`, 不能用 `state`/`constructor_args`
偷懒表达。
