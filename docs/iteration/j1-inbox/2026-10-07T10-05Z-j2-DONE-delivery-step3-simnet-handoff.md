# J2 → Bettor：交付步 3（simnet）交件 — 分支 `coord/j2-delivery-impl-step3-20261007`（HEAD 5776362e）

**结论**：步 3 内容全部落地，simnet 全链路 PASS（证据 `docs/provenance/2026-10-07-j2-delivery-step3/step3_simnet_e2e_result.json` + `step3_simnet_e2e.mjs`）。只 simnet，无主网花费、无部署、无 env 变更；simnet 已拆，主网 kaspad 4752 / console 23808 拆后核实仍在。

## 复用了什么（第一原则）
CommissionSplit 合约（零改动；核实 `payer_refund_spk` 接受任意 P2PK）、commission-plan-sdk（报价/建 split/退款）、既有 resolve-order-browser / fee-split / broadcast-commission 买家侧构造、relay `check_utxo_landed`（落链深度）、`get_address_utxos`、步 1/2 的 delivery-crypto / mailbox / store / watcher。

## 交付内容
1. relay 窄命令 `delivery_split_submit`：收**组件**（input / 零签名 sigScript / outputs / redeem / expected_txid），relay 本地按订单 ctor 重建输出并核对输入 UTXO；无任意广播口。6 条变异全红。
2. console split 适配器（`delivery-split-adapter.mjs`，地址相等 fail-closed）；api.kaspa.org 读后端适配器（注入 fetch，fail-closed；已对公网只读实测）。
3. watcher 接 `index.js`，默认关（`DELIVERY_WATCHER_ENABLED==='1'` 才跑，另需 `DELIVERY_RELAY_ID`）。
4. 发票模式：`POST /api/delivery/orders` 带 `quote` 即可建单（退款地址 = 秘密派生 P2PK，订单地址完全算出，state=watching）；migrate **v223**（`delivery_orders.quote_json`），DATABASE.md 同批更新。
5. 买家页（`delivery.html/js`，占位文案）：读链解密、粘贴密文、到期退款、凭据清扫；断言 b（真 Chromium 拦截全部请求，零秘密）已落地。
6. 勘误 `docs/2026-10-07-j2-digital-goods-delivery-design-v0.4-errata.md`：秘密允许/禁止位置清单、合约 nonce 分离、充值口径、凭据救援流程核查（结论：凭据 kind ≠ order-receipt，`parseOrderReceipt` 抛"凭据类型不符"；checkout.js 凭据处理无任何网络发送；已加单测）。

## simnet 全链路实测（真 split、真信箱、真读链）
- A 单：建单 → 付款 → watcher 真 split 落链 → 真信箱 → delivered；买家页仅凭链接读链解密，明文一致；**链上 split 的 sigScript(含 redeem) 无秘密窗口，含派生合约 nonce**；买家清扫信箱到自己地址（+0.198 KAS）。
- B 单：到期后买家页触发零签名 refund → 退款 P2PK（301.9M sompi）→ 清扫到买家地址（净得 301.74M / 总 303M）。
- 早于到期的退款尝试被拒。

## 本步实测发现的问题（已修）
- 🔴 **充值口径**：只付角色合计 ⇒ split 手续费 0 被 mempool 拒。应付 = 角色合计 + `max_split_fee`（已改商家侧/买家侧/测试；v0.4 E3）。报价里的 `max_split_fee_sompi` 应按实测下限（compute mass 9,728 ⇒ 972,800 sompi）留余量，不要 0.4 KAS 那么大。
- 🔴 合约 order_nonce 公开上链 ⇒ 已与秘密分离（上一轮已汇报）。
- simnet 的 pastMedianTime 落后墙钟约 7 分钟，退款以 PMT 为准（只影响测试节奏；主网 PMT 滞后很小，但买家页文案应告知"到期后可能需等几分钟"）。

## 需要你处理 / 决定
1. **M0a manifest**：watcher 要注入 `sendCommandAsync`，而 index.js 对 relay-manager 的那次 import 是新增裸 import，被 R-M0A-BARE-IMPORT-DIFF 拦。我没有自编 review_ref。当前 index.js 只调 `startDeliveryWatcherCron(process.env, {})`，未注入 ⇒ 拒启动 ⇒ 对运行时零影响；要真启用需你/NWT 出 manifest 条目后我补 import 与注入一行。
2. **买家页文案**：全部占位，集中在 `kasia-console/src/lib/checkout-static/delivery-copy.js`（一张表，批准后只改此文件）。红线已体现：凭据含秘密、等同取货与退款钥匙，只存本机、不发任何人。请你整理送 Owner 批。
3. **步 4**（主网 ≤2 KAS、仅自有地址）等你单点 GO。
4. 已知未覆盖：买家页壳只在 Chromium + 拦截网络下跑过；读后端仅 api.kaspa.org 一家（单点依赖，已有"粘贴密文"兜底）。

## 新增面清单
无新入站端口；relay 新命令 `delivery_split_submit`、`delivery_mailbox_send`；env `DELIVERY_WATCHER_ENABLED` / `DELIVERY_RELAY_ID` / `DELIVERY_TICK_MS` / `ADMIN_SECRET_DELIVERY`；migrate v222/v223。
