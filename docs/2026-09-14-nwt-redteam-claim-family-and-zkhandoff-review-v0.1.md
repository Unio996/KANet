# NWT 红队复核 · claim家族四处收尾 + CloseZkV2/zk_handoff联合项(5笔)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1186：`01a12539`(CloseZkV2代币化)/`fbad9c67`(PayoutShardV2.zk_handoff代币化)/`6156e98d`
> (RootClaim.claim_draw)/`0d8a61ee`(PayoutShard.claim/refund_claim)/`e9ff2171`(PayoutShardV2.refund_claim)
> 五笔同批审，按独立编译/向量复现/授权链两操作数/§2表列/AB11常量重量的方法。

## 结论：**五笔全部GREEN。D-017"代币只许covenant持有"原则下claim家族四处(PayoutShard.claim/
refund_claim、RootClaim.claim_draw、CloseZkV2.claim/escape_claim、PayoutShardV2.refund_claim)+
zk_handoff全额转移全部收尾，独立验证confirm齐全，无新发现的安全问题，两处纯措辞nit不阻塞。**

## 一、`01a12539`（CloseZkV2代币化）—— 我自己独立核，GREEN

- **字节级重编译一致**（`bytecode_length=13382`）；**23/23向量独立跑通**（B类11+A类12）。
- **4条关键负向量caret独立确认**（翻转expect逼出verbose）：`V-CZK-CLM-3`/`V-CZK-ESC-3`（假claim模板）
  精确落在`validateOutputStateWithTemplate`调用行（331/198）；`V-CZK-CLM-4`/`V-CZK-ESC-4`（owner改道）
  精确落在`validateOutputStateWithInputTemplate`调用行（340/207）——跟claim/escape_claim对称，caret均
  落在预期行，不是巧合。
- **AB11常量独立重量测**：`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=213`跟编译产物`state_span`完全吻合，理论算
  （20个int字段×9 + 1个byte[32]字段×33 = 180+33=213）自己验算无误，0漂移。
- **NegIntProbe的sign-magnitude发现独立复现**：自己编译+跑`NegIntProbe.sil`两条向量，确认`-1 as byte[8]`
  产出`0x0100000000000080`（sign-magnitude），`0xffffffffffffffff`（两补数）那条真的FAIL——独立坐实这
  条新toolchain事实。**核对确认CloseZkV2本文件21个AB11编码字段(attestedWinner/closed/consolidated_pool
  -stake(payout)/nw0..nw16)全部结构性恒非负**（bit-flip w+mask/固定小整数/守恒后仍为正），这次发现的
  sign-magnitude编码规则不会被本文件实际触发，是记录在案的toolchain知识，不是本文件里的活风险。
- **授权链表核对**：README§授权链表逐条列了两操作数来源+非零证明，措辞已按1173纠正（"独立验证=显式
  `!=ZERO32`本身,不能靠claim_tmpl_hash模板核对代付"）——跟本会话确立的正确理解一致。**唯一遗留的小
  不一致**：`.sil`源码里的行内注释仍写着旧措辞"独立验证=上面claim_tmpl_hash的现场核对"（跟README不
  同步），纯文档措辞nit，代码本身（守卫位置/条件）完全正确，不影响任何安全结论。
- **README自报的"三个ctor hash缺ctor端非零断言"未覆盖点**：核对了后果——`token_tmpl_hash`/
  `claim_tmpl_hash`若被创建者(`zk_handoff`)误设为ZERO32，会导致对应P13检查因blake3抗原像而永久不可
  满足（纯liveness故障，不是资金安全洞）；`market_suffix_hash`若为ZERO32，只会让未来"转回市场再下注"
  这条路径(KanetTokenClaim path(i))对*这一个market创建的claim*永久失效，同样是liveness而非theft——
  三处都是"市场创建者自己配置错自己的市场"，跟本会话已确立的"genesis免权限自伤无第三方受害者"同一类，
  不是MUST-FIX，如实记录在案供以后参考。

## 二、`fbad9c67`（PayoutShardV2.zk_handoff代币化 + canonical-pipeline修复）—— 我自己独立核，GREEN

**独立重新推导整套切分算法，不是重跑他们的脚本**：自己读了`kasia-console/src/lib/pool-shard-register.mjs:189`
`computeCloseZkTmplAnchor`的真实生产代码，确认其`findUnique`搜索的是**裸32字节标记值**（不含push-tag前缀）
——这意味着标记值前面的`0x20`那个tag字节属于templateA/C自己的最后一字节，不是拼接时要单独补回去的东西。
**自己重新手写了一份同算法的独立实现**（不是照抄provenance目录里已有的`measure_closezk_splice.mjs`），用
**跟他们完全不同的标记字节**（`0x33`/`0x44`代替他们的`0x11`/`0x22`）+**不同的attestedAtMs值**+我自己
worktree里的CloseZkV2.sil副本+我自己的silverc build，独立跑出：

```
templateA_len: 734, templateC_len: 1007, tailMatches: true
```

**跟commit声称的修复后数值(733→734, 1006→1007)完全吻合**——不同标记、不同工具链实例、独立重新实现算法
得到同样的边界值，排除"凑巧对上"的可能性，确认这条修复是真的对的，不是自证circular。

**向量独立复现**：5/5全部跑通，其中`V-ZKHO-1_pass_full_handoff`是端到端正向向量（真实构造closeZkTmplAnchor
+新建CloseZkV2输出的scriptPubKey比对通过）——这本身就是对切分算法正确性的最强端到端证明（如果切分点还
偏一位，正向向量重建的hash会跟真实编译产物不符，直接FAIL）。**两条关键负向量caret确认**：`V-ZKHO-3`
（owner改道）精确落在`validateOutputStateWithInputTemplate`（541行）；`V-ZKHO-5`（裸covenant/ZERO32）
精确落在`require(zkCovId != ZERO32)`那一行本身（538行）——**证明V-ZKHO-5确实验证了"脚本字节匹配≠covenant
绑定"这个此前反复确认的规则，不是巧合落在别处**。

**同一处措辞nit（跟CloseZkV2一样）**：`.sil`源码注释仍写"独立验证=上面closeZkTmplAnchor的全字节比对"，
跟本会话确立的正确理解（比对的是scriptPubKey字段不是covenant_id字段，真正独立承重的是显式`!=ZERO32`）
表述不完全精确——代码本身（守卫在使用前、V-ZKHO-5证明它真的独立生效）没有问题，只是注释可以更准确。

## 三、claim家族三处（`6156e98d`/`0d8a61ee`/`e9ff2171`）—— 并行子审查独立核，均GREEN

三笔各自派了一个独立子审查（同一套方法：字节级重编译比对/全部向量独立跑通/关键负向量caret确认/AB11
常量重量测/ZERO32守卫位置核对），结果汇总：

| 提交 | 文件.入口 | 编译比对 | 向量 | AB11常量 | caret确认 |
|---|---|---|---|---|---|
| `6156e98d` | RootClaim.claim_draw | 一致(bytecode_length=2991) | 6/6 | OWN_STATE_LEN=96(7×9+33=96验算无误) | 假模板→148行模板检查；owner改道→157行输出绑定检查(非ZERO32行，属预期——陌生人真实非零covenant被输出绑定检查抓住) |
| `0d8a61ee` | PayoutShard.claim+refund_claim | 一致 | 12/12(6+6对称) | OWN_STATE_LEN=204(复用，2个新ctor-only常量确认不影响state_span) | 假模板→373/613行；owner改道→382/622行(输出绑定检查) |
| `e9ff2171` | PayoutShardV2.refund_claim | 一致 | 6/6 | OWN_STATE_LEN=288(复用) | 假模板→481行；owner改道→490行(输出绑定检查) |

**家族完整性收口检查（`e9ff2171`子审查额外做的）**：`grep "ScriptPubKeyP2PK"`跨
`PayoutShard.sil`/`RootClaim.sil`/`CloseZkV2.sil`/`PayoutShardV2.sil`/`RefundClaim.sil`全部claim家族
入口——**全仓零命中**，确认claim家族里再没有遗漏的裸P2PK派彩路径。

三笔ZERO32守卫位置均确认在使用前、跟RefundClaim③/KanetTokenClaim路径(i)/CloseZkV2/zk_handoff同一套
已验证的承重逻辑一致，不重复展开。

## 四、给Bettor的处置建议

- **五笔全部GREEN，可以定案**——D-017下claim家族四处+zk_handoff全额转移全部收尾完成。
- **两处纯文档措辞nit**（CloseZkV2/zk_handoff的`.sil`源码行内注释仍用旧的"独立验证=模板核对"措辞，
  跟已按1173纠正的README不同步）：不影响任何安全结论，建议顺手同步一下注释措辞，不阻塞。
- CloseZkV2 README自报的"三个ctor hash缺非零断言"：判定为liveness风险非theft风险（跟genesis免权限
  同一类"自伤无第三方受害者"），不是MUST-FIX，记录在案。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
