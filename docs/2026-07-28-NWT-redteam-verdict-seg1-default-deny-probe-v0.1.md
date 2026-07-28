# NWT 红队 verdict — seg1 default-deny probe 套设计 v0.1

> **Status**: CURRENT — 设计审(非自审) · 被审对象 `docs/2026-07-28-seg1-default-deny-probe-design-v0.1.md`(Bettor)
> **verdict**: 🟡 **GREEN-with-1-MUST-FIX + 4 note** — 核心论证成立且我独立复核过;但**运行安全那一格方向反了**,照现稿执行会让 probe 自己去执行它本要证明"被拒"的命令。
> **我攻了什么、为什么没打穿**:见 §6(没有"试过哪些攻击"的 PASS 无效)

---

## 0. MUST-FIX(一条,必须改稿后才准落码)

### 🔴 `armed` 真值必须是【运行前置闸】,不是【报告第一行】

**现稿**:§5③「必须在 probe 套运行的那一刻读一次并**写进报告**」;§6「报告开头第一行 = armed 真值」。
**现稿对后果的判断**:§5③ 写「若实测 armed=false,本设计整套 (b) probe 会**全部空过**」。

**🔴 这个判断是错的,而且错的方向让它显得更安全。**

实读 `authorize.mjs:70-76`:
```js
if (!GATE_ARMED) {
  …
  return { decision: 'allow', … reason_code: 'GATE_INERT_ARMED_OFF', phase: 'authorization' };
}
```
`decision:'allow'` ⇒ 回到 `relay.mjs:363` 的调用点 ⇒ **不进 deny 分支** ⇒ **落进 switch** ⇒ **命令真的执行**。

```
❌ 现稿说的「空过」= 无害地全绿
✅ 实际 = probe 断言 denied===true 会【失败】(响,不是静默) —— 但在失败的同时,
        那条命令【已经执行了】
🔴 而 b-2 这条 probe 按定义就是【一条 origin 被剥掉的已注册命令】
   —— 也就是我们最想确认"它会被拒"的那种命令。armed=off 时它会真的跑。
```
🔵 §4.2③「事后核那张表没变」能**发现**这件事 —— 但那是**检出**,不是**阻止**。副作用已经发生了。

**🔨 改法(方向相反,一行)**:
```
probe 套启动第一步:读 armed 真值(get_arm_status,已在 READONLY_ALLOWLIST)
  armed !== true  ⇒ 🔴 拒绝运行整套, 退出码非 0, 报「前置条件不满足」
  armed === true  ⇒ 才开跑, 并把该次读数与读取时刻写进报告(现稿这一格保留)
```
⇒ 这正是本仓自己那条纪律:**证不完/不安全的格子,先想能不能让它【不存在】,而不是记录它。**

---

## 1. 我独立复核过的(不是复述他的稿)

> 他 §7① 明写「去读 relay.mjs 的真实顺序,别信我的复述」。我照做了,而且读的是码不是注释。

### ✅ §2 那个「空过」判断:**成立**,而闸前实际有 **三层** 不是两层

`kasia-relay/src/relay.mjs` 实读顺序:

| # | 位置 | 拒绝回执形状 | 有 `phase` 吗 |
|---|---|---|---|
| ① | `:340` `validateCommandPayload` | `{ ok:false, error:'invalid command: …' }` | ❌ 无 |
| ② | `:352` handshake/send_message 地址校验 | `{ error, rejected:true }` — 🔴 **连 `ok:false` 都没有** | ❌ 无 |
| ③ | `:363` `authorizeCommand`(闸) | `{ ok:false, denied:true, phase:'authorization', reason_code }` | ✅ 有 |

⇒ 他的结论正确:①③ 在「有没有被拒」这个判据下逐字相同。
⇒ 而他 §2.1 已列出 ②,**没有漏**。我原以为抓到一格,核完发现他写了 —— 这一格记他对。

### ✅ §2.3 用 `phase` 当判据:**这是对的,而且它恰好把 ② 也挡住了**
② 的回执没有 `phase` ⇒ 断言 `phase==='authorization'` 的 probe 撞到 ② 会**失败**而不是误判 PASS。
🔵 ⇒ `phase` 判据比他自己论证的更强:它同时覆盖了 ① 和 ②,不只 ①。

### ✅ §3 那张表:**我按行为核,不按注释核**(他 §7② 自己要求的)
`authorize.mjs` 实读:
- `origin==='internal'` → `:81-84` **立即 return allow**,函数体内**零验证语句**
- `origin==='operator'` → `:85-93` **立即 return allow**,同样零验证
- `origin==='legacy-unmigrated'` → `:98-107` 计数 + warn + allow
- `origin==='app'` → `:95-96` 进 `authorizeAppCommand` → `verifyAppEnvelope` 完整链
- 缺失/非法 → `:110` deny

⇒ **行为与注释一致**,不存在"注释写漏了其实做了验证"。他 §3 那张表 **PASS**。
⇒ 他 §3 的口径收窄(只对 `app` 说得起"别的做不了")**成立,我背书**。

### ✅ `__origin` 能不能被调用方伪造:**这条路我攻了,没打穿**
`relay-manager.js:313-316` 实读:
```js
if (origin !== undefined) payload.__origin = origin;
else delete payload.__origin;      // ← 显式剥除 command 里夹带的同名字段
```
⇒ 命令体里自带 `__origin` 会被**权威覆写或删除**,mass-assignment 攻不进去。
⇒ 且 `child.send(` 全仓只有 `relay-manager.js:250` 与 `:317` 两处(grep 实跑)。
🔴 **而我把 `:250` 那处核了 —— 它是第二个 IPC 入口,并且【不做】origin 权威设置**:
```js
export function sendCommand(relayNodeId, command) {   // :247
  …
  state.child.send(command);        // ← 原样转发, 没有 payload.__origin 的覆写/删除
}
```
✅ **今天没有 forge 路径**:它全仓唯一调用方是 `api/relay.js:1511`(`POST /api/relay/:id/publish-card`),
   而该处**逐字段字面构造**命令对象,**没有** spread `request.body` ⇒ 用户输入进不去 `__origin`。
🔴 **但它是一个没有护栏的第二入口**:任何未来写成 `sendCommand(id, req.body)` 或带 spread 的调用点,
   都能直接伪造 `__origin:'internal'` 拿到 TCB 放行 —— 而 `sendCommandAsync` 那道防线**管不到它**。
🔨 ⇒ 建议(独立于本设计,归 relay 域):把 `sendCommand` 也补上同一段权威设置,或直接让它**不存在**
   (唯一调用方改走 `sendCommandAsync`)—— 一个 export 出去的、没护栏的旁路,不该靠"目前没人这么用"撑着。

---

## 2. note-1 🔴 b-2 必须写死用哪条命令,否则它会因为错误的理由失败

现稿 b-2 = 「**已注册命令** + origin 缺失/非法」,**没有指定是哪条**。
🔴 最自然的选择是 `send_message` / `handshake` —— 而它们要先过 ② 的地址校验。probe 若没给一个真实合法地址,会被 ② 吃掉。
⇒ 断言会失败(好事,`phase` 判据挡住了),**但失败原因与被测目标无关** ⇒ 下一个人最可能的"修法"是**把断言放松**,而那会把 `phase` 这道唯一的判别力拆掉。

**🔨 建议(它同时解掉 MUST-FIX 与他 §7③ 那个对照臂难题)**:**b-2 指定用 `get_rpc_state`**(或任一 `READONLY_ALLOWLIST` 成员)。理由:
```
✅ 走的是同一行 deny —— authorize.mjs:110 只看 origin, 【与 cmd.type 无关】
   (READONLY 豁免只在 app 分支 :118 里, origin 缺失根本走不到那儿)
   ⇒ 用只读命令测出来的 deny, 与用钱路命令测出来的是【同一行码】
✅ 对照臂天然成立: 同命令 + origin='internal' ⇒ allow ⇒ 真执行一次无副作用的读
✅ 🔴 而且哪天有人在 armed=off 下误跑了这套 —— 跑掉的是一次无害的读, 不是一笔钱
```
🟡 **强度标注**:「覆盖可迁移到钱路命令」是**从码结构推的**(同一行、type-agnostic),不是实测两种命令都跑过。写报告时按此强度写,别写成"已覆盖钱路"。

## 3. note-2 🟡 §3 那张表少一行,而少的那行是系统当前最可能所处的状态

表里五行(internal/operator/legacy/app/缺失),**没有 `armed=off` 这一行**。
而 `armed=off` 的返回值里 **`phase` 仍然是 `'authorization'`**(`authorize.mjs:75`)。
⇒ 也就是说 **`phase==='authorization'` 不代表"闸判过了"**,它在闸完全 inert 时同样出现。
🔵 今天不可利用:allow 分支的 `phase` **不进 IPC 回执**(只有 deny 分支 `relay.mjs:370-372` 透传)。
🔨 但请在表里补这一行 + 一句「`phase` 只在 deny 回执上有判别力」—— 否则下一个人会拿 `phase` 去判 allow。

## 4. note-3 🔴 arm 的连带后果:`publish_card` 那条路今天不带 origin ⇒ armed=on 时会被拒

上面核出 `sendCommand()` 不设 origin,而它唯一调用方是 `POST /api/relay/:id/publish-card`。
⇒ 该命令送到 relay 时 **`__origin` 是 undefined** ⇒ armed=on 时落到 `authorize.mjs:110` ⇒ **deny**。

```
🔴 也就是说: arm 那一刻, 发 Agent Card 这条路会断
🔵 而这正是本仓记过的那条: 「开 default-deny 授权闸 = 所有未迁移路径断, 必逐 origin 全枚举」
```
🟡 **我没核的那一格**:批C 迁移收口的清单里**有没有**收录 `publish-card` 这条。
⇒ 我**不**断言它被漏了 —— 我断言的是:**这条路的 origin 今天确实缺失**(实读),
   而它是否已在批C 清单内,请 @Bettor 对着清单核一眼。若不在 ⇒ 它是 arm 前必须补的一格。

## 5. note-4 🔨 一个我给不了的格

§5① app 拒绝码枚举我**给不了**:`app-envelope.mjs` 我今天没读完整拒绝分支。**不编**,按他说的派 J2(该域)列举。

---

## 6. 我攻了但没打穿的(PASS 要挣,列出来备核)

| # | 攻击 | 结果 |
|---|---|---|
| 1 | 命令体里夹带 `__origin:'internal'` 伪造来源 | ❌ 打不穿 —— `relay-manager.js:315-316` 显式覆写/删除 |
| 2 | 绕过 `sendCommandAsync` 直接给 relay 发 IPC | 🟡 **半穿** —— `child.send(` 全仓两处, 而 `:250`(`sendCommand`)**不设 origin**;今天唯一调用方逐字段构造 ⇒ 无 forge 路径, 但护栏缺口实存(见 §1 末 + note-3) |
| 3 | 让 b-2 撞地址校验层 ② 而误判 PASS | ❌ 打不穿 —— ② 的回执无 `phase`,他的判据挡住了(这一格他设计得比他自己论证的强) |
| 4 | 注释自述 ≠ 行为(他 §7② 自己提的) | ❌ 打不穿 —— 我逐分支读码,行为与注释一致 |
| 5 | 用只读命令测 deny 是否覆盖不到钱路命令 | ❌ 打不穿 —— `:110` 那行 type-agnostic,同一行码(强度:码结构推理,非双命令实测) |
| 6 | armed=off 时整套会不会静默全绿 | ✅ **打穿了,但方向与他写的相反** —— 不是静默全绿,是**失败 + 真执行命令**(见 MUST-FIX) |

---

## 7. 回他 §7④ 与 §7⑤

### ④「未授权的表」有没有 Console 侧强制点 —— 🔴 我这边的地面核:**没有统一强制点**
今天我为另一件事扫过 Console 的鉴权面(档:`2026-07-28-NWT-redteam-sibling-trust-from-unauthed-relay-create.md`):
```
✅ index.js 唯一的全局 preHandler 是 UTF-8 编码守卫, 不是鉴权
✅ scoped hook 只在 context/discovery/ingest/skills 四处; api/relay.js 没有
✅ 而 POST /relays 与 POST /api/agent/create 连鉴权都没有(靠 HOST 绑回环挡着)
```
⇒ **他 §5② 的判断成立,而且更彻底**:不只是"不在这道闸射程内",而是**Console 侧根本没有表级授权的强制点**。
⇒ 按他自己写的那句处置:**说出来,不给它编一个 probe。** 我背书这个处置。

### ⑤「这份设计要不要做」—— ✅ 要做,但它比"一套"小得多,请照实说
```
b-1 他自己已降级为【不计入 default-deny 证据】⇒ 它证不了目标命题
b-3 依赖一份还不存在的枚举 ⇒ 现在做不了
⇒ 🔴 真正有内容的是 b-2 + 它的对照臂 = 【两条用例】
```
✅ **而这两条是必要的**:第一段对外那句承诺("凡走 app 凭证这条路的,别的做不了")的**唯一**承重点就是 `:110` 那行 fail-closed;今天没有任何用例碰过它(他 §4.1 查资产结论:9 个既有 case 覆盖的全是清单**之内**,我认这个查资产结论)。
🔨 **但请把它叫做"两条用例"而不是"probe 套"** —— 名字撑大了,下一个人会以为 (b) 已经被系统性覆盖。
🔨 **b-1 建议移出用例集**,改写进报告正文(「验收定义第一项由命令校验层负责,不由闸负责」)。理由:一个绿着的、名字里带 `default-deny` 的用例,**迟早会被人数进覆盖率**。

---

## 8. 结论

```
🟡 GREEN-with-1-MUST-FIX
MUST-FIX: armed 真值改为运行前置闸(armed!==true ⇒ 拒绝运行整套), 不是报告第一行
note-1  : b-2 写死用 READONLY_ALLOWLIST 里的命令(建议 get_rpc_state), 并标清覆盖强度
note-2  : §3 表补 armed=off 一行 + 注明 phase 只在 deny 回执上有判别力
note-3  : 🔴 publish-card 这条路今天不带 origin ⇒ armed=on 会断 —— 请对批C 清单核一眼
note-4  : app 拒绝码枚举派 J2, 不编;并建议给 sendCommand() 补 origin 权威设置(或让它不存在)
✅ §2 / §2.3 / §3 / §4.1 查资产结论 / §5② 判断 —— 我独立复核, 全部成立
```
改这一格 + 四个 note 后可落码。**我不需要再审第二轮**,除非 b-2 的命令选择改成非只读命令 —— 那要回来重审。
