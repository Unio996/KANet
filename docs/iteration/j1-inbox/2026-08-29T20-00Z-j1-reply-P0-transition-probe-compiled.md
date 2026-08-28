# J1 · P0 交付 —— §6-3 gate (a) transition probe 正式编译 + §3 五确认（2026-08-29）

> **Status**: CURRENT · 回 r13 §2 / 接口稿 v0.2（`17effcb7`）· 走路 (i)：本机 pin `silverc-zk-8065184.exe`
> 产物只落 `scratch/j1-s63a-transition/`，**未进 `versioned-builds/`、未碰任何 `SILVERC_*` 路径、未 rebuild `/d/silverscript`**。

## 0. 定稿说明

草案 §2.2 **逐字采用，零语义改动**（§2.3 四个可观察量原样保住）。唯一新增 = 末尾单探支 `recovery_daa`，因 §3 ⑤ 明确要求"单独探一支"。

## 1. 编译结果（全部退出码 0）

| 产物 | ctor | 退出码 | script |
|---|---|---|---|
| `probe.json` | `init_phase=0`（LOCKED_F） | **0** | 261 B |
| `probe_phase1.json` | `init_phase=1`（O_AUTHORIZED，J2 对拍的独立 oracle） | **0** | 261 B |
| `probe_legacy.json` | 同 phase0，legacy 编译器阴性对照 | **0** | 261 B |

## 2. §3 五确认

### ① `validateOutputState` 对 4-int state 可编译 + `state_layout`

**可编译。** 实测值与预期**完全一致**：

```
phase0: {"start":1,"len":36}
phase1: {"start":1,"len":36}
```

⇒ `len=36`（leaf 族，命中生产 `_continuationAddress` 长度白名单 36/87/96/204）、`start=1`。harness 可直接按此取 `script[1,37)`。

### ② `OpInputCovenantId(selfInIdx)` 传本输入自身索引

**可读、可编，无需隐式 self 形。** `transition`/`claim`/`recovery` 三支都用该形并编译通过 ⇒ 自身 cov_id 运行时读的路子成立（不烤 cid 的前提确认）。

### ③ entry 编号 = 声明序

```
[0] transition(selfInIdx, selfOutIdx)
[1] claim(selfInIdx)
[2] recovery(selfInIdx)
[3] recovery_daa(selfInIdx, refInIdx)     ← J1 新增的 ⑤ 单探支
```

**编号 = 声明序确认成立**，参数序与 `.sil` 一致。
🟡 注：`abi` 里参数**只带名不带类型串**（我的提取器打印为 `? name`），harness 若依赖类型字段需另取；scriptSig 形（`args pushes ‖ selector ‖ push(redeem)`）我这侧无法从产物直接确认，需 J2 用 `unlockBshardConsolidate` 同款构造实测。

### ④ `tx.outputs[i].value == tx.inputs[j].value` 双索引形

**可编**（`transition` 支内已用，随整体编译通过）。

### ⑤ 🔴 `recovery_daa` 单探 —— 关键结论：**DAA 锚形按 v0.15 的写法当前表达不出来**

- **(i) 原语存在否**：`OpTxInputDaaScore(idx)` **存在且可编**（1 参 builtin，`compile.rs:3573`；我的 `recovery_daa` 支用它编译通过，退出码 0）。
- **(ii) 同单位可比否**：🔴 **不可** —— 我逐条读了编译器的**完整 builtin 表**（`silverscript-lang/src/compiler/compile.rs:3562-3589`，共 28 个 `Op*`），**没有任何"当前 DAA"原语**；`tx.` 字段侧亦无 DAA（全仓搜 `daa` 仅命中 `OpTxInputDaaScore` 与其 debug 类型声明两处）。
- ⇒ v0.15 要的 `TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N`（DAA 单位）**无法表达**：能表达的只有**输入↔输入**的 DAA 比较，例如我探针里的
  `require(OpTxInputDaaScore(refInIdx) >= OpTxInputDaaScore(selfInIdx) + 100)`（编译通过）。
- **未用 `tx.time` 顶替**（遵 NWT 混单位 vacuous 的钉子）。现行 `recovery` 支的下界仍是 baked ms 的 `tx.time >= t_recovery`，**这一点必须在 v0.15 正文里标成"DAA 锚形待编译器支持"，不能当已具备**。
- 可行的替代方向（供 J2/NWT 判，我不擅自定）：(a) 若能提供一个"当前 DAA"输入作参照（如同笔中某个已知输入），则输入↔输入形可用；(b) 等编译器加当前-DAA 原语；(c) 维持 ms 锚并在正文显式标注单位与语义边界。

## 3. phase 真变断言 —— 🔴 与 §2.4 措辞需对齐

§2.4（NWT ①）写"差异 = 且仅 = state_layout 段内 phase 字段的 **9 字节**（PUSH8+i64LE(0)→(1)）"。**实测差异是 1 个字节**：

```
phase0 script 261 B / phase1 script 261 B
逐字节差异位置: [2]   共 1 处
  phase0 值=0   phase1 值=1
落在 state_layout[1,37) 内: true
```

**两者并不矛盾**：phase **字段**占 9 B（`PUSH8`+8B i64LE），但 0→1 只改动最低位那一个字节，其余 8 B 相同。
⇒ 建议把断言写成「**差异字节全部落在 phase 字段的 9 B 区间内，且实际相异字节数 = 1（LSB）**」——按原文"差异 = 9 字节"逐字实现会**永远失败**。请 NWT 确认口径后 J2 再写断言。

## 4. sha256 表

```
ed6f0b7bb401f63c29875ef3cfc020324c06064d032c998b290d24ce30b98159  S63A_TransitionProbe.sil
91ea28b803c5513338825ad3d8d0e22946b00d2e01e0ff614193872a6af9a7e2  ctor.json           (init_phase=0)
da80e5b76e88f4714d05db45a45749cf1785e7d9220869b87e5e92c20524375d  ctor_phase1.json    (init_phase=1)
d08c5f1febbae0cce7749383a224a64b3e7741e30b413da2adc70a1e560316fb  probe.json          ★ J2 的 script0 须复现此值
63500aa863b42e1a02e811dad57acf1a5430eb63b8eb89d44df4bc4447967aa3  probe_phase1.json   ★ J2 的 script1 须复现此值
d08c5f1febbae0cce7749383a224a64b3e7741e30b413da2adc70a1e560316fb  probe_legacy.json
9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4  silverc-zk-8065184.exe    (= MANIFEST 记录值)
e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06  silverc-legacy-2c46231.exe (= MANIFEST 记录值)
```

## 5. 阴性对照（判别力边界，照 04cc8087 同款诚实标注）

`probe.json` 与 `probe_legacy.json` **sha256 逐字节相同**（`d08c5f1f…`）⇒ **本探针未触 OP_PICK codegen 路径**（该路径需 `byte[](int,int)` 两参 cast 调用）。
⇒ 本次结论覆盖：`validateOutputState` 4-int state / cov_id 家族 / 双索引 value / `OpTxInputDaaScore` 可编性；**不覆盖** OP_PICK。若 A-covenant 正式 `.sil` 出现 `byte[](v,size)`，须另走 J2 (21) 的 byte-exact 向量，不能引本结论。

## 6. 交付清单与边界

- 产物：`scratch/j1-s63a-transition/{S63A_TransitionProbe.sil, ctor.json, ctor_phase1.json, probe.json, probe_phase1.json, probe_legacy.json, inspect.cjs}`
- **未做**：广播段（按 §4 在 READY + T+125 之后，另派）；harness（J2 域）；四路焊/co-input/反向焊（不在本探针范围）。
- **未碰**：`versioned-builds/`、`SILVERC_PATH`/`SILVERC_LEGACY_PATH`/`SILVERC_ZK_PATH`、`/d/silverscript` 未 rebuild、live 节点/console/relay 一律未动。
