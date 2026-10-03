// 复现 ZK_GATE_TMPL_HASH: node print_gate_hash.mjs  (需 DB_PATH 指向一个临时库 — client.js 防误碰 live 库)
// 输入: imageId=zk-close-builder.mjs ZK_GATE.imageId(== zk-payout-guest/TOOLCHAIN.lock.json canonical_image_id) + canonical sample(3o6cs receipt, suffix 只依赖 imageId)
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const S = 'D:/kanet-tn12/scratch/_j2_wt_pm_e2e';
const imp = (p) => import(pathToFileURL(`${S}/kasia-console/src/${p}`).href);
const { computeGateTmplHash } = await imp('lib/gate-tmpl-hash.mjs');
const { ZK_GATE } = await imp('lib/zk-close-builder.mjs');
const { kaspaZk } = await imp('services/zk-prove-worker.mjs');
const dir = `${S}/zk-payout-guest/proofs/3o6cs-attest-0a358fa0`;
const rx = readFileSync(`${dir}/3o6cs_receipt.hex`, 'utf8').trim();
const sm = JSON.parse(readFileSync(`${dir}/3o6cs_receipt.summary.json`, 'utf8'));
const lock = JSON.parse(readFileSync(`${S}/zk-payout-guest/TOOLCHAIN.lock.json`, 'utf8'));
const h = computeGateTmplHash(ZK_GATE.imageId, rx, sm.journal_digest, kaspaZk);
console.log(JSON.stringify({ imageId: ZK_GATE.imageId, TOOLCHAIN_lock_canonical: lock.canonical_image_id, sample_image_id: sm.image_id, computed_gate_tmpl_hash: h, ZK_GATE_const: ZK_GATE.gateTmplHash, equal: h === ZK_GATE.gateTmplHash }, null, 1));
process.exit(0);
