# NWT 红队 — faucet per-IP 修(05a0a6c2)verify-value-source 违反

> reviewer=NWT(线 3 TG 钱包/faucet)。Bettor 落码时自标「审核盲点我负责」邀红队 → 本 finding。
> 接位重整后第一份交付。诚实口径:测试网 faucet,损失=drain/DoS demo,**非真钱**。

## FINDING-1 (MEDIUM) — `isTrustedProxy` 凭 header **存在** 判信任,不验 secret **值** → per-IP 防线 forgeable-vacuous

**位置**:`kasia-console/src/api/chat.js:628`
```js
const isTrustedProxy = !!request.headers['x-ingest-secret'];  // bot 带, 公网浏览器不带
if (!isTrustedProxy) { /* per-IP 24h≤3 check */ }
```

**根因(verify-value-source 域)**:`isTrustedProxy` 是信任决策,但它读的是 **caller 完全可控的输入**(header 的存在性),从不拿这个值跟真正的绑定(`ingest_secret`,经 `timingSafeEqual`)比对。`!!request.headers[...]` 只判 truthy,任意非空值都过。

**攻击(单变量,公网路径)**:
1. 公网攻击者对 `POST /api/faucet/request` 加一行 header `x-ingest-secret: anything`(curl 一行,header 名在仓库里可发现)。
2. `isTrustedProxy` = `!!'anything'` = **true** → 跳过 per-IP「24h≤3」分支(L629-633)。
3. per-IP 防线对该攻击者**完全失效**。剩余防护:per-wallet 永久-once(对新生成地址无用,攻击者每次换 fresh kaspatest 地址)+ 全局日帽(`GLOBAL_DAILY_CAP` 默认 50)。
4. ∴ 注释 L627「per-IP 仅对公网网页 faucet 保留」**不成立**——任何会发 header 的公网客户端即绕过。真正兜底只剩全局日帽 50/日。`FAUCET_AMOUNT_KAS=10000` 时 = 500k testnet KAS/日可被单个匿名攻击者抽干(fresh 地址),全局日帽满后**诚实新用户当日被锁在零门槛门外**(= 正是这次修想救的 broken)。

**为何是 vacuous-teeth 类**:happy-path(诚实 bot 带真 secret / 诚实浏览器不带)行为看着对 → 容易签;但 attack-path(攻击浏览器带假 secret)绕过零阻力 → 防线 always-pass-on-forged-input。判别标准:gold = 攻击者带假 `x-ingest-secret` 仍被当 untrusted、仍受 per-IP 挡。

**对比仓库既有正解**:同文件 L4 已 `import { verifyIngestRequest }`,L398 `/api/chat/ingest` 用 preHandler 走 `timingSafeEqual(secret, ingest_secret)`。faucet 没用值比对,是这次新增码的盲点(presence-only)。这跟 Bettor 自己在 62b91bd7 修的「BLOCKING 提款洞=tg_user_id 取自 URL≠鉴权」同一族:**forgeable caller-input 当鉴权**。

## 建议修(一行级,reviewer 建议,落码归 owner=Bettor/KANet-UI)
不要在 handler 里调 `verifyIngestRequest`(它直接 `reply.send` 401,faucet 要的是**软分支**:有效 secret→豁免 per-IP,无效/无→走公网 per-IP,**不该 401 拒**公网用户)。提取一个**返回布尔、不碰 reply** 的校验:

```js
// ingest-auth.js 加:
import { timingSafeEqual } from 'crypto';
import { getConfig } from '../data/settings/configs.js';
let _secret = null;
export async function isValidIngestSecret(request) {
  const secret = request.headers['x-ingest-secret'];
  if (!secret) return false;
  if (!_secret) _secret = await getConfig('ingest_secret');
  if (!_secret) return false;
  try {
    const a = Buffer.from(secret), b = Buffer.from(_secret);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
```
```js
// chat.js:628 改:
const isTrustedProxy = await isValidIngestSecret(request);  // 验值, 非验存在
```
影响面:诚实 bot 已带**真** `x-ingest-secret`(console-api.mjs)→ 仍豁免,零回归;公网浏览器(无 secret 或假 secret)→ 仍受 per-IP,符合设计原意。lint/smoke 后随同 console 重启一并生效(KANet-UI 正在重启 → 可同批,免二次重启)。

## 验收门(NWT 关3,修后我复验)
- happy: 诚实 bot 带真 secret faucet → 豁免 per-IP,faucet 到账。
- attack: curl `-H 'x-ingest-secret: junk'` 连发 4 次同 IP fresh 地址 → 第 4 次 **429 per-IP**(非放行)。
- 回归: 真 bot 多 TG 用户连续 faucet 不被 per-IP 误挡(原 broken 仍修好)。

---
*NWT · 2026-06-23 · 接位重整后首交付 · 频道发不出时本 doc = 唯一交付(durable mode)*
