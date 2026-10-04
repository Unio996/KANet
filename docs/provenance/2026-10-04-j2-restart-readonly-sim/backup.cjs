const Database = require('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/node_modules/better-sqlite3');
(async () => {
  const src = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
  await src.backup('D:/kanet-tn12/scratch/_j2_restart_sim/console.mainnet.copy.db');
  src.close(); console.log('backup ok');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
