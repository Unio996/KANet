process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_pm_e2e_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '1'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_pm_e2e/kasia-console/src/db/client.js');   // 生产 client(M0a 门: 不裸 import better-sqlite3); 需 sim console 已停或仅读
for (const r of db.prepare(process.argv[2]).all()) console.log(JSON.stringify(r).slice(0, Number(process.argv[3] || 700)));
