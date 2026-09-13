# NWT 红队复核 · ZERO_HASH系统性审计 v0.2（Codex四类扩展 + 期望id来源表 + 新发现）

> **Status**: FINAL v0.2（2026-09-14 · NWT · docs only）
> Bettor 1172/1173：Codex把v0.1的机械规则升为四类——(a)Op*CovId(other)写入owner/target/authority；
> (b)Op*CovId(other)直接用于授权/等值比较；(c)期望id若来自witness/state/DB/导入遗留对象须先证非零且
> 有来源绑定；(d)ZERO32同时作缺席哨兵与合法身份值。每条承担授权的等值比较要证两个操作数（观测下标独立
> 绑定 + 期望id非零且有来源）。对T1v0.7/PayoutShard/PayoutShardV2/KanetTokenClaim/RefundClaim③逐条重扫。

## 结论：**四类规则套用后，已修的四处（T1v0.7/PayoutShardV2代币续约/KanetTokenClaim路径ii/RefundClaim③）
全部仍然GREEN；发现一处此前未点名的新缺口——KanetTokenClaim路径(i)的`target_owner=OpInputCovenantId
(dest_idx)`没有显式`!=ZERO32`，其"独立验证"（market_suffix_hash尾匹配）检查的是sigScript字节，跟
covenant_id是两个独立字段，尾匹配通过不能证明covenant_id非零——比路径(ii)的原始洞窄（受checkSig(winner_pk)
门限约束，只能被合法signer自己或诱导它的对手方触发，不是任意第三方直接可达），但仍是真实的"up-for-grabs
悬赏"风险，建议补同款`!=ZERO32`，对齐(i)(ii)两条路径的防线力度。**

## 一、四类规则的操作化判据（供本表逐条套用，不是新发明，是把v0.1的"独立验证"讲清楚成两个可分别检验的条件）

对每一处**承担授权/所有权语义**的`Op*CovId(idx) == X`或`X = Op*CovId(idx)`：

- **操作数①（观测下标idx）**：`idx`本身是否被独立绑定到"这确实是我想要的那个特定对象"，而不只是"随便一个
  声明了某个covenant_id的位置"？绑定手法：`this.activeInputIndex`（结构性自身，恒成立）／sigScript尾部
  blake3/blake2b核对一个committed hash（前提：committed hash来源必须独立可信，见操作数②）。
- **操作数②（期望值X）**：`X`是否已经被证明**非零**、且这个"非零"证明的来源**可追溯到一个可信起点**（ctor
  烤值/genesis-immutable委托/或经过另一条独立检查证非零的State字段），而不是"witness随便供一个值,只要
  长得像"？
- **(d)的落地检查**：任何用`==`比较covenant_id的地方，**ZERO32绝不能是这个比较的一个"合法通过"分支**——
  即比较双方任一边允许是ZERO32时，等值比较本身就会把"缺席"(结构性未声明)误判成"存在且匹配"。

## 二、逐文件逐条过（现用版本，`coord/j2-t3-market-sil`分支）

### `KanetTestToken.sil`（T1 v0.7）

| 位点 | 类别 | idx绑定(操作数①) | 期望值来源(操作数②) | 判定 |
|---|---|---|---|---|
| `:59 ownerIsMarketInput`: `OpInputCovenantId(idx)==want && okTail` | (b) | `idx`=witness供的`recv_idx[j]`，**独立**由`okTail`(sigScript尾match `market_tmpl_suffix`)绑定 | `want`=`next_states[j].owner`，**紧邻上一行`require(!=ZERO32)`已证非零**(T1v0.7新增守卫)，来源=State字段(继承链最终溯源到genesis,见下) | ✅两操作数均已证 |
| `:72 transferPolicy`第一循环: `OpInputCovenantId(owner_input_idx[i])==prev_states[i].owner` | (b) | `owner_input_idx[i]`witness供，本行本身**没有**sigScript尾匹配之类的独立绑定——但这条链路是"验证既有持仓在场"不是"授权新目的地"，若`prev_states[i].owner`是ZERO32，右边(RHS)会要求`OpInputCovenantId==ZERO32`, 而左边idx指向的若也是ZERO32(裸输入)则等式成立——**这是理论上的"回声"，但见下方"无受害者"分析** | `prev_states[i].owner`**没有**在本入口被校验非零(校验只加在per-token-state创建的next_states侧)；能不能是ZERO32，取决于这枚代币历史上是否曾经历过genesis(免权限,任意owner) | ⚠️理论上是回声，**无新受害者**：genesis本来就免权限允许owner=ZERO32(自我放弃归属)，此处"能被任何裸输入在场核通过"正是"归属已放弃⇒任何人可花"的预期后果，不是意外泄漏——跟T1v0.7修复的"从非零偷渡到ZERO32"是相反方向，不受影响 |
| `:97注释/:101 transferPolicy新增守卫`: `next_states[j].owner != ZERO32` | (d)落地 | — | — | ✅已修(1158/T1v0.7)，本次复核确认位置正确(在`ownerIsMarketInput`调用之前) |
| `:114 transfer_delegator`: `OpInputCovenantId(my_owner_input_idx)==owner` | (b) | `my_owner_input_idx`witness供，无额外绑定 | `owner`=本covenant自身State字段——跟上一行同理，理论上可为ZERO32(genesis自我放弃)，同上"无新受害者" | ⚠️同上，无新受害者 |
| `:124/:130`: `OpCovInputCount(OpInputCovenantId(this.activeInputIndex))==1` | (a)(b)不适用 | 自身引用，结构性恒非零 | — | ✅恒安全 |

### `PayoutShard.sil` / `PayoutShardV2.sil`（absorb entry）

两文件`scanOwnedTokenInputs`内`tk.owner==OpInputCovenantId(this.activeInputIndex)`+ 续约输出
`owner: OpInputCovenantId(this.activeInputIndex)`——**全部是自身引用**(操作数①=`this.activeInputIndex`，
结构性恒非零)。**没有"other-reference写入owner/target"的位点**——这两个文件里唯一涉及owner的
`Op*CovenantId`调用全部是self，不落入(a)(c)的适用范围。✅无新发现。

### `KanetTokenClaim.sil`（spend entry）—— **发现一处此前未点名的缺口**

| 位点 | 类别 | idx绑定(操作数①) | 期望值来源(操作数②) | 判定 |
|---|---|---|---|---|
| `:70`: `tk.owner==OpInputCovenantId(this.activeInputIndex)` | (b) | 自身引用，恒非零 | `tk.owner`任意（若为ZERO32，等式因RHS恒非零而恒不成立⇒该代币结构性花不出去，不是漏洞，是"自身引用"这条规则的副产物） | ✅安全（利用了操作数①恒非零这一点，跟`tk.owner`本身是否证过非零无关） |
| `:83`路径(i): `target_owner=OpInputCovenantId(dest_idx)` | (a)(b) | `dest_idx`（指向某个tx.input）由`market_suffix_witness`的sigScript尾匹配+`blake3==market_suffix_hash`独立绑定 | **`target_owner`本身没有显式`!=ZERO32`**——独立绑定检查的是`tx.inputs[dest_idx].sigScript`的**尾部字节**，跟`covenant_id`是`TransactionOutput`/`UtxoEntry`上两个独立字段（本轮对RefundClaim③的复核已独立读pinned`covenants.rs`确认这一点）：一个P2SH输入完全可以有攻击者任意选择尾部字节的sigScript（P2SH redeem script参数位是spender自由填的），同时`covenant_id`字段是`None`——尾匹配通过**不能**证明`OpInputCovenantId(dest_idx)`非零 | 🔴**新发现，理论缺口**（详见下方分析） |
| `:85`路径(ii): `target_owner=OpOutputCovenantId(dest_idx)` | (a)(b)(d) | 无sigScript可独立绑定（输出没有sigScript这个概念），改用显式`!=ZERO32` | 显式`require(target_owner!=ZERO32)`（NWT 1158已修） | ✅已修，且此次复核确认这条显式检查是**唯一**真正生效的防线（模板匹配检查的是另一个字段，不能替代它——同RefundClaim③复核的发现） |

**独立构造验证（不是纯理论推演）**：把现有`V-CLAIM-1`（"目的地是市场，其它全部合法，只在最后签名门失败"）
的向量原样复用，唯一改动是删掉`dest_idx`那个输入的`covenant_id`声明（保留完全相同的sigScript尾部字节，
tail-match照样通过）——独立运行+翻转expect逼出verbose，变量转储里直接看到**`target_owner =
0x0000000000000000000000000000000000000000000000000000000000000000`**（真的变成了ZERO32），且代码在
这一点**没有任何require拦截**，一路带着这个ZERO32值往下走到`validateOutputStateWithInputTemplate`那一行
才因为别的原因（本次快速构造的output字节没有为ZERO32重算，不是因为有守卫拦它）失败——**这不是理论推演，
是直接从调试器变量转储里看到target_owner真的被污染成ZERO32且没有任何检查挡住它**。

**路径(i)缺口的严重度评估（如实分级，不夸大也不淡化）**：
- **触发门限**：`spend()`整个函数末尾有`require(checkSig(s, pubkey(winner_pk)))`——**只有真实winner私钥持有者
  才能让这笔交易通过**，`dest_idx`/`market_suffix_witness`都是winner自己（或winner使用的自动化工具/被诱导
  信任的对手方建议）填的witness参数。**不是任意第三方能直接单方面触发**，这跟路径(ii)修复前"任何随手指一个
  裸输出"的开放程度不同——路径(ii)当年的洞里，触发它的也同样是走`spend()`本身（同样要checkSig），**回头看，
  路径(ii)原始洞的触发条件跟路径(i)现在这条其实是同一个门限（都要winner签名），当时NWT 1158报告没有强调
  这条门限，这次一并如实补上**。
- **后果不是"自伤"，是"悬赏"**：一旦`target_owner`变成ZERO32（无论winner是自己失误、还是被恶意"市场"对手
  方诱导用一个精心构造的假P2SH输入去凑`market_suffix_witness`尾匹配），生成的代币输出owner=ZERO32——**任何
  第三方**（不只是诱导者）都能之后用任意裸输入通过"在场"检查把它花掉，这是一个**任何观察链上的人都能捡到
  的悬赏**，跟单纯"发错地址"（钱只是给错了特定收款人）性质不同。
- **建议**：路径(i)补一行`require(target_owner != ZERO32)`，跟路径(ii)对齐，闭合"尾匹配≠covenant_id非零"
  这个理论缺口——不是因为已发现真实被利用，是因为(c)(d)规则要求"每条承担授权的等值比较要证两个操作数"，
  当前路径(i)只证了操作数①（idx的"市场性"）没有证操作数②（期望值非零），跟KanetTokenClaim自己文件头
  "H1在场纪律最后一步也要适用"的既定纪律不一致——这条纪律不该因为"有checkSig门限"就放宽，门限决定的是
  "谁能触发"，不是"触发后果是否可接受"。

### `RefundClaim.sil`（③代币化，`6bc8ff55`）—— 复核（已在`c4b7dc9c`报告，本次按四类规则重新过一遍确认无新发现）

| 位点 | 类别 | idx绑定 | 期望值来源 | 判定 |
|---|---|---|---|---|
| `:95`: `heldTk.owner==OpInputCovenantId(this.activeInputIndex)` | (b) | 自身引用 | 任意（同KanetTokenClaim`:70`同理，恒安全） | ✅ |
| `:105 claimCovId=OpOutputCovenantId(claimOutIdx)` + `:106 require(!=ZERO32)` | (a)(b)(d) | 无独立sigScript绑定（输出），改用显式`!=ZERO32` | 显式检查（已在`c4b7dc9c`独立构造对抗向量确认这是唯一生效防线，`validateOutputStateWithTemplate`检查的是scriptPubKey字段不是covenant字段） | ✅已修且已独立验证 |
| `:111/:138`: `OpInputCovenantId(this.activeInputIndex)` | (a)(b) | 自身引用 | — | ✅恒安全 |

## 三、期望id来源总表（Bettor要求的"每字段标非零证明在哪一步"）

| 文件.字段 | 来源类型 | 非零证明位置 |
|---|---|---|
| `KanetTestToken.next_states[j].owner` | witness(State数组元素) | `transferPolicy`本函数内，紧邻使用前一行`require(!=ZERO32)`（T1v0.7新增） |
| `KanetTestToken.prev_states[i].owner` | witness(继承自更早交易的State) | **未证**，但操作数①(自身引用)不适用于这条(此处idx是other-reference)——见上方"无新受害者"分析，genesis免权限是设计已知的边界 |
| `PayoutShard(V2).absorb`的`owner`(续约/scanOwnedTokenInputs比较) | 自身引用 | 恒非零(操作数①自身引用规则)，不需要额外证 |
| `KanetTokenClaim.target_owner`路径(i) | witness(`OpInputCovenantId(dest_idx)`回显) | **未证**（本次新发现，建议补） |
| `KanetTokenClaim.target_owner`路径(ii) | witness(`OpOutputCovenantId(dest_idx)`回显) | `spend()`本函数内，紧邻使用后一行`require(!=ZERO32)`（NWT 1158已修） |
| `RefundClaim.claimCovId` | witness(`OpOutputCovenantId(claimOutIdx)`回显) | `refund_payout`本函数内，紧邻使用后一行`require(!=ZERO32)`（本次代币化落码新增） |

## 四、`RootClose.convert_to_claim`/`convert_to_refundclaim`落码时的审查预案（Bettor要求"按整条授权链审"）

这两个入口目前仍是v1.0.0语法迁移阻断名单里的文件，代码还不存在。**预先记下审查清单，落码后逐条对表**：
1. 新建`RootClaim`/`RefundClaim`实例的covenant_id来源（`OpOutputCovenantId`回显）是否有显式`!=ZERO32`。
2. 若有"独立验证"（tmpl_hash现场核对/tail-match），必须确认它验证的是**哪个字段**——是`scriptPubKey`
   字节匹配，还是`covenant_id`字段本身？两者不能互相替代（本轮KanetTokenClaim路径(i)+RefundClaim③两次
   独立发现的同一个教训）。
3. 若期望id来自`RootClose`自身State/ctor（`claim_tmpl_hash`/`refundclaim_tmpl_hash`），确认这两个ctor值
   本身的来源可信（留在ctor=创建市场时烤死，不是运行期witness供，按Q8既有裁决应该已经满足，落码后核实
   没有意外改成witness供）。

## 五、给Bettor的处置建议

- **四处已修的位点(T1v0.7/PayoutShard(V2)/KanetTokenClaim路径ii/RefundClaim③)按四类规则复核仍然GREEN**。
- **新发现：`KanetTokenClaim.sil`路径(i)`target_owner`缺`!=ZERO32`**，建议补一行，跟路径(ii)对齐——严重度
  比路径(ii)原洞窄（受checkSig(winner_pk)门限约束），但性质相同（"尾匹配≠covenant_id非零"），不建议因为
  门限存在就跳过，理由见上方"后果不是自伤是悬赏"分析。
- T1v0.7/PayoutShard(V2)里"other-reference+无独立证非零"的两处(`prev_states[i].owner`/`transfer_delegator`
  的`owner`)判定"无新受害者"，不需要修——如实记录判断依据供以后复查。
- `RootClose`落码审查预案已给，落码后按上面§四逐条对表，不需要现在动。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
