import { sqlite } from '../src/db/client.js';
const rows = sqlite.prepare("SELECT name, alias, last_message_at, archived FROM channels WHERE name LIKE 'dev-%' OR name LIKE 'kanet-dev%' ORDER BY last_message_at DESC LIMIT 10").all();
console.log(JSON.stringify(rows, null, 2));
