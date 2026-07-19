# jepu1 settle-rejection — D-001 OP_PICK off-by-one · 独立可复核证据包

> **Status**: CURRENT (evidence artifact · 2026-07-19 · J1tn)
> **用途**: 让任意第三方(Codex 等)**独立 rerun** 复现 jepu1 settle 交易被 TN12 节点拒绝的确切失败点,不只信结论。全程只读/离线,零 money-path。
> **对应决策**: `docs/DECISIONS.md` D-001「🔬 活体取证」段。**结论口径**: D-001 = root_cause_supported;jepu1 funds = historical_immutable_settle_branch_broken(重签救不了、settle 保持停);同纪元 ~213 盘 = D-001 **high-confidence candidates 非 confirmed**(逐盘 recovery 时验)。

---

## 1. 复现环境 pin (40-char SHA,不留短前缀)

| 组件 | 值 |
|---|---|
| TN12 节点 commit(= jepu1 432 次拒绝的执行方) | `7b1e18cc6e7098d83927049781c91740b90e7754` (v1.1.1-toc.1) |
| 三方独立核实同 commit | operator `kaspad-tn12.out.log`+`kaspad.log` 双日志(J2/NWT/J1) |
| silverc OP_PICK 修复(**已存在**,jepu1 系此前受害者) | `/d/silverscript` short `8065184` "Fix OP_PICK off-by-one in compile_byte_sequence_cast_call"(2026-07-06);**40-char 由 J2 route#2 连 patch 镜像进 evidence/**(J1 侧仓库只解出短 SHA) |
| J1 本机(独立)节点 commit(与 jepu1 无关,仅记录) | `ab4c51afde90dc6e0bce3f782d0a18af5da29434`(领先 7b1e18cc 7 个 commit;`hashing/sighash.rs` 两版无 diff) |

## 2. 证据文件 (repo 内 + 完整性哈希)

| 文件 | 内容 | 完整性 |
|---|---|---|
| `docs/evidence/2026-07-19-jepu1-wire-dump.json` | jepu1 settle wire tx 原字节(relay 捕获,commit `d43b569c873dd91ced6edf275ae06b50f233cf58`) | sha256 `b522bc9ed481fadc57c5846652150a8582230af5ed26d9052481c87bf39c706d` |
| `docs/evidence/jepu1-D001-probe/sighash-probe.rs` | node-truth sighash 探针源(= `docs/tmp-jepu1-sighash-probe.rs`) | in-repo |
| `docs/evidence/jepu1-D001-probe/engine-probe.rs` | 离线脚本引擎执行探针源(照抄 consensus `check_scripts_sequential`) | in-repo |
| `docs/evidence/jepu1-D001-probe/sighash-probe.Cargo.toml` | 探针 crate 清单(deps pin rev=7b1e18cc;`[patch]` 到加打点的 txscript) | in-repo |
| `docs/evidence/jepu1-D001-probe/txscript-trace.patch` | txscript@7b1e18cc 的打点 diff(仅加 `TRACE_OPS` eprintln,零逻辑改动) | in-repo |
| 本文件 D-001 evidence commit | `65f0316333bc0c1c74a7c074c7ea9a0285fbae36` | — |

## 3. 被花 UTXO (jepu1 spine, input 0) — sighash preimage 关键值

| 字段 | 值 |
|---|---|
| tx id(自校验目标) | `f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723` |
| input0 prev-outpoint | `ef5b512f4b25676b615b7b589fdd52667df8c3223f7cff1b2f7a93108e51aa7a:0` |
| input0 prev-output amount (sompi) | `20000000000` |
| input0 prev-output scriptPublicKey(flat: 2B version LE + script) | `0000aa2082e587a9b0416156ebf168a1c2289e4a3bf3048a1fb10818715c48fb075178c587` |
| 该 P2SH 揭示的 redeem 长度 | 2103 bytes / 1516 opcodes(push-aware disasm;J1+J2 独立一致) |
| 交易结构 | 5 inputs / 10 outputs;input0 sigOpCount=8,其余 0 |

## 4. rerun 步骤 (deserialize + invoke,任意第三方可跑)

```
# 环境: rustc >= 1.85, cargo. 无需触碰 live 节点(纯离线,吃 wire dump 原字节)。
# (a) 建独立 crate,拷 4 个探针文件:
mkdir -p sighash-probe/src/bin
cp docs/evidence/jepu1-D001-probe/sighash-probe.Cargo.toml   sighash-probe/Cargo.toml
cp docs/evidence/jepu1-D001-probe/sighash-probe.rs           sighash-probe/src/main.rs
cp docs/evidence/jepu1-D001-probe/engine-probe.rs            sighash-probe/src/bin/engine-probe.rs
# (b) 打点 txscript@7b1e18cc(仅加 TRACE_OPS eprintln):
#     git clone rusty-kaspa && git checkout 7b1e18cc && de-workspace crypto/txscript
#     (deps 见 sighash-probe.Cargo.toml 的 rev=7b1e18cc pin)后 apply txscript-trace.patch
#     并把 sighash-probe.Cargo.toml 里 [patch] 指向它。

# (c) node-truth sighash 复核(应打印目标 txid + 完整 64-hex sighash):
cargo run --release --bin sighash-probe -- \
  ef5b512f4b25676b615b7b589fdd52667df8c3223f7cff1b2f7a93108e51aa7a 0 20000000000 \
  0000aa2082e587a9b0416156ebf168a1c2289e4a3bf3048a1fb10818715c48fb075178c587 \
  <path>/jepu1-skeleton.json     # skeleton 由 wire dump 提取: {version,lockTime,gas,subnetworkId,payload,inputs[{txid,index,sequence,sigOpCount}]×5,outputs[{value,spk}]×10}

# (d) 离线脚本引擎执行(应确定性复现 input0 拒绝):
TRACE_OPS=1 cargo run --release --bin engine-probe -- docs/evidence/2026-07-19-jepu1-wire-dump.json 2> trace.log
```

## 5. 预期输出 (= 已实测,可比对)

**(c) sighash 复核** — 完整 64-hex(非只 `ad7eb3a1` 前缀):
```
txid          = f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723
node sighash  = ad7eb3a1ef7e0fa2e5fd8379c5a9df4ff5ccf8e2e7896774fde8644b2f8fb5cc
```
→ 与 relay 派生值全 64 hex 相等 ⇒ **版本漂移假说灭**。附:5/5 committee 签名对此 sighash 经 schnorr 验证有效(SIGHASH_ALL),对角配对(sig[i]↔pk[i]),J1+J2 独立 ⇒ **陈签名/委员 ordering 灭**。

**(d) 引擎执行** — 确定性复现:
```
txid = f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723
input0 verdict = ERR: script ran, but verification failed   (= TxScriptError::VerifyError,与节点错误原文逐字相同)
input1..4 verdict = OK
```

## 6. bounded trace — 确切失败点 (opcode idx / 栈深 / selected depth / 两比对字节串)

失败落在一条 `require(blake2b(assembled_scriptPubKey_bytes) == expected)`:

```
[op] 0x79 (OP_PICK)   dstack_len=69      # 取"期望值"到栈顶
[op] 0x87 (OP_EQUAL)  dstack_len=69
  [cmp 0x87] top   = 08                                                          # 期望值(PICK 取到)= 1 字节!
  [cmp 0x87] below = 7394f883ca044123039aa5b4425446dc4c11cff3d12ef47ee67ec5334702669d   # 计算值 blake2b = 32 字节
[op] 0x69 (OP_VERIFY) dstack_len=68
[FAIL] opcode 0x69 err=VerifyError dstack_len_before_pop=67
```

**full dstack @ 失败 EQUAL**(depth 0 = top):
```
depth  0 = 08                              <- PICK 取到的"期望值"(1 字节,错)
depth  1 = 7394f883…702669d (32B)          <- 刚 blake2b 出的"计算值"
depth  2..6 = df3cd1c4…3477fb77 (32B ×5)   <- 循环展开的 per-slot 模板常量
depth  7 = 05
depth  8+ = 3fb12011…/d0e59d…/447055…/f5036e… (32B, merkle siblings 一类)
```

**喂该 EQUAL 的深栈 PICK 深度实测**:
```
[PICK depth=48] d-1=00da49c002  d=4020334d06  d+1=08
[PICK depth=49] d-1=00da49c002  d=4020334d06  d+1=08
[PICK depth=50] d-1=4020334d06  d=08         d+1=04
```
depth 50 落在 `08`,邻居 `4020334d06`/`04` —— **全是 output-amount `OP_NUM2BIN`(0xcd) 序列化产生的小整数 scratch 值**。即:covenant 意图 PICK 一个 32B 的期望 scriptPubKey/hash,但**深栈 PICK 深度(genesis 时由 pre-0706 buggy silverc 烤死在不可变 redeem 里)落进了小整数 scratch 区**,取到 1 字节 `08` ⇒ `08 == 32B-hash` 恒 false ⇒ `OP_VERIFY` 抛 `VerifyError` ⇒ 节点拒。

## 7. 结论与边界

- **根因** = D-001 silverc `pick_from_depth` OP_PICK off-by-one codegen bug,在 jepu1 baked covenant 的 **settle 分支**。1 字节 vs 32 字节的尺寸错配 = 取错栈项的铁证(非语义推断)。
- **jepu1 genesis 2026-06-28 < 修复 2026-07-06(8065184)** ⇒ 修复不追溯已 baked 的链上 redeem ⇒ settle 路对 jepu1 **unsatisfiable**,重签/重构 tx 绕不过。
- **未做到 terminal 的一格**(诚实标注,归 J2 源码域):精确 off-by-**几**格需对齐 jepu1 那份 .sil 源意图(该 PICK 变量应指向哪个深度)。本包给的是 runtime 实测深度值(48/49/50),供源码对齐。
- **recovery**: settle 停;jepu1 走 refund/cancel 分支(轨B pilot),需先用同 harness replay refund 分支证无同款 PICK,再出 unsigned refund tx + 守恒 + 幂等 guard → 红队 → Owner money-path 批(**仅 jepu1**,213 不凭长度并批)。
- **blast radius**: pre-0706 窗口 ~213 盘 spine_redeem 同 2103B(同模板);升级判据 = J2 normalized-template sha256(zero 掉定宽 ctor 槽再 hash)。**high-confidence candidates 非 confirmed**。

— J1tn 2026-07-19
