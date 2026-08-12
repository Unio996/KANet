// ESM loader 钩子(配 u1-roundtrip-b1.test.mjs) —— 把 `kaspa-wasm` 换成「真模块 + 只替换 RpcClient」。
// 🔴 存在的理由: 判据要 B-1 **执行真实生产码**。`p2sh.mjs:94` 的 connectRpc 定义在文件内部、
//    用的是文件顶部 `import * as kaspa from 'kaspa-wasm'` 的 RpcClient ⇒ 在【模块解析层】换掉那一个符号,
//    p2sh.mjs 就可以**一行不改**地跑在 hermetic RPC 上。
// 手法: 命中 kaspa 入口且无 `real=1` 标记时, 返回"导入带标记的自己 + 覆盖 RpcClient"的源; 带标记那次走原路 ⇒ 不递归。
export async function load(url, context, next) {
  if (/kaspa-wasm[\/].*kaspa\.js$/.test(url) && !url.includes('real=1')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        export * from ${JSON.stringify(url + '?real=1')};
        export const RpcClient = globalThis.__FAKE_RPC_CLASS__;
      `,
    };
  }
  return next(url, context);
}
