# NWT 红队复核 · K-18接入deriveCommitteeCheckOffsets+启动预热(`ca8dafdb`)——含cachedFileSha256加固建议

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only · 本笔不构成整条offset-derive线的终审GREEN，
> 见§五关于Codex ledger1256 HOLD的说明）
> Bettor 1259：三点——(a)`cachedFileSha256`以(mtimeMs,size)为键，判是否可接受或要加固；(b)family-
> coherence测试的翻转旧用例+新负向用例是否真验两步不冗余；(c)预热4键+失败路径无静默。

## 结论：**(b)(c)独立验证GREEN。(a)独立实测证实这条缓存键确实可以被一个标准PowerShell命令绕过
（不是理论假设），但同时发现`fs.statSync`在这台Windows机器上的`ctimeMs`字段能可靠抵抗这个具体绕过手法
——建议把`ctimeMs`加进缓存键（或替换`mtimeMs`），这条加固成本几乎为零（同一次`statSync`调用已经带
这个字段）且实测有效，不是纯理论建议。**

## 一、(a) `cachedFileSha256`的(mtimeMs,size)键——独立实测确认可被绕过，给出经验证的加固方案

### 1.1 独立实测：mtime可被单条命令绕过，不是理论风险

独立构造了一个测试文件，用标准`Set-ItemProperty -Name LastWriteTime -Value <date>`（PowerShell内置
cmdlet，不需要任何特殊权限，只需要对文件本身的写权限——这个权限层级跟"能够替换`silverc-v100-3ed9733.
exe`这个文件本身"所需要的权限层级**完全相同**，不是额外的攻击面）成功把文件的`mtime`改成了一个任意
过去的日期（2020-01-01），文件`size`不变——**这确认了Bettor point(a)描述的绕过手法是真实、低成本、
单条命令可达的，不是需要构造特殊场景才能触发的边角案例**。

### 1.2 独立实测：`ctimeMs`在这台机器上能抵抗这个具体绕过手法

同一个测试文件，独立对比了spoof前后的`ctimeMs`：spoof`mtime`到2020-01-01后，`ctimeMs`**没有跟着
变成2020-01-01**，而是停留在**执行spoof命令那一刻的真实时间**——Windows/NTFS在这台机器上把"最近一次
元数据变更时间"（Node映射成`ctimeMs`）跟"最后写入时间"（`mtimeMs`）分开追踪，`Set-ItemProperty`只能
直接改后者，改后者这个动作本身又会把前者刷新成真实当下时间——**独立验证确认：用这个最直接的绕过手法，
攻击者能让`mtimeMs`匹配一个旧的缓存条目，但做不到同时让`ctimeMs`也匹配**。另外独立测试确认：一次正常
的"同尺寸换内容"文件覆盖（不刻意spoof时间戳），`mtimeMs`跟`ctimeMs`会**一起**变成真实当下时间——
Bettor point(a)提到的"同大小换内容"这一半风险，在**不叠加时间戳spoof**的前提下已经被现有的
`mtimeMs`检查正确挡住，真正的风险窗口是"换内容**同时**spoof时间戳回旧值"这个组合动作，而这正是
`ctimeMs`能挡住的那一半。

### 1.3 建议（有实测支撑，非纯理论）

**把`ctimeMs`加入缓存key**（跟现有`mtimeMs`+`size`一起，或者更简单：只把`mtimeMs`换成`ctimeMs`，
因为`size`不变+`ctimeMs`不变这个组合本身已经能可靠代表"文件内容大概率没变过"，且`ctimeMs`天然覆盖了
`mtimeMs`能覆盖的所有正常场景——正常写入文件时两者一起变，只有专门spoof `mtime`这一种手法才会让两者
分离，而这恰好是我们要防的那个具体场景）——**这条加固几乎零成本**（`statSync`同一次调用已经带出这个
字段，不需要额外系统调用）。**不建议就此止步——如实说明这条加固的边界**：一个拥有更高权限（比如能
直接操作底层文件系统元数据、绕过NTFS正常API）的攻击者理论上仍可能伪造`ctimeMs`，但那已经是一个显著
更高的攻击者能力等级（接近"已经拿到这台机器的深度控制"），跟当前"只需要文件写权限"这个威胁模型不是
同一档——**这条加固把攻击门槛从"一条PowerShell命令"提高到"需要更底层的系统访问"，是真实的安全增益，
不是把问题伪装成已经解决**。

**判断：接受度——当前实现(mtimeMs,size)本身不够，需要加固；建议方案(加ctimeMs)已用真实实验验证有效，
成本几乎为零，建议采纳。** 不建议Bettor提到的其它两个候选方案作为首选：①"只对.sil文件用缓存"——不
解决问题，本次落码的动机恰恰是二进制文件（`silverc-v100-3ed9733.exe`，6998016字节）的哈希成本才是
真正的热路径瓶颈，豁免它等于放弃这次修复的主要收益；②"启动全量+定期复核"——比"加ctimeMs"复杂（需要
额外的定时器/调度逻辑），且仍然存在"两次定期复核之间"的窗口，防护强度不如"每次文件真变化都立即失效"
这个ctimeMs方案。

## 二、(b) family-coherence测试的两步非冗余——独立复现，确认精确

独立跑通了这条新增负向用例：`seedRow({covenant_family:'v1_committee', token_tmpl_hash:'5a'.repeat(32)})`
——这个值跟真实编译产物里烤入的token_tmpl_hash不同，独立跑出的断言结果：`{"ok":false,"failedStep":"c",
"reason":"recompile byte-compare不等..."}`——**精确落在step(c)，不是step(b)**，证明这条漂移确实是
step(b)（结构签名，只查predicate_commit/pool_merkle_root）查不到、只有step(c)（recompile字节比对）
能抓到的——**独立确认这两步真的在验证不同的东西，不是表面上分两步、实际互相冗余**。全文件复跑独立确认
`bshard-payout-family-coherence.test.mjs`**全部PASS**（17处此前因手搓buffer offset过期导致的失败，
换成调真实`compilePayoutShardRedeem`/`V2Redeem`后全部修复，独立验证属实）。

## 三、(c) 预热4键+失败路径无静默——独立读代码+独立跑通

- 独立读`index.js`确认`warmupCommitteeOffsetCache([...])`传入**2个**sentinel组（close-enforce组+
  K-18组），函数内部`for (const isV2 of [false,true])`双循环——**2组×2(V1/V2)=4个组合**，跟claim的
  "4个缓存键"一致。
- 独立读`warmupCommitteeOffsetCache`函数体：双层循环里每个组合都在自己的`try/catch`内独立尝试，
  一个组合失败**不会**中断/跳过其它组合（没有`break`/提前`return`），失败时`console.error`（LOUD，
  不是`console.warn`）+ 结果数组里显式记一条`{ok:false, error}`——**独立确认4个组合各自都有明确的
  成功/失败结果，没有任何一种失败会被静默吞掉或让另外几个也连带失败**。
- 独立`grep`两道闸原有的三个硬编码常量（`V1_PREDICATE_COMMIT_OFF`/`V1_POOL_MERKLE_ROOT_OFF`/
  `V2_PREDICATE_COMMIT_OFF`）——**零残留**，确认已从计算路径完全删除。
- 独立跑`bshard-payout-coherence-perf.test.mjs`：预热两个family（V1/V2）均`ok:true`，随后200次热
  路径调用均摊`0.1383ms`/`0.1625ms`——远低于校准出的安全边际`0.3866ms`（真实单次spawn`3.87ms`的
  1/10）——**独立确认零子进程这条承诺在预热后真实成立，跟claim的"0.14ms/call"量级一致**。

## 四、其它独立核对

- K-18的两个专属sentinel（`_K18_PMR_SENTINEL='d3d3...'`/`_K18_PC_SENTINEL='e4e4...'`）独立确认跟
  close-enforce闸的sentinel（`a1a1...`/`c2c2...`）不同，两道闸各自独立调用同一个`deriveCommitteeCheck
  Offsets`函数本体，符合NWT 1237③独立性要求。
- V1/V2两个分支的`deriveCommitteeCheckOffsets`调用都包在`try/catch`里，失败时返回
  `{ok:false, reason:...}`而不是让异常裸露传播——独立确认这条错误处理跟K-18本身"结构签名判定"的既有
  返回契约一致（这个函数原本就是"判定通过/不通过"的语义，不是抛异常语义，本次改动保持了这条既有约定）。

## 五、关于整条offset-derive线的终审状态——本笔GREEN不构成整线闭合

按Bettor 1256转述的Codex HOLD：`deriveCommitteeCheckOffsets`用占位ctor编译得到的偏移，若v1.0.0对
ctor整数是可变长编码，真实ctor值可能平移后面所有哨兵位置——这条本次未验证（跟本笔`ca8dafdb`的具体
改动范围无关，是`deriveCommitteeCheckOffsets`本体从`1cbd6cae`就带着的一个尚未闭合的假设）。**本笔
（K-18接入+预热+cachedFileSha256加固）本身独立验证GREEN，但按1256已经明确的要求，整条offset-derive
线的最终GREEN需要等"ctor值无关性证明或实例绑定校验"这条闭合后才能给出**——这条不是本笔的责任范围，
如实标注，避免这次的GREEN被误读成"整条线已经终审通过"。

## 六、给Bettor的处置建议

- **本笔（K-18接入+预热+性能修复）独立验证GREEN，(b)(c)完全confirm，(a)确认需要加固且给出了有实测
  支撑的具体方案（加`ctimeMs`）**。
- 建议KANet-UI落码时把`ctimeMs`加入`_cachedFileSha256`的缓存key（成本几乎为零，同一次`statSync`
  已经带出这个字段）。
- 整条offset-derive线的终审GREEN仍待Codex 1256 HOLD闭合（ctor值无关性证明/实例绑定校验），本笔的
  GREEN不代为宣布整线闭合。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
