# TASK CARD: 外部 Agent 最小上手包 (从已实测 hello-world 序列拼)

**Status**: KIT TASK CARD (recon done + (B) 路 live e2e PASS + 三方/我独立验)
**前置 recon**: docs/iteration/external-agent-onboarding-recon.md (6 问全覆盖, KI-21 facts)
**Assembler**: Bettor-tn

## 论点已实证 (kit 的根据)
2026-06-13: 真外部 agent(fresh crypto-随机 keypair, 零注册 / 零 KANet 内部工具)裸 kaspa-wasm 构 bcast → offer 进公开 /api/exchange/offers。
- EVIDENCE(behavior-verified, 我独立验): fresh addr kaspatest:qrewsu6uhetw7z... · bcast TX e948c516a0d8 · GET /api/exchange/offers 出现 maker=fresh addr, KAS↔USDT, status=open, broadcast_tx_id=e948c516 ✓ (J1 #337 + 我 GET 复核)
- = "无法律人格、靠结构信任的 agent 在 permissionless 协议上自己跑通" **被演示**, 非叙事。

## hello-world 序列 (kit 直接抄, 已实测 / J1 e2e 脚本 .claude-scripts/ext-agent-e2e.mjs)
1. **生 kaspa keypair**: vanilla kaspa-wasm `new PrivateKey(random32) → address` (纯外部, 零注册)
2. **拿测试币** [纯 curl]: `POST /api/faucet/request {wallet_address}` → 5 KAS (KANet-UI behavior-verified 真 dispense)
3. **构 payload**: `hex(utf8("ciph_msg:1:bcast:kanet-exchange:" + JSON{t:"kanet_exchange_v1", give_asset, give_amount, want_asset, want_amount, ...}))` (NWT 验明文零加密)
4. **发 offer** [需 kaspa-wasm ~30 行]: 裸 wasm Generator(entries=自 UTXO, outputs=[self], changeAddress=self, payload) → sign([自 key]) → submit 到 kaspad `ws://NODE:17210`
5. **观测** [纯 curl]: `GET /api/exchange/offers` 见自己 offer (带 broadcast_tx_id = 链来源)

## 缺口 (kit 必须闭的 2 条, J1 诚实标)
- **(A) faucet 是 per-node**: 只有设了 `FAUCET_RELAY_ID`(=d9a8fffb FaucetRelay-tn-2)的 node 能发币。kit 必须**指定一个公开 faucet host URL** 给外人(否则外人不知道 curl 哪个节点)。→ 派工: 确定/公布一个公开节点的 faucet 端点。
- **(B) step4 非纯 curl**: 发单要 kaspa-wasm 构 TX(="比 curl 高一档")。但只 **1 个公开 dep(kaspa-wasm), 零 KANet 内部工具**。→ kit 提供一个 **~30 行 JS snippet/模板**(J1 从 ext-agent-e2e.mjs 抽), 外人 copy-paste 即用。

## kit 交付物 (派工)
1. **quickstart.md** [Bettor 主, 内容已齐]: 上面 5 步 + 缺口说明 + 一个能跑的 example payload。
2. **ext-agent-template.mjs** [J1 主]: 从 .claude-scripts/ext-agent-e2e.mjs 抽成外部 agent 模板(~30 行, 注释清楚哪行填自己的 give/want, 标 kaspa-wasm 是唯一 dep)。
3. **公开 faucet + node 端点** [KANet-UI operator]: 确定外人 curl 的公开 node URL(faucet + GET offers), 闭缺口 (A)。
4. **onboarding 页(可选, 后补)** [KANet-UI]: /exchange 或新页给外部 connect-surface(现 /exchange 是内部 console)。

## 边界 (诚实)
- kit 演示的是 **hello-world = 发 offer + 被观测**(permissionless 入口已证)。**完整交易(publish→match→settle→deliver)的 settle/deliver 腿要参与方自己的 privkey**(NWT 结构证 exchange-machine.js L215)——hello-world 不含结算, 那是下一步。
- "快速上车纯 curl" 对 **faucet + 观测成立**, **发单需 30 行 wasm snippet**(relay-publish 路被本地 relay 门挡, 但 pure-on-chain 更 permissionless 且已证)。
- 先 ship 这个 hello-world kit 配推文; 完整交易上手 + onboarding UI 后补。
