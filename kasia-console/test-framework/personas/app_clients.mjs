// test-framework/personas/app_clients.mjs — M0c-1 gate app-client 协议人格(平替真人·Owner 令)
// 设计: docs/2026-07-23-m0c-1-app-provision-harness-design.md §3
//
// 与 broker NL persona(step(state,reply) 对话机)不同层: 这是协议层命令流人格 —— 模拟真实 app
// 对 relay gate 的命令行为模式。每 persona = 连续命令流(非孤立单发, NWT 判据 4 端到端)。
// buildFlow(ctx) → [{ label, build(), expect:'allow'|'deny', denyMatch?, timeoutMs? }]
//   ctx = { sdk, base }  base={appKeyId,grantId,relayId,network,privkeyHex}
//   build() 返回喂 relay-gate-driver.send 的 cmd。
//
// M0c-2/M0c-3 harness 可复用本人格层(scope 精判/replay 各加变体)。

const PAYEE = 'kaspatest:qqallowedpayee0000';
const EVIL_PAYEE = 'kaspatest:qqevilpayee00000';

// 诚实 app: 连续合法业务流(readonly→通信→transfer→再来一笔), 全 scope 内 → 全 allow。
export const app_legit = {
  id: 'app_legit', name: '诚实 app(tg-mini-app 类)',
  buildFlow({ sdk, base }) {
    return [
      { label: 'readonly get_pubkey(白名单豁免信封)', expect: 'allow',
        build: () => ({ type: 'get_pubkey', __origin: 'app' }) },
      { label: '合法 transfer(scope 内额度+收款人)', expect: 'allow', timeoutMs: 40000,
        allowExec: true, // 进 switch→执行层错误=allow 证据
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0' } }) },
      { label: '再一笔合法 transfer(重复业务·非重放·新 nonce)', expect: 'allow', timeoutMs: 40000,
        allowExec: true,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '2.0' } }) },
    ];
  },
};

// 越权 app: 拿窄 grant 想干大事 → 全 deny(scope violation 各维度)。
export const app_greedy = {
  id: 'app_greedy', name: '越权 app(超 grant scope)',
  buildFlow({ sdk, base }) {
    return [
      { label: '超额度 transfer(>单笔上限)', expect: 'deny', denyMatch: /上限/,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '99.0' } }) },
      { label: 'scope 外收款人', expect: 'deny', denyMatch: /payee_scope/,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: EVIL_PAYEE, amount: '1.0' } }) },
      { label: '未授权命令(sign_input_for_settle ∉ allowed_commands)', expect: 'deny', denyMatch: /allowed_commands/,
        build: () => sdk.buildAppCmd({ ...base, type: 'sign_input_for_settle', intent: { tx_hex: 'aa', input_index: 0 } }) },
      { label: '未授权维度(带 marketId·grant.market_scope=NULL)', expect: 'deny', denyMatch: /未授权/,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0', marketId: 'm1' } }) },
    ];
  },
};

// 伪造者: 偷到信封没偷到私钥 → 全 deny(错钥 + 偷签名逐字段改五谱, NWT 判据 b)。
export const app_forger = {
  id: 'app_forger', name: '伪造者(偷信封没偷私钥)',
  buildFlow({ sdk, base }) {
    const legit = () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0' } });
    const wrongKey = '11'.repeat(32);
    const flow = [
      { label: '错私钥重签', expect: 'deny', denyMatch: /签名/,
        build: () => sdk.resignWithWrongKey(legit(), wrongKey) },
    ];
    // 偷合法签名逐字段改族(五字段: nonce/relay_id/network/expires_at/grant_id)—— 全信封签名范围焊死。
    const tampers = [
      ['nonce', 'stolen-replay-nonce'],
      ['relay_id', 'relay-other-9999'],
      ['network', 'testnet-11'],
      ['expires_at', Date.now() + 30 * 60 * 1000],
      ['grant_id', '00000000-0000-0000-0000-000000000000'],
    ];
    for (const [f, v] of tampers) {
      flow.push({ label: `偷签名改 ${f}(旧签名失效)`, expect: 'deny',
        build: () => sdk.tamperEnvelopeField(legit(), f, v) });
    }
    return flow;
  },
};

// 掉包者: 签小执行大 / cmd 多带字段 → deny(verify-value-source)。
export const app_toctou = {
  id: 'app_toctou', name: '掉包者(签小执行大)',
  buildFlow({ sdk, base }) {
    const legit = () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0' } });
    return [
      { label: 'envelope 签 1.0 / cmd 执行改 99.0', expect: 'deny', denyMatch: /verify-value-source|字段/,
        build: () => sdk.swapExecField(legit(), 'amount', '99.0') },
      { label: 'cmd 多带执行字段(字段集不匹配)', expect: 'deny', denyMatch: /字段集/,
        build: () => sdk.swapExecField(legit(), 'sneak_field', 'x') },
    ];
  },
};

// 被吊销 app: 合法一笔 → operator revoke → 同 grant 下条立即拒(fresh 读)。
// revoke 动作在 harness runner 内穿插(需跑 provision 脚本), persona 只描述前后两笔。
export const app_revoked = {
  id: 'app_revoked', name: '被吊销 app',
  buildFlow({ sdk, base }) {
    return [
      { label: '吊销前合法 transfer', expect: 'allow', timeoutMs: 40000, allowExec: true,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0' } }) },
      { label: '__REVOKE__', revoke: true }, // runner 拦这条跑 provision revoke
      { label: '吊销后同 grant transfer(即时拒)', expect: 'deny', denyMatch: /吊销/,
        build: () => sdk.buildAppCmd({ ...base, type: 'transfer', intent: { target: PAYEE, amount: '1.0' } }) },
    ];
  },
};

// origin 五值谱: internal/operator/legacy-unmigrated 放行 / 缺失拒 / 非法拒(armed=on 全谱, 断现网镜像 + C 分阶段验)。
export const origin_spectrum = {
  id: 'origin_spectrum', name: 'origin 五值谱(armed=on·含 C 分阶段 legacy)',
  buildFlow() {
    return [
      { label: 'internal 放行(乙路 TCB)', expect: 'allow', timeoutMs: 40000, allowExec: true,
        build: () => ({ type: 'transfer', target: 'kaspatest:qqx', amount: '1', __origin: 'internal' }) },
      { label: 'operator 放行(端点白名单受信)', expect: 'allow', timeoutMs: 40000, allowExec: true,
        build: () => ({ type: 'transfer', target: 'kaspatest:qqx', amount: '1', __origin: 'operator' }) },
      { label: 'legacy-unmigrated 放行(C 分阶段·显式 tag·收敛类过渡)', expect: 'allow', timeoutMs: 40000, allowExec: true,
        build: () => ({ type: 'transfer', target: 'kaspatest:qqx', amount: '1', __origin: 'legacy-unmigrated' }) },
      { label: '缺失 origin 拒(fail-closed·非"缺失放行")', expect: 'deny', denyMatch: /origin 缺失|非法/,
        build: () => ({ type: 'transfer', target: 'kaspatest:qqx', amount: '1' }) },
      { label: '非法 origin 拒', expect: 'deny', denyMatch: /origin 缺失|非法/,
        build: () => ({ type: 'transfer', target: 'kaspatest:qqx', amount: '1', __origin: 'spoofed' }) },
    ];
  },
};

export const ALL_PERSONAS = [app_legit, app_greedy, app_forger, app_toctou, app_revoked, origin_spectrum];
export const PAYEE_ADDR = PAYEE;
