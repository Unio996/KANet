# V-T-6 (b-out 正向量) 未收敛 — v0.2(限时 1h 钉源码复核, Bettor ledger 1109 派单)

**Status**: OPEN — 但范围已大幅收窄；debugger 与共识语义**已确认一致**(v0.1 猜测的"debugger 可能用占位/
与共识不符"已排除)。不阻塞其余 14 向量交付。

## ①②：OpOutputCovenantId 的 lowering 与共识语义(源码钉死, 非猜测)

- **silverc codegen(3ed9733 隔离 clone)**: `compiler/compile/expression/builtin.rs:70` 把
  `OpOutputCovenantId` **原样 1:1 映射**到 kaspa-txscript 的同名原生 opcode(不生成任何 hash/校验逻辑,
  silverc 自己在这条原语上零介入)。
- **cli-debugger 不是"模拟"——它直接链 `kaspa-txscript` + `kaspa-consensus-core` 真实 crate**
  (`debugger/session/Cargo.toml` 显式依赖两者), 跑的就是共识层的真代码, 不是占位/简化版。
- **共识层实现(已在 `/d/rusty-kaspa` 本地克隆里用 `git show 7b1e18cc:crypto/txscript/src/opcodes/mod.rs`
  逐行核对, 精确到派单要求的那个 pinned commit, 不是只查了 silverc 的依赖版本 a41a333)**:
  ```rust
  opcode OpOutputCovenantId<0xd5, 1>(self, vm) {
      ...
      let covenant_id = output.covenant.map(|c| c.covenant_id).unwrap_or(ZERO_HASH);
      push_data(covenant_id.as_bytes().into(), vm)
  }
  ```
  **纯字段回显**: 读 `TransactionOutput.covenant`(一个 `Option<CovenantBinding{covenant_id,
  authorizing_input}>`)——**genesis 场景下不是"返回占位值"也不是"报错"，是返回该输出自己声明的
  `covenant_id` 字段原样值(没声明 ⇒ ZERO_HASH)**。这个字段的"值必须等于按
  `hashing::covenant_id::covenant_id(auth_input.previousOutpoint, auth_outputs)` 重算的结果"这条约束,
  是 `crypto/txscript/src/covenants.rs::CovenantsContext::from_tx` 在脚本执行**之外**、作为一次性
  genesis 一致性预检强制的(`WrongGenesisCovenantId`)——**opcode 本身不做这个重算, 只回显已通过预检的
  字段**。两层职责分离、互不冲突，**不存在"debugger 语义与共识不一致"的情况**——v0.1 的猜测已排除。

## 排查新增证据(限时内做的, 结论性)

用三个从零写的**隔离探针**(不碰 KanetTestToken.sil 本体, 独立编译独立跑), 逐层加复杂度复现
V-T-6 的核心机制组合, **全部通过**:

1. `ProbeOutCovId.sil`(纯 `OpOutputCovenantId` + continuation-case 输入-输出 covenant_id 匹配, 无
   `validateOutputStateWithTemplate`)—— PASS + 反向(covenant_id 不匹配)正确 FAIL。
2. `ProbeBoutCombo.sil`(`validateOutputStateWithTemplate` + `OpOutputCovenantId` 组合, entry 直接
   参数形态, 用真实 ClaimStub2 派生的 prefix/suffix/hash/script_hex)—— PASS。
3. `ProbeBoutLoop.sil`(同上, 但改成 `ClaimState[] claims` 数组 + `for` 循环内按下标 `claims[j]`
   访问, 精确复刻 KanetTestToken.sil 里 `new_claims[j]` 的语法形态, 怀疑过的"数组下标表达式在
   `validateOutputStateWithTemplate` 里被临时变量提升是否有坑"这条假设)—— **同样 PASS**, 排除。

**结论**: `OpOutputCovenantId` 原语本身、它与 `validateOutputStateWithTemplate` 的组合、以及数组
下标访问形态，三层都经隔离探针验证正确。V-T-6 剩下的失败**必然**出在 `KanetTestToken.sil` 的
`transferPolicy`(`#[covenant(binding=cov,...)]`)这一层与上述机制的某种交互上——可能是
`prev_states`/`next_states` 由 covenant 框架自动绑定这件事本身引入的作用域/时序差异, 未及在限时内
建出一个"binding=cov + b-out 组合"的第四层隔离探针来实锤(尝试中的 `ProbeBoutCov.sil` 撞到一个跟本
调查目标无关的"array element type must have known size: State[]"编译错误——大概率是探针自己 State
只给 2 个字段导致的体积推断问题, 不是 KanetTestToken.sil 那边 6 字段 State 会撞到的坑, 需要另起时间
排除)。

## 边界声明(按派单③要求, 虽然结论是"一致"不是"不一致", 仍如实标注适用范围)

- 以上"debugger = 真共识代码"的结论基于 **cli-debugger 静态链接的 kaspa-txscript/kaspa-consensus-core
  版本**(随 silverc v1.0.0 隔离 clone 的 `Cargo.lock` 锁定, revision 见该 lock 文件), 与
  `/d/rusty-kaspa` 本地克隆检出的 7b1e18cc 之间**没有做逐字节 diff**(只对比了 `OpOutputCovenantId`
  这一段函数体逐行相同, 没有对比整个 covenants.rs/opcodes.rs 文件哈希)。若 GO-D 真链验证阶段用的
  kaspad 二进制版本与此处核对的两个源码点(a41a333 / 7b1e18cc)在这条 opcode 上出现任何后续差异
  (目前未发现, 但未来版本升级需要重新核对), 离线向量的结论边界仅覆盖到"这两个已核对的源码点"。

## 建议下一步
- 下一个有空档的时段建一个精简但完整的"`binding=cov` + 单一 b-out next_state"隔离探针(6 字段 State
  对齐真实 KanetTestToken.sil, 但只留 b-out 分支, 去掉 b-in/H3/H2/守恒等无关逻辑), 用 `-f transfer
  -a <raw_args>` 单步交互模式而非 `--run-all` 批跑, 逐条 require 手动步进拿到不丢失位置信息的完整
  栈追踪。
- 本次新增的 4 个探针文件(`ProbeOutCovId.sil` / `ProbeBoutCombo.sil` / `ProbeBoutLoop.sil` /
  `ProbeBoutCov.sil`)+ 对应 `.compiled.json`/`.test.json`/`mk_probe_*.mjs` 生成脚本全部保留在本目录,
  下一位可直接在探针 3 的基础上加 `binding=cov` 层继续排查, 不用从零建。

## 不影响的结论(与 v0.1 一致, 重申)
T1 v0.5(A″)设计的其余全部机制(H1(a)/H1(b-in)/H3/H2/ext/多实例隔离/NWT §1 攻击防御)全部已用真实
cli-debugger 运行时向量验证通过, V-T-6 的悬而未决现在已明确收窄到"`transferPolicy` 的 `binding=cov`
框架与已验证正确的 b-out 机制组合之间某个未定位的交互点", 不再有"是不是 debugger 本身语义有问题"这层
不确定性。
