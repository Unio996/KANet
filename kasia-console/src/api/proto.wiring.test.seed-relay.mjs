// proto.wiring.test.seed-relay.mjs — 供 proto.wiring.test.mjs 用 execSync 调用的种子脚本。
// 通过 ../db/client.js 这条已审查合法通道写库(带 DB_PATH env), 不裸 import better-sqlite3
// ——M0a 差分门(R-M0A-BARE-IMPORT-DIFF)只认这条路径, 新增裸 sqlite import 直接败(实测撞过)。
// Usage: DB_PATH=<abs path> node src/api/proto.wiring.test.seed-relay.mjs <relayId>
const { sqlite } = await import('../db/client.js');
const [, , relayId] = process.argv;
if (!relayId) { console.error('usage: node proto.wiring.test.seed-relay.mjs <relayId>'); process.exit(1); }
const now = new Date().toISOString();
sqlite.prepare(`
  INSERT INTO relay_nodes (id, name, address, network, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(relayId, 'proto-wiring-test', 'kaspa:qp6uzwm8anlndr27gys5zdze32gee9rktntsld573u9ulr5cc8r05seg645k3', 'mainnet', now, now);
