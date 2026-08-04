# Broker 变更类端点缺调用者身份验证 — 设计一页（送审）

> **Status**: CURRENT
> **作者**: KANet-UI  **日期**: 2026-08-04
> **派工**: Bettor 08:29（盘点顺带查出的真洞立卡，broker 域归 KANet-UI）
> **流程**: 本文冻结 → NWT 红队 → Bettor 批 → 才落码（用户面 + 身份面，铁律 0）
> **本文阶段：零代码改动。**

---

## 一、问题精确定位（不是"要不要签名挑战"）

`docs/2026-07-26-broker-onboard-identity-design.md` v0.5 砍掉的"整套挑战-签名方案"，作用域是**初始注册**——Owner 三条否决理由（无利可图/不分级/链上的钱已经在证明身份）在那个场景里全部成立，**本文不推翻**。

本文覆盖的是另一类、7/26 没有分析过的动作：**变更类端点**。这两类动作的威胁模型正相反：

| | 初始注册 | 变更类 |
|---|---|---|
| 花钱吗 | 否，但佣金**之后**只付真持有人 | 否，且**不产生任何后续链上痕迹** |
| 冒名者得利吗 | 否（无利可图，Owner 已证） | **是**（能损害竞争对手/骚扰） |
| 时机 | 拿到佣金之前的一次性动作 | 随时可重复发生 |

## 二、现状（只读实读，file:line）

【实读 `kasia-console/src/api/kanet-broker.js`】

### ① `POST /onboard` 重新提交（upsert 覆盖路径，:73-87）
```
:73  existing = SELECT id FROM broker_onboarding WHERE broker_address = ?
:78  if (hasToken) UPDATE ... SET bot_token_encrypted=?, bot_username=?, ... WHERE broker_address=?
```
**零验证**：任何人 POST 一个已存在的 `broker_address` + 自己的 `bot_token`，即可覆盖该地址原有的 bot 绑定。已有保护（:74-83 注释）只挡"不带 token 的重复提交会抹掉已有 token"这一种情形，**不挡"带新 token 的恶意覆盖"**。

### ② `POST /bots/stop`（:429-433）
```js
const addr = request.body?.broker_address;
if (!addr) return reply.code(400).send({ ok: false, error: 'broker_address required' });
return reply.send(stopBrokerBot(addr));
```
**零验证**：body 只要 `broker_address`（公开信息，链上可见），任何人可停任意 broker 的 bot。

### 两条路径共同点
不消费任何证明"调用者控制该地址私钥"的字段；`broker_address` 本身是公开的（onboarding 列表、市场页、链上交易输出地址均可见）。

## 三、方案：复用已验证的签名基础设施，不重新发明

`kasia-console/src/lib/coord-status-sign.mjs` 已经是**生产验证过**（D-010 落地①，coord-status 频道信任根）的内容签名/验签模式：`computeContentHashHex()` + kaspa-wasm `verifyMessage`/`signMessage`（底层 schnorr）。`pool-refund-reject-sign.mjs`（r402）是第二个复用实例，注释明确写"aligned with the D-010 coord-status signing gate...has been through adversarial forgery testing in production"。

**本设计不新造验签机制，复用这一套**，只定义 broker 场景专属的 payload 形状。

### 3.1 待签 payload（复用 v0.5 归档保留的字段设计，Owner 当时说"论证正确，归档取用"）

```json
{
  "purpose": "broker_variant_action",
  "network": "testnet-12",
  "broker_address": "kaspatest:q...",
  "action": "update_bot_token" | "stop_bot",
  "nonce": "<random>",
  "expires_at": "<ISO8601, 建议 5 分钟窗口>"
}
```
- `purpose` + `network`：域分离（同 v0.5 §四"待签字节必须含 network"的教训——防跨用途/跨部署重放）。
- `action`：**必须**在 payload 内，不是 URL 路径参数——否则签一份能被用在另一个 action 上（同 P1 attestation 冻结前置①"太小可重放"同族坑）。
- `nonce` + `expires_at`：防重放。`expires_at` 只约束"这次提交必须在窗口内"，不是控制权证明本身的有效期（v0.5 §四已提醒这一点，不重复犯）。

### 3.2 验证流程

1. 从 `broker_address` 派生 x-only 公钥：复用现成 `kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address))`（已有两处调用范例：`bettor-refund-claim-auto.mjs:30`、`prediction-agent-mind.mjs:113`）。
2. 🔴 **P2SH 陷阱（v0.5 §四实测过，必须继承）**：`XOnlyPublicKey.fromAddress()` 对 P2SH 地址**不抛错**，会返回脚本哈希当公钥，验签会得到一个看似合法但语义错误的结果。**必须先显式判断地址 version 是 PubKey 类型才继续**，不是"验签失败就说明不支持"。
3. 用 `verifyMessage`（同 `coord-status-sign.mjs` 模式）验证签名覆盖 `computeContentHashHex(JSON.stringify(payload))`。
4. 校验 `payload.action` 与实际请求的 action 一致、`payload.broker_address` 与请求的地址一致、`expires_at` 未过期、`nonce` 未被使用过（防重放，需要一张小表或复用现有防重放模式——待落码时定，本文不展开 schema）。
5. 任一步失败 → fail-closed 拒绝，不静默放行、不部分生效。

### 3.3 落地位置

- `POST /onboard`：仅当**该地址已存在且本次带 `bot_token`**（即"覆盖"语义触发时）才要求签名；全新地址的首次注册**不要求**（§一已论证：初始注册不在本设计范围，维持 Owner 7/26 裁定的无门槛）。
- `POST /bots/stop`：**始终要求**签名（这个动作没有"首次/非首次"的区分，任何一次调用都是变更）。

## 四、不做的事 / 边界

- ❌ **不动初始注册的门槛** —— 那是已裁定、已实现、7/26-28 已落码的部分，本设计不碰。
- ❌ **不做权限分级** —— 同 v0.5 §四 Owner 裁定，签名只是自证机制，不筛选谁能注册；本设计只是把"自证"从"注册时"挪到"变更时"，性质不变。
- ❌ **不覆盖 `bots/reconcile`** —— 08:26 盘点已标注"拿不准"（无参数、疑似系统级 tick 而非 broker 自助动作），需要先确认调用方是谁，本文不预判，留给 NWT 红队时一并确认或另立卡。
- ⚠️ **今天不可达**（console 绑 loopback + Track A 下唯一 broker 是 Owner 自己）——**这不改变要不要设计**（同 Bettor 判据："今天不可达"是拓扑给的不是设计给的，Track B 开放当天它就在攻击面上），但**改变落码的紧急度**：本设计可以按正常节奏走完整红队，不需要今天赶工。

## 五、验收判据（落码后逐条实测，不靠读码）

```
① 不带签名 stop 任意 bot ⇒ 拒绝
   对照臂：带该地址私钥签的正确 payload ⇒ 成功
② 带别人地址的签名去 stop 自己的 bot（签名 broker_address 与目标 broker_address 不一致）⇒ 拒绝
③ 签名过期（expires_at 已过）⇒ 拒绝；对照臂：窗口内 ⇒ 成功
④ 同一签名重放第二次（同 nonce）⇒ 拒绝；对照臂：换 nonce 重签 ⇒ 成功
⑤ 用 P2SH 地址尝试（如果该地址曾以某种方式进了 broker_onboarding）⇒ 必须在验签前被拒绝，不是验签失败后才发现
⑥ 不带 token 的 onboard 重新提交（幂等更新场景）⇒ 仍不要求签名（验证本设计没有误伤既有的"无 token 更新 updated_at"路径）
⑦ 全新地址首次 onboard（无论带不带 token）⇒ 仍不要求签名（验证首次注册门槛未被本设计意外收紧）
```

## 六、我填不了的格

- 防重放的 nonce 存储 schema（表/字段/清理策略）——落码时定，不在设计阶段占坑。
- 前端 UI 侧"怎么让 broker 生成这个签名"的具体交互（需要浏览器端签名能力或类似 Kasia 钱包插件的东西）——这是产品面决策，我不自拟；如果 Track B 的 broker 是脚本化的 fork 部署者而非浏览器用户，这一格可能根本不需要 UI。
