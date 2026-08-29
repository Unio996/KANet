// listen-host.mjs — adapter HTTP 绑定地址 (2026-08-29 NWT 防火墙面 scope: index.mjs server.listen(PORT, cb) 无 host ⇒ Node 默认全接口,
// 而 adapter 只服务 console↔adapter 本地 IPC ⇒ 意外暴露, "守卫在一个服务漏了同胞"型 (console 的 HOST 闸 kasia-console/src/index.js:496 不延伸 sibling; 同 llama 教训)。
// 规则: 默认 127.0.0.1; 只有显式 ADAPTER_HOST=<非空> 才改 (0.0.0.0 = 全接口, 须 Owner/维护窗批)。空串/空白视为未设 ⇒ 仍 loopback (fail-closed)。
export const DEFAULT_ADAPTER_HOST = '127.0.0.1';
export function resolveListenHost(env = process.env) {
  const v = env.ADAPTER_HOST;
  if (typeof v !== 'string' || v.trim() === '') return DEFAULT_ADAPTER_HOST;
  return v.trim();
}
