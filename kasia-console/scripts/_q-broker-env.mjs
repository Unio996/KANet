import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

const wallets = db.prepare(`SELECT chain, address, is_default FROM agent_wallets WHERE relay_node_id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0' ORDER BY chain`).all();
console.log('=== broker (Trader-B) wallets ===');
console.table(wallets);

const brokerAddr = db.prepare(`SELECT address FROM relay_nodes WHERE id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'`).get().address;
console.log('broker kaspa addr:', brokerAddr);

const orderbook = db.prepare(`
  SELECT id, give_amount, want_amount, json_extract(metadata,'$.source') AS src, broadcast_at, expires_at
  FROM exchange_offers
  WHERE protocol_status = 'open'
    AND give_asset = 'KAS' AND want_asset = 'USDT'
    AND maker != ?
  ORDER BY broadcast_at DESC LIMIT 10
`).all(brokerAddr);
console.log('\n=== open orderbook KAS→USDT (excluding broker self) ===');
console.table(orderbook);

const brokerOpen = db.prepare(`
  SELECT id, give_amount, want_amount, json_extract(metadata,'$.source') AS src, broadcast_at
  FROM exchange_offers
  WHERE protocol_status = 'open'
    AND give_asset = 'KAS' AND want_asset = 'USDT'
    AND maker = ?
  ORDER BY broadcast_at DESC LIMIT 10
`).all(brokerAddr);
console.log('\n=== broker self open KAS→USDT (broker_dynamic_quote) ===');
console.table(brokerOpen);

db.close();
