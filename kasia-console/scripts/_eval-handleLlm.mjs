import { handleLlmDialog } from '../src/services/broker-llm-agent.js';
import { handleBuyIntent } from '../src/services/broker-buy-handler.js';

const peer = 'kaspa:qpfake_j2_eval_' + Date.now();
const msg = '我要买 50 KAS';

console.log('peer:', peer);
console.log('msg:', JSON.stringify(msg));

console.log('\n=== handleBuyIntent ===');
const r1 = await handleBuyIntent(peer, msg);
console.log('return:', JSON.stringify(r1));

console.log('\n=== handleLlmDialog ===');
const r2 = await handleLlmDialog(peer, msg);
console.log('return:', JSON.stringify(r2));
process.exit(0);
