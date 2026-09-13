# V-T-6 (b-out 正向量) 未收敛 — 如实记录, 不藏

**Status**: OPEN — 需要 NWT/后续会话继续查, 不阻塞 T1 其余 14 向量交付。

## 现状
15 条向量里 14 条行为符合预期(13 条 `expect` 精确匹配 + V-harness 正确翻红证明谐波不摆设)。
唯独 **V-T-6**(b-out 路由的"正"向量: `recv_idx<0`, 通过 `validateOutputStateWithTemplate` 新建一个
领取 covenant 输出并核对 `OpOutputCovenantId(out_k) == next_states[j].owner`)在 cli-debugger 里报
`error: script ran, but verification failed`，具体是哪一条 `require()` 失败因栈追踪丢失(报错行号退化
到 `1:1` pragma 行、多个局部变量显示 `<unavailable: negative stack index>`)而定不下来。

## 已验证成立的部分(不是"整个 b-out 都没测过")
- **V-T-7**(b-out 的"反"向量, 同样结构, 只是 claim 输出的 `script_hex` 换成 amount 被篡改的变体)
  **正确报 fail**——证明 `validateOutputStateWithTemplate` 的模板不匹配检测确实在起作用,
  且整条 b-out 分支代码路径确实被执行到了(不是整段代码没跑起来)。
- P9/P11/P12 三个既有探针已经分别独立证明: (a) `validateOutputStateWithTemplate` 的 P2SH 脚本比对本身
  可行(P12 六向量全绿); (b) 模板 hash/前后缀作运行期状态字段不改变编译产物(P11); (c) `readInputStateWithTemplate`
  同一原语的输入侧镜像可行(P9 4/4)。

## 已排除的假设(按尝试顺序, 供后来者不重复踩坑)
1. **`OpOutputCovenantId` 从 `script_hex` 反推 hash(P2SH 内嵌的 32 字节段)** —— 试过, `require()` 在正常
   路径(未加 `covenant_id`/`authorizing_input`)干净地失败在我自己的 `require(OpOutputCovenantId(out_k)
   == next_states[j].owner)` 那一行(报错位置清晰), 说明比对确实发生但两边值对不上。
2. **同时显式给输出加 `covenant_id`(=候选 hash 值)** —— 撞见 `WrongGenesisCovenantId(0, ...)`
   (来自 rusty-kaspa `covenants.rs` 的 genesis 一致性预检, 不是我合约自己的 require)。追出这条错误来自
   `hashing::covenant_id::covenant_id(auth_input.previousOutpoint, auth_outputs)`——一个真实 consensus
   哈希函数, 用 keyed blake2b(域 `b"CovenantID"`)+ 授权输入的 `(txid,index)` + 每个被授权输出的
   `(index,value,spk_version,spk_script)` 重算。已在 `genesis_covid.mjs` 里用 `@noble/hashes` 精确复刻并
   验证能绕过 `WrongGenesisCovenantId`(见下方"已验证的旁路")。
3. **正确复刻 genesis 哈希后**(用 `prev_txid`/`prev_index` 显式指定授权输入的 outpoint, 按同一算法算出
   `covenant_id` 喂给输出)—— 绕过了 `WrongGenesisCovenantId`, 但仍然在同一条 `require()` 上失败, 报错行号
   依旧退化到 `1:1`, 未能确认真正原因。
4. **改用"continuation 案例"绕开整套 genesis 重算**(额外喂一个已持有目标 covenant_id 的输入作
   `authorizing_input`, 让 `covenants.rs` 走 `Continuation case` 分支, 纯字符串等值判断不涉及任何哈希)——
   **V-T-7 因此转为正确报 fail**(证明整条路径确实被执行、`validateOutputStateWithTemplate` 确实在挡东西),
   但 V-T-6(对应的"正"配置)仍然失败, 换了两种 `covenant_id` 取值(任意常量 `0x22*32`、P2SH 内嵌 hash)
   结果一样。

## 建议下一步(留给 NWT / 下一个会话)
- 用 `-f transfer -a <raw_args>` 单步交互模式(而非 `--test-file --run-all`)逐条 `require()` 手动步进,
  拿到栈追踪不丢失位置信息的完整视图, 定位到底是 `validateOutputStateWithTemplate` 本身、还是紧接着的
  `OpOutputCovenantId` 比较、还是更早的 `sum_in==sum_out` 守恒检查失败。
- 或直接读 debugger session 的求值器源码(`debugger/session/src/covenant.rs` 未命中任何
  `OpOutputCovenantId` 字符串——说明这条 opcode 走的是某个更底层/通用的求值路径, 未被专门 case, 值得
  确认它到底读什么字段)。
- 本次交付的 `mk_vectors.mjs` + `genesis_covid.mjs` + `claim_stub2.derived.json` 都保留在本目录,
  下一位可以直接在这些文件基础上继续实验, 不用从头重建 ClaimStub2/P2SH 派生链路。

## 不影响的结论
T1 v0.5(A″)设计的其余全部机制——H1(a) 花费侧 owner 在场、H1(b-in) sigScript 尾模板证明、H3 borrow_scheme/witness
钉死、H2 三入口编译期常量恒拒(测试构建)、ext 字段钉零、多实例隔离、NWT §1 自建 trivial covenant 攻击被两条路
同时挡住——**全部已用真实 cli-debugger 运行时向量验证通过**, 剩下悬而未决的窄窗口就是 `OpOutputCovenantId`
这一个原语在"新建 covenant 输出"场景下的精确语义, 范围明确、不影响其余交付内容的可信度。
