# NWT 红队复核 · committee-offset-derive接入拒签闸(`808011fa`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1246：审点——4组硬编码常量非注释行0命中；专属sentinel a1…/c2…；派生调用不在try/catch内故异常
> 上抛；既有测试全过。**重点**：调用方（settle daemon/bshard-auto-settler）拿到throw是当"拒签"处理，
> 还是崩溃重启循环、或被某处宽泛catch误判通过——需在调用方证实，不能只信"既有纪律天然覆盖"这句话。

## 结论：**全部独立验证GREEN，重点项（调用方throw处置）经完整调用链追踪确认——`deriveCommitteeCheckOffsets`
抛出的异常，沿`extractOnChainPoolMerkleRoot`/`_enforceCloseAttestCore`两条路径分别向上传播，最终都在
`bshard-close-voter.js`的`processCloseRequest`函数自己的`try/catch`里被捕获，转成`{errored:true}`这个
跟`{signed:true}`完全不同的结果类型——**不会被误判成"签了"，也不会让外层`bshardCloseVoterTick`的循环
崩溃**（`processCloseRequest`的catch吸收了异常，外层循环只是把这次记进`errored`计数器，继续处理下一个
market/voter）。settler侧另一个调用点（`buildProposeCloseRequestV2`）性质不同——它是构造提案，不是
签名判定，即便这里的throw未被特别捕获也不构成安全问题（真正的把关始终在委员各自独立跑的
`enforceCloseAttest`那一侧）。**

## 一、4组硬编码常量清除——独立grep确认零非注释命中

`grep -n "_PREDICATE_COMMIT_REDEEM_OFFSET\|_PMR_COMMITTEE_CHECK_OFFSETS"`整个文件唯一命中是第33行
一条注释（描述本次迁移历史），**零代码引用**——两条计算路径（`_enforceCloseAttestCore`的predicate_commit
检查、`extractOnChainPoolMerkleRoot`）均已改调`deriveCommitteeCheckOffsets`。

## 二、专属sentinel——独立核对

`_ENFORCE_PMR_SENTINEL='a1a1...'`/`_ENFORCE_PC_SENTINEL='c2c2...'`——跟Bettor转述的"a1…/c2…"一致，且
独立确认这两个常量是本文件**唯一**使用，注释明确写"下面这两个sentinel只属于本文件(拒签闸)专用，不与
另一道闸共享"——跟我`1ad41bb6`/`0a02a2c3`两次判断的"两闸各自独立传不同sentinel"这条要求对应。

## 三、派生调用不在try/catch内——逐一核对两条路径

- **predicate_commit路径**（`_enforceCloseAttestCore`第353行附近）：独立读了上下文，`const
  _predicateCommitOffset = deriveCommitteeCheckOffsets(...).predicateCommitOffset;`是一条**裸语句**，
  前后没有任何`try{`包裹——异常直接从`_enforceCloseAttestCore`（`async function`）向上传播成一个
  rejected promise。
- **poolMerkleRoot路径**（`extractOnChainPoolMerkleRoot`函数体内）：这个函数本身也没有把
  `deriveCommitteeCheckOffsets`调用包进try/catch——裸调用，异常直接从函数体向外抛。

**两条路径确认都是"裸抛"，没有在本文件内被吞掉或降级处理。**

## 四、【重点】调用方throw处置——完整调用链追踪，独立确认

`extractOnChainPoolMerkleRoot`被两处调用，`_enforceCloseAttestCore`（进而`enforceCloseAttest`）被
一处committee-voter侧调用+一处内部调用——独立追了全部链路：

### 4.1 委员投票侧（`bshard-close-voter.js`）——安全性核心路径，确认异常被正确吸收成"未签"

`bshardCloseVoterTick()`的循环体对每个`(market, voter)`调用`processCloseRequest(voter, market, req,
enforceCloseAttest)`，`processCloseRequest`函数体自己是**一整个大`try{...}catch(e){return {errored:
true, reason: e.message}}`**——`enforceCloseAttest(...)`（内部经`_enforceCloseAttestCore`触发
`deriveCommitteeCheckOffsets`）就在这个大try块内被调用。**独立读了catch块**：`return {errored: true,
reason: e.message}`——这跟"签名成功"的返回值`{signed: true}`是**两个不同的对象结构**，外层循环的
判定逻辑`if (r.signed) signed++; else if (r.refused) refused++; else if (r.errored) errored++; else
skipped++;`会把它计入`errored`桶，**绝不会被误判成`signed`**。且外层`bshardCloseVoterTick`本身在
这个循环外层还有一层`try{...}finally{running=false}`（无catch，但循环体内每个`processCloseRequest`
调用自己的异常已经被消化，不会冒泡到这一层）——**外层tick函数本身不会因为一次offset派生失败而抛出
未捕获异常，不存在"这次tick崩了、daemon进程被外部watchdog重启"这条风险链**（tick继续处理下一个
market/voter，正常return统计结果）。

**结论：这条路径上，offset派生失败的效果是"这个市场这次没有产生签名"（跟`{refused:true}`语义等效但
标签不同：都是"没签成"，不是"签成了"），既不会误判通过，也不会让daemon进程崩溃重启。这条是Bettor要求
"在调用方证实"的核心问题，独立追踪代码确认成立，不是只信J2那句"既有纪律天然覆盖"的自述。**

### 4.2 另一处内部调用（`reDeriveCommittee`，被`_enforceCloseAttestCore`自己调用）——同一条安全链路内

`extractOnChainPoolMerkleRoot`第二处调用在`reDeriveCommittee`函数体内，这里的try/catch是**重新包装
再抛**（`catch (e) { throw new Error(\`C2-anchor: poolMerkleRoot链读失败(${e.message})\`); }`）——
不是吞掉，是加一层上下文再继续往上抛。独立确认`reDeriveCommittee`的**唯一**两个调用点：一处就是
`_enforceCloseAttestCore`内部（第455行）——跟§4.1是**同一条已确认安全的调用链**，异常最终一样会被
`processCloseRequest`的catch吸收；另一处在`bshard-close-transport.mjs`的`buildProposeCloseRequestV2`
——见§4.3。

### 4.3 Settler侧调用点（`buildProposeCloseRequestV2`）——性质不同，非安全关键路径

这个函数是settler侧**构造close提案**用的（不是委员的独立验证闸）——独立确认它调`reDeriveCommittee`
只是为了拼装`committeeMeta`（各委员在merkle树里的位置证明）随提案一起发出去，**委员收到提案后仍然会
各自独立跑一遍`enforceCloseAttest`重新验证一切，不会信任settler这边算出的任何东西**（这正是Track B
"委员独立re-derive、不信调用方"的整体设计——本session此前已反复确认过这条信任边界）。即便这个函数内部
的throw没有被特别捕获而导致"这次提案没构造出来"，最坏后果是**这次settle流程的可用性问题**（提案没
发出去，委员没东西可签，liveness受影响)——**不会导致任何错误签名产生**，因为签名判定权始终在委员各自
的独立验证那一侧（§4.1已确认安全）。**这条不是安全阻断项，是记录性观察**：如果Bettor/KANet-UI希望
这条提案构造路径本身也更健壮（比如失败后重试而不是让上层调用方处理一个未捕获异常），可以作为独立的
运维健壮性改进，跟本次委员签名安全性审查是两件事。

## 五、既有测试——独立跑通

独立`git worktree`+`npm install`后跑了`bshard-close-enforce.psv2-read.test.mjs`：**全部PASS**（round-trip
byte-exact + 4条fail-closed guard断言），确认这份测试确实没有touch本次改动的路径（读的是
`readPayoutShardV2AttestedState`/`_splicePayoutV2CloseRedeem`，跟`predicate_commit`/`poolMerkleRoot`
offset派生是两套完全不同的字段），零意外回归。

## 六、给Bettor的处置建议

- **本笔全部GREEN，可以确认**——重点项（调用方throw处置）已通过完整调用链追踪独立证实：委员投票侧
  异常被`processCloseRequest`自己的catch正确吸收成`{errored:true}`（跟"签了"是完全不同的结果类型，
  且不会让daemon崩溃重启）；settler侧的提案构造路径性质不同，不是安全关键路径，即便未来想加固也是
  独立的运维健壮性问题。
- 排序：0c0f65dd（rule 82设计页）→ 26bdf679（密钥导出锁定设计）随后按你1246/1248/1249说的顺序审。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
