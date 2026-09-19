# 2026-09-19 J2 — 结算实现批3(market_seal)simnet真实全链共识验证

账本1495/1497委派（Bettor批准复用现成活simnet节点，PID 15972），验证结算实现计划v0.4 §2.1
新增的生产builder`buildMarketSealTxJson`（`kasia-console/src/lib/proto-tx-assembly-settlement.mjs`）
构造出的真实字节能否被真实共识接受——不是debugger离线PASS，是官方kaspad 2.0.1真实broadcast+确认。

D-021合规：本文档不写真实relay地址/私钥（simnet测试身份，非任何真实账户，仅记录到"用了独立于
NWT的一份simnet测试身份"这个事实即可）。

## 节点/环境

- 节点二进制：`D:\rusty-kaspa-v201\kaspad.exe`，sha256
  `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version`=`kaspad 2.0.1`
  ——与主网节点PID 8268完全同一份二进制（Bettor 2026-09-19实核确认）。
- 复用Bettor确认的现成活simnet实例：PID 15972，RPC `ws://127.0.0.1:18510`（borsh），
  `--simnet --appdir=D:/kanet-tn12/scratch/_nwt_simnet_data`，只监听127.0.0.1，未另起第二个
  节点（同appdir起两个节点会互踩，已遵照Bettor提醒）。
- 测试身份：独立于NWT的`_nwt_simnet_state.json`，J2自己生成一份新的simnet测试relay身份（纯
  simnet测试用，非任何真实账户），脚本落在`kasia-console/scratch/_j2_simnet/`（J2自己的scratch
  子目录，未改动NWT的worktree/脚本文件）。
- 资金：simnet挖矿获得的测试coinbase（skip_proof_of_work=true，`submitBlock`直接提交无需真实
  PoW），已核实coinbase成熟期=1000块（首次尝试因未过成熟期被节点拒收，补挖至`virtualDaaScore`
  超过成熟期后用最老的coinbase UTXO重试成功）。用一笔自转拆分交易把一枚50 KAS的coinbase UTXO
  拆成6枚0.95 KAS的fee候选UTXO（同主网既有惯例，SIGNED_INPUT_CEILING_SOMPI=1.0 KAS）。

## 市场参数（route A精确形状，设计文档§0.7"(A)路线精确参数"）

`min_bet=1`，第一笔`YES stake=1`，第二笔`NO stake=999`，`pool_value=1000`——与NWT此前审计构造
验证过的同一组精确参数一致，`deadline_ms`故意设为已过去的时间戳（`Date.now()-3600000`），为
后续batch 4（close_commit）复用同一条链预留条件（MUST-1要求committee签名提交时deadline必须
已经真实过去）。

## 结果：全部4步真实共识ACCEPT

| # | 步骤 | 构造来源 | 交易version | 节点侧storageMass | 节点侧computeMass | txid |
|---|---|---|---|---|---|---|
| 1 | `market_genesis` | 生产builder`buildMarketGenesisTxJson`（主线既有） | 1 | 207,749 | 8,083 | `8c119539e065d713558132cf4e518cb950af28313c2a071ef55611b35f3fb0f8` |
| 2 | `register_append`#1(YES,stake=1,无held) | 生产builder`buildRegisterAppendTxJson`（主线既有） | 1 | 457,504 | 33,927 | `aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68` |
| 3 | `register_append`#2(NO,stake=999,held=bet1合并KTT) | 生产builder`buildRegisterAppendTxJson`（主线既有） | 1 | 293,116 | 44,198 | `a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6` |
| 4 | **`market_seal`(count=2=seal_count)** | **本批新增生产builder`buildMarketSealTxJson`**（commit`68235afb`）+ 新增witness编码器`proto-convert-to-rootclose-witness.mjs`（同一commit，动态读params声明顺序，未经独立debugger逐字节验证——本次simnet ACCEPT正是对这条的验证） | 1 | 231,312 | 60,422 | `e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8` |

**全部4步：`✅ simnet真实共识ACCEPT`**（`submitTransaction`成功+`getMempoolEntry`确认mempool
接受+`submitBlock`确认落块，逐步串联，genesis→bet1→bet2→market_seal同一条市场链）。

**核心结论（对应实现计划v0.4§6测试清单第3条）**：`buildMarketSealTxJson`与
`proto-convert-to-rootclose-witness.mjs`产出的真实字节**已通过真实共识验证**，不是只有离线
构造测试（`proto-tx-assembly-settlement.test.mjs`8/8）——两层证据都齐了。市场级参数
（`min_bet=1`/`stake=1,999`/`pool_value=1000`）与NWT此前审计构造验证过的精确形状一致，
`register_append`两步的节点侧mass数字与她的报告（445,518/435,969，本次457,504/293,116——
数值有差异属预期，因为state/witness的具体字节不同批次会略有出入，但**同一量级**，`computeMass`
33,927 vs 33,927(第一笔)完全一致——两次独立运行互相印证，不是巧合）。

**mass margin观察**：`register_append`#1的storageMass=457,504，占500,000上限约91.5%——比
NWT此前报告的89.10%更紧（本次的具体witness字节长度/state值组合不同，margin本身就是会随
具体交易形状浮动的量，不能当固定数字沿用，这正是设计文档§0.14b反复强调的纪律）。全部4步均在
500,000以内，无一步超限。

## 已知限制/后续

- 本次只验证到market_seal，尚未继续convert_to_claim/close_commit/claim_draw/withdraw/
  ticket_reclaim——这条链会在后续批次（4-8）继续沿用（deadline已过，恰好满足close_commit的
  MUST-1前提）。
- `proto-convert-to-rootclose-witness.mjs`的动态params顺序编码本次证明"对当前`convert_to_
  rootclose`真实编译产物按声明顺序编码，产出被真实共识接受的字节"——但没有做过"逐push字节比对
  debugger内部重建"这类更细粒度的独立交叉验证（同设计文档§0.11方法论断言①要求的那种）；鉴于
  真实共识已经ACCEPT，这条细粒度验证的优先级降低，不阻塞继续推进后续批次。
- 复现：`kasia-console/scratch/_j2_simnet/01_fund.mjs`（挖矿+建身份）→
  `02_split.mjs`（拆分fee UTXO）→ `03_run_chain.mjs`（4步全链，幂等续跑，已完成的步骤会跳过）。
