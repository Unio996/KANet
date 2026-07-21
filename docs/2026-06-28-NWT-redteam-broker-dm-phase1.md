# NWT 红队审核 — broker 收益 DM Phase 1 (72596c74)

**作者**: NWT · **日期**: 2026-06-28 · **审对象**: 72596c74 broker DM Phase1 + 首页赛事聚合卡
**触发**: Bettor 派工 — 审攻击面 / 承重 / verify-value-source / 可行性
**结论**: **PUSH-BACK** — 1 个 BLOCKING 必修后才能 live-test DM；1 个 CONDITIONAL PASS (testnet 可过·production 必修)

---

## 攻击面

### ✅ broker_fee_landed 唯一写入方

J2 确认 + NWT 代码验：`event_type='broker_fee_landed'` 全库仅 `brokerFeeLandedEmitTick` 一处 INSERT (broker-fee-emit.mjs L113)。
无其他 API / path 能写该 event_type。**PASS**。

### ✅ fee_sompi 来源 — 链验金额非 DB 估

```js
const feeSompi = Number(outs[idx].amount_sompi || 0);  // kaspa_tx_log.outputs_json
```

emit 侧从 `kaspa_tx_log.outputs_json` 按 broker 地址匹配输出金额，非预估。
DM endpoint 的 `p.fee_sompi` 读自该 payload，chain-derived。**PASS，符合 Bettor 设计铁律。**

### ✅ broker_pk → address 派生正确

`deriveBrokerAddress(pool_markets.broker_pk, network)` — broker_pk 在 create-v07 时 assertBrokerP2PK 烤死，非 emit 时 caller 输入。派生路径与 settle TX 同源 (XOnlyPublicKey)，地址一致，不可由 caller 伪造。**PASS**。

### ✅ J1 round-trip 关注 — to_address == 收款人

`to_address = brokerAddress` (broker_pk 派生) → money 落同地址 → JOIN 取 tg_user_id → DM 通知同一人。收款人 == 被通知人，无跨人泄露。**PASS**。

### ⚠️ J2 残留 — 恶意 create 把 broker_pk 设成他人托管地址

攻击场景：攻击者创建市场，broker_pk = 受害者的托管钱包地址。  
实际后果：fee 落受害者地址（受害者获益），DM 到受害者 tg（"你经手的市场 X 结算"，受害者困惑）。  
**判定**: 非财务攻击（攻击者损失 fee，受害者获币），属骚扰/垃圾 DM。市场创建本身未做身份验证，这是 create 层的先决问题，非 DM 层问题。Phase 1 可接受，Phase 2 broker onboarding 门槛天然堵死。**PASS (Phase 1)。**

---

## 承重 — 地址映射准确性

### ✅ tg_custodial_wallets JOIN 是唯一已知映射

Phase 1 scope 诚实：只覆盖"托管/link 地址的 broker"。demo 场景 Owner 托管地址 = 市场 broker_address，JOIN 有结果。承重在 Phase 1 scope 内正确。**PASS**。

---

## verify-value-source

### ✅ fee_sompi

来源：kaspa_tx_log.outputs_json → 由 Scout indexer 写入 → 不可由 emit 时 caller 篡改。**PASS**。

### ✅ broker_address

来源：pool_markets.broker_pk(create 时烤死) → deriveBrokerAddress → 不可由 emit 时 caller 篡改。**PASS**。

---

## 可行性 — 代码路径审查

### 🔴 B1 BLOCKING — sendMessage 静默失败 + 游标无条件前进 = DM 永久丢失

```js
// bot.mjs pollBrokerFeeEvents()
for (const ev of evs) {
  const msg = M.brokerFeeDmText(ev);
  try { await bot.api.sendMessage(ev.tg_user_id, msg); } catch {}  // ← 静默吞掉
}
if (evs.length) {
  const last = evs[evs.length - 1].observed_at;
  if (last) PM.setBrokerFeeTs(new Date(last).getTime() + 1);      // ← 无条件前进
}
```

**攻击链**: sendMessage 抛异常（tg_user_id 无效 / bot 被 block / 网络超时）→ catch {} 无日志 → 游标仍前进 → broker_fee_landed 事件被"消费"但 DM 永不到达，下次 tick 跳过该事件。

**demo 直接风险**: 若 Owner 的 tg_user_id 在 DB 中有任何问题（类型错误、未注册 bot），demo 静默失败，无任何诊断信息，无法区分"DM 发出但用户没注意"和"发送失败"。

**最小修复**:
```js
for (const ev of evs) {
  const msg = M.brokerFeeDmText(ev);
  try {
    await bot.api.sendMessage(ev.tg_user_id, msg);
    PM.setBrokerFeeTs(new Date(ev.observed_at).getTime() + 1);  // 只在成功后前进
  } catch(e) {
    console.warn(`[broker-DM] sendMessage fail uid=${ev.tg_user_id} fee=${ev.fee_sompi}: ${e.message}`);
    break;  // 停住游标·下次 tick 重试
  }
}
```
或更简：至少 `catch(e) { console.error(...) }` + 游标不前进，下次 tick 重试同一批。

**VERDICT: BLOCKING。此 bug 必修才能 live-test DM。**

### ⚠️ P1 CONDITIONAL — /api/pool/broker-fee-dm 无 auth

```js
fastify.get('/api/pool/broker-fee-dm', async (request, reply) => {  // 无 verifyIngestRequest
  // 返回: tg_user_id ↔ kaspa_address + fee_sompi + market_id + settle_txid
```

**缓解**: console 默认绑 127.0.0.1 (`HOST || '127.0.0.1'`，index.js L441)，localhost-only → 外部无法直接调。  
**testnet 判定**: 可接受。  
**production 必修**: 若 HOST=0.0.0.0（反向代理），该端点暴露 PII (tg_user_id↔地址映射 + 收益金额)。修法：加 verifyIngestRequest（同其他 bot 内部端点模式，chain-data.js L124）。

---

## UX GAPS (不阻 demo)

### ⚠️ M1 — sportsCardBlock 缺复制说明

trending block 有 `'按下方按钮复制深链 → 直接押注 · /hot 完整榜'` 引导文案。  
sportsCardBlock 无对应说明 → 用户不知道"按钮是复制操作"。建议 sportsBlock 加一行说明。

### ⚠️ L1 — DM 文案缺累计汇总

设计稿: `本笔 +<fee> KAS · 累计 <total> KAS / <n> 单`  
实现: `本笔 +${feeKas} KAS`，无累计。  
不影响 demo 功能，Phase 2 补即可。

---

## PASS 汇总

| 检查项 | 结论 |
|--------|------|
| fee_sompi 来源 chain-verified | ✅ PASS |
| broker_pk→address 派生同源 | ✅ PASS |
| 唯一写入方 (broker_fee_landed) | ✅ PASS |
| 去重: INSERT OR IGNORE + metadata stamp | ✅ PASS |
| Backfill-suppress restart-safe | ✅ PASS |
| Round-trip to_address == 收款人 | ✅ PASS |
| 恶意 create 残留 (Phase 1 可接受) | ✅ PASS |

---

## 结论与派工

**PUSH-BACK**。修 B1 后重提，NWT 快速复核。

| # | 严重 | 找谁修 | 内容 |
|---|------|--------|------|
| B1 | BLOCKING | KANet-UI | pollBrokerFeeEvents: catch(e) log + 只在成功后前进游标 (或 break 重试) |
| P1 | CONDITIONAL | KANet-UI | /api/pool/broker-fee-dm 加 verifyIngestRequest (生产前必修) |
| M1 | MEDIUM | KANet-UI | sportsCardBlock 加 copy 引导文案 |
| L1 | LOW | KANet-UI | DM 文案补累计 KAS / n 单 |

**B1 修完 → NWT 复核 → 通过 → KANet-UI live-test DM → Bettor 链验 fee+DM LAND。**
