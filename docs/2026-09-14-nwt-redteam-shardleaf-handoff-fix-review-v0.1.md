# NWT 红队复核 · hand-off原子性MUST-FIX修法(`9ff095a3`) + 2笔as-built文档补记(`cf2bdd0b`/`c8153301`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1199：`9ff095a3`（ShardLeaf删自建代币输出/PS系零改动）按1198 Codex强制集成向量清单独立复现；
> mass更正与MAX_INS_SCAN活性核对文档；`cf2bdd0b`（as-built补记）/`c8153301`（文档演进说明）一并核。

## 结论：**三笔全部GREEN。`9ff095a3`按Codex强制清单逐条对上，10/10向量独立复现，含一项关键方法论验证
（共享tx JSON的deep-equality确认，证明"分喂两合约"这套集成测试法代表真实的同一笔交易，不是两个凑巧都过的
虚构）。`cf2bdd0b`/`c8153301`是纯文档编辑，内容跟本会话已独立核实的事实逐字对得上，无新增代码风险。**

## 一、`9ff095a3` —— 按Codex 1198清单逐条独立复现，GREEN

### 1.1 修法本身：独立确认代码改动范围

- `git show 9ff095a3 --stat`独立确认：**只有`kasia-console/src/lib/ShardLeaf.sil`一个文件改动**，
  `PayoutShard.sil`/`PayoutShardV2.sil`**零改动**（不是信commit message的"我核stat无PayoutShard文件"，
  是自己跑的同一条命令）。
- 独立读了`ShardLeaf.sil`的完整diff：`consolidate_to_payout`删除`int tokenInIdx, int tokenOutIdx`两个
  参数，以及整段`validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{...owner: ps_cov...},
  tokenInIdx, ...)`（自建代币输出的relabel逻辑），收窄为纯输入侧核对：
  ```
  int owned_total = scanOwnedTokenInputs(tok_prefix, tok_suffix);
  require(owned_total == pool_value);
  ```
  relabel完全交给`PayoutShard.absorb`既有、未改动的`tok_out`一步完成——跟本会话此前独立复核的架构论证
  （KanetTestToken`transferPolicy`的(b-in)路由要求新output的`owner=X`时X的真实input必须同笔交易在场，
  这迫使`consolidate_to_payout`与`absorb`结构性同笔交易原子——两个入口各自再建一次输出是重复表示
  `pool_value`）完全一致。

### 1.2 独立编译 + 向量复现

- `git worktree add scratch/_nwt_handoff_fix 9ff095a3`（已在本轮review完成后按Rule 81清理，见文末）。
- 自己的`silverc.exe`独立编译`ShardLeaf.sil`：`bytecode_length=15166`（对照修法前的15542，降幅与删除代码
  量一致）。
- **`ShardLeaf.handoff-fix.test.json`（3条，ShardLeaf侧）**：全部PASS——
  `V-HOF-1_pass_shardleaf_side_consolidate_to_payout`、
  `V-HOF-5_fail_shardleaf_smuggled_second_owned_token_uncounted`、
  `V-HOF-6_fail_wrong_ps_covenant_id_fake_ps`。
- **`PayoutShard.handoff-fix.test.json`（7条，PayoutShard侧）**——**直接对真实canonical
  `kasia-console/src/lib/PayoutShard.sil`跑，不是provenance里的静态副本**：全部PASS——
  `V-HOF-1_pass_payoutshard_side_absorb_same_tx`、
  `V-HOF-2_pass_next_absorb_correctly_counts_merged_token`、
  `V-HOF-3_fail_smuggled_second_owned_token_uncounted`、
  `V-HOF-4_fail_shard_amount_undercount_mismatch`、
  `V-HOF-7_fail_duplicate_shard_token_inflated_output`、
  `V-HOF-8_fail_wrong_output_amount`、
  `V-HOF-9_fail_missing_continuation_scriptpubkey_mismatch`。
- **总计10/10**，跟commit claim的数字（3 ShardLeaf + 7 PayoutShard）完全对应。

### 1.3 关键方法论验证：共享tx JSON是否真代表同一笔交易

cli-debugger一次只能测一个`.sil`文件的一个入口，`V-HOF-1`分成"ShardLeaf侧"和"PayoutShard侧"两份JSON分别
喂给各自合约——这个方法论本身需要证明两份JSON描述的是**同一笔真实交易**，不是两个凑巧都通过的独立虚构。
**独立`JSON.stringify`深度比对**两份`V-HOF-1`的`tx.inputs`/`tx.outputs`：**字节级完全一致**（4 inputs、
2 outputs），唯一差异是`active_input_index`（ShardLeaf侧=0，PayoutShard侧=2）——这正是同一笔交易在两个
不同input位置各自执行自己那段脚本时该有的差异，**证明这套集成测试法确实代表一笔真实的、Kaspa会按input
逐一独立验证脚本的交易，不是伪造的"各自过关"**。

另外核对了`V-HOF-2`（"下一次absorb正确计入已合并代币"场景）：其`tx.inputs`数=3，跟`V-HOF-1`的4不同——
确认这条向量正确建模的是一笔**独立的、后续的**交易（不是`V-HOF-1`的复制品），场景语义与JSON结构一致。

### 1.4 caret精确性确认（2条关键负向量）

翻转`expect`逼出verbose failure输出：
- `V-HOF-3_fail_smuggled_second_owned_token_uncounted` → 精确落在
  `require(owned_total == consolidated_pool);`（149行）。
- `V-HOF-7_fail_duplicate_shard_token_inflated_output` → 精确落在
  `validateOutputStateWithInputTemplate(tok_out, TokenState {`（154行，输出绑定检查）。

两条均落在预期的检查点，不是别处的无关失败。

### 1.5 对照Codex 1198强制集成向量清单——逐条映射

| Codex要求 | 覆盖向量 | 结果 |
|---|---|---|
| 正向：P+S恰一次续约 | `V-HOF-1`（ShardLeaf侧+PayoutShard侧，共享tx JSON确认为同一笔交易） | PASS |
| 正向：无重复/销毁/未消费relabel代币残留 | `V-HOF-1`+`V-HOF-2`（下一次absorb正确计入，证明relabel后的token状态可被后续正常消化，无残留/冻结） | PASS |
| 负向：错PS covenant-id（fake PS） | `V-HOF-6` | FAIL（如预期） |
| 负向：重复分片代币输入 | `V-HOF-7`（duplicate shard token inflated output） | FAIL（如预期，caret落点154行确认） |
| 负向：隐藏额外PS名下代币输入（smuggled） | `V-HOF-3`（PayoutShard侧）+ `V-HOF-5`（ShardLeaf侧） | FAIL（如预期，caret落点149行确认） |
| 负向：错金额 | `V-HOF-4`（shard_amount undercount）+ `V-HOF-8`（wrong output amount） | FAIL（如预期） |
| 负向：缺续约 | `V-HOF-9`（missing continuation scriptPubKey mismatch） | FAIL（如预期） |

**Codex清单六项全部有对应向量覆盖且结果符合预期，无遗漏项。**

### 1.6 mass更正 + MAX_INS_SCAN活性核对文档——独立确认存在且措辞准确

- `docs/2026-09-14-j2-t3-as-built-and-merge-readiness-v0.5.md`独立grep确认mass更正段落存在：
  "~9u/byte经验比率估算约167,150 mass单位，这个套用**已确认是错的**并撤回；按真实公式对
  `rc_prefix+rc_suffix=16715`字节重算，`compute≈16,715`、`transient≈66,860`"——跟本会话此前
  （`47a4893c`审查）独立读consensus mass公式源码给出的更正结论逐字一致。
- 独立读了MAX_INS_SCAN活性核对表（该文档第195-220行附近）：列出`pool-register-builder.mjs`/
  `pool-shard-settle.mjs`/`bshard-close-transport.mjs`/`pool-close-builder.mjs`/`pool-claim-builder.mjs`
  等真实console侧交易构造器，逐入口给出真实输入数2-3（`register_append`=2、
  `consolidate_to_payout`+`absorb`合计=3、`close_attest`=2、`zk_handoff`=2、`close_commit`=2、
  旧`claim`=3可能已被取代），`MAX_INS_SCAN=8`有2.5x-4x余量——**且如实披露了一个开放限制**：新代币化
  参数（`tokenInIdx`/`stakeInIdx`等）**目前没有真实console侧调用方**，这条无法对新代码路径完全证明，
  文档没有把这个缺口藏起来，标注为开放项而非默认"已核实"。**这条披露方式是我认可的正确做法**——跟本会话
  一贯要求的"活性核对不能只对旧路径回填"标准一致。

## 二、`cf2bdd0b`（as-built补记）—— 独立确认，GREEN

纯文档编辑，`docs/2026-09-14-j2-t3-as-built-and-merge-readiness-v0.5.md`一个文件，5行改动。独立读了完整
diff：
- §1提交清单新增两行（#31=`c8153301`，#32=`9ff095a3`），描述与本文档§一的独立复核结果一致。
- §2逐文件表更新：`ShardLeaf.sil`的`bytecode_length`从15542改成15166——**跟我自己独立编译的读数完全
  一致**；向量数从15改成"15(tokenization) + 3(handoff-fix，本文件那半)"——跟我自己跑的3条ShardLeaf侧
  向量数一致。`PayoutShard.sil`标注"absorb本身未改动"——**跟我自己`git show 9ff095a3 --stat`独立确认的
  零改动结论一致**；向量数从35改成"23+12+7=42"——跟我自己跑的7条PayoutShard侧向量数一致。
- §4 provenance索引加一条`j2-t3-v03-shardleaf-payoutshard-handoff-fix`——命名跟本文档§一引用的provenance
  目录一致。

**无夸大、无遗漏，数字全部跟我自己的独立复现对得上，GREEN。**

## 三、`c8153301`（MAX_INS_SCAN文档演进说明）—— 独立确认，GREEN

同一份as-built文档，改动§5第5项+新增第6项，纯文档。独立读了完整diff：

- 把原来"待NWT确认的开放项"（v0.2复核precondition(c)字面"必须≥1000" vs v0.3§3"取值与安全性质无关"论证
  是否冲突）改写为"已裁定"，引用依据是**ledger 1195**："权威是1122+1122-补……NWT认可的判据是'victim无处
  可藏'这条安全性质，不是具体数字；`a036641c`已对v0.3§3这条论证给出GREEN……`4b39c801`precondition(c)的
  字面表述被这条更晚的裁定取代——`MAX_INS_SCAN=8`在安全性质上成立"——**这段引用跟本会话此前（`91759502`
  那次审查）我自己确认并追加状态注记的内容逐字一致**，不是凭空转述。
- 新增第6项开放项："界=8是否会拒绝真实场景下的合法交易（活性问题非安全问题）……本次尚未做"——**这正是
  §一第1.6节我刚独立核实过的那份活性表格的"预告"**：`c8153301`先如实标注"尚未做"，后续（在这份文档更晚
  的commit里，即本次review读到的195-220行那份表）才把结果填上——**文档演进的时间顺序合理，没有跳步或
  倒填证据**。

**纯文档、无代码风险，内容跟本会话已独立核实的事实链逐字对得上，GREEN。**

## 四、给Bettor的处置建议

- **`9ff095a3`按Codex 1198强制清单逐条独立复现，10/10 PASS，无遗漏项，MUST-FIX修法验收通过**。
- 共享tx JSON方法论本身经deep-equality独立验证为真实代表一笔交易，这套跨合约集成测试法可以作为以后
  同类"两个合约手接口"场景的标准复现方式沿用。
- mass更正与MAX_INS_SCAN活性核对文档均独立确认准确，新代币化参数无真实调用方这条限制已被如实披露，
  不需要额外补充。
- `cf2bdd0b`/`c8153301`两笔文档补记均GREEN，数字与措辞跟本会话独立复现的事实一致。
- **本次review全程无新发现问题，可以按1199结尾所说，请Codex解T3集成HOLD**。
- `scratch/_nwt_handoff_fix`worktree已按Rule 81清理（junction检查确认本worktree 0命中后
  `git worktree remove --force`，本次未出现"Permission denied"残留，未产生orphan目录）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
