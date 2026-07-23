# M0c-1 app provision 组件设计 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**：`docs/2026-07-23-m0c-1-app-provision-design.md`（J2，commit `6dc5194e`）——grant registry + 信封验证 + provision，填实批3 gate 的 app 路径 stub，是 **armed=on 前提之一**（GRANT_ENVELOPE_IMPLEMENTED→true）+ 真正的场景-A 拦截。
> **立场**：红队默认 refute。这是真场景-A 授权闸落地 + arm-enabler，我尤其查签名到底绑没绑住全部字段（不然重放/跨relay/跨grant 绕过）。
> **verdict**：**GREEN-with-1-MUST-FIX + 1-note**。忠实落地我全部前置 MUST-FIX（provision 场景-A 不可达 / verify-value-source / unknown-field strict-reject / grant-inflation MF3，连我记忆锚都引了）。MUST-FIX = **签名范围**：step3 只验 `canonical(envelope.intent)`=只签 intent，nonce/relay/network/expiry/grant-id 没签=可伪造=重放/跨relay/跨grant/延期绕过（M-1.6 §5 "任一字段变化必须使签名失效"被窄化）。

---

## 打不穿的（挣的 GREEN·前置 MUST-FIX 全兑现）

- **provision 场景-A 不可达（我 M0c-1 §4.3 MUST-FIX）**：§4 operator 离线脚本、零 HTTP/零 IPC 写、不新增 provision_grant 命令、静态可枚举仅 operator 一处、运行时自注册禁止。✅ 焊死。
- **verify-value-source（我 M0c-2 MUST-FIX）**：§3 step5 抽 scope 值来自冻结 canonical intent、执行消费同一字段、禁旁支/re-parse。✅
- **unknown-field strict-reject（我记忆 feerules-hash-commit-unknown-field-collision）**：§3 step4 canonical 反序列化 strict-reject 未知字段。✅ 连记忆锚都引了。
- **grant-inflation / MF3**：§2 intent⊆relay-authoritative grant（scope 从 registry 非信封自报）。✅
- **验签复用不新造**：§0/§3 step3 复用 kaspa-wasm verifyMessage（同 oracle-pool），不新造密码学。✅
- **TCB 诚实 + 禁用词表 + 同网三面**：§1/§4 乙路诚实标注，不 overclaim。✅
- **fail-closed 全链**：任一步失败拒不推进状态。✅

## 🔴 MUST-FIX：签名必须覆盖全 canonical envelope，不只 intent

**打穿链**：§3 step3 = `kaspa.verifyMessage(canonical(envelope.intent), envelope.signature, appPubkey)`——签名只覆盖 **envelope.intent**（命令+参数）。但一个信封还带 app_key_id / grant-id / relay / network / nonce / issued-at / expiry / scope-request 等字段（M-1.6 §5 canonical 要求这些**全部**绑进签名）。只签 intent → **其余字段没进签名 = 可伪造/可替换**：

- **nonce 没签** → 攻击者拿一个合法签名的 intent，换个 nonce 重发 → M0c-3 的 nonce 防重放被绕（nonce 不在签名内=nonce 可任意改，重放保护 vacuous）。
- **relay/network 没签** → 同一签名 intent 跨 relay/跨 network 重放。
- **expiry 没签** → 攻击者延长 expiry（过期信封改 expiry 复用）。
- **grant-id 没签**（若 app 多 grant）→ 拿针对 grant A 的签名 intent 套 grant B。

M-1.6 §5 canonical envelope 明写"任一字段（收款人/金额/用户subject/route-intent/network/relay）变化必须使签名失效"——app provision §3 step3 把它窄化成"只签 intent"，把 nonce/relay/network/expiry/grant-id 排除在签名外 = 上述绕过面。

**修法**：step3 验签的消息 = **全 canonical envelope（去掉 signature 字段本身）**，绑定 M-1.6 §5 全部字段：protocol/domain/version + app_key_id + grant-id + relay identity + network + typed-intent 版本 + canonical intent digest + scope-request + nonce + issued-at + expiry。即 `verifyMessage(canonicalize(envelope 去 signature), signature, appPubkey)`，不是 `canonical(envelope.intent)`。签名覆盖全字段后：改任一字段签名失效（nonce 不能换、relay/network/expiry/grant-id 不能替）。§3 step4 canonical 反序列化+strict-reject 也应对**全信封**做（不只 intent）。§6 补负向测试：改 nonce/relay/network/expiry 后签名失效验拒。

## note：relay 侧 grant/吊销读必须 fresh 或写失效缓存

§2 "relay 进程启动加载 or 按需查（落码定）"——若 relay **启动缓存** registry，则 operator provision 更新/**吊销**（M0c-3 ⑦要求即时）在 relay 重启前不生效 = **缓存的被吊销 grant 仍放行**（吊销即时性被 relay 缓存打败）。修法：relay 侧 grant/吊销读**每命令 fresh 读 or provision/吊销写时失效缓存**（同我 M0c-3 §4 吊销读一致性 note，此处在 gate 落地）。落码定读取策略时焊死"吊销即时可见"。

## 判据

GREEN-with-1-MUST-FIX+1-note：组件忠实兑现全部前置 MUST-FIX，方向成立。MUST-FIX（签名覆盖全 canonical envelope 非只 intent）是防重放/跨relay/跨grant 绕过的立身之本，必须设计写死 + 落码 diff 审核"签的消息==全 canonical envelope 去 signature"。落码后我 diff 审（签名范围 / verify-value-source 抽取==执行 / provision 场景-A 不可达 / strict-reject / registry 读 fresh）+ 实战 harness（§6 + 改字段签名失效）。**这批 GREEN+落码闭 = GRANT_ENVELOPE_IMPLEMENTED=true = 解 armed=on 前提之一**（另两条：批C 迁移收口[含别名穷尽]+provision 实）。

**关联**：`docs/2026-07-23-m0c-1-app-provision-design.md`（审对象）、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3.1 §5（canonical envelope 全字段）、`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md` §4.2/§4.3、`docs/2026-07-23-NWT-redteam-m0c-2-scope-evaluator.md`（verify-value-source）、`docs/2026-07-23-NWT-redteam-m0c-3-replay-audit-revocation.md`（吊销读一致性）。
