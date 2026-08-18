// KANet-UI 一次性诊断脚本 — console/注册节点(本机) health 采样, 照 J1 (462) 方法
// 60s 间隔, 目标 46 采(~46min), 输出 JSONL 到 stdout, 同时写文件供事后核对
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = 'D:/kanet-tn12/kasia-console/scratch/_kanetui_nodehealth_run1.jsonl';
writeFileSync(OUT, '');

async function main() {
  const kaspa = await import('kaspa-wasm');
  const { RpcClient, Encoding } = kaspa;
  const rpc = new RpcClient({ url: 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId: 'testnet-12' });
  await Promise.race([rpc.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 10000))]);

  const N = 46;
  let lastDaa = null;
  let rollback = 0;
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    let line;
    try {
      const info = await rpc.getBlockDagInfo();
      const server = await rpc.getServerInfo();
      const daaNum = Number(info.virtualDaaScore);
      if (lastDaa !== null && daaNum < lastDaa) rollback += 1;
      lastDaa = daaNum;
      const rec = {
        t: new Date().toISOString(),
        tips: info.tipHashes ? info.tipHashes.length : null,
        daa: daaNum,
        isSynced: server.isSynced,
      };
      line = JSON.stringify(rec);
    } catch (e) {
      line = JSON.stringify({ t: new Date().toISOString(), error: String(e && e.message || e) });
    }
    console.log(line);
    appendFileSync(OUT, line + '\n');
    const elapsed = Date.now() - t0;
    const waitMs = Math.max(0, 60000 - elapsed);
    if (i < N - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  console.log(`DONE. rollback_events=${rollback}`);
  await rpc.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.message || e); process.exit(1); });
