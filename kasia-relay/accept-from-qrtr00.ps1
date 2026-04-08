$env:KASPA_MNEMONIC_A = "REDACTED_MNEMONIC_B"
$env:PEER = "kaspa:qrtr00qnq7zaydyf2tpv8s8uz3xdjtrzjnwn4qnee862dk42fnevs3rakdsv0"

node -e "
import('@modelcontextprotocol/sdk/client/index.js').then(async ({ Client }) => {
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

const BASE_ENV = { KASPA_NETWORK: 'mainnet', KASIA_NETWORK: 'mainnet', KASPA_MNEMONIC: process.env.KASPA_MNEMONIC_A };
const PEER = process.env.PEER;

async function makeClient(path, name) {
  const t = new StdioClientTransport({ command: 'node', args: [path], env: { ...process.env, ...BASE_ENV } });
  const c = new Client({ name, version: '0.1.0' }, { capabilities: {} });
  await c.connect(t); console.log('connected:', name); return c;
}
function extract(res) {
  const text = res?.content?.find?.(c => c?.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return { rawText: text }; }
}

const kaspa = await makeClient('D:/Anthropic/kaspa-mcp/dist/index.js', 'kaspa');
const kasia = await makeClient('D:/Anthropic/kasia-mcp/dist/index.js', 'kasia');

const draft = extract(await kasia.callTool({ name: 'kasia_accept_handshake', arguments: { address: PEER } }));
console.log('accept draft:', JSON.stringify(draft));

const sent = extract(await kaspa.callTool({ name: 'send_kaspa', arguments: { to: draft.to, amount: draft.amount, payload: draft.payload } }));
console.log('TX:', sent?.txId || JSON.stringify(sent));

await kaspa.close(); await kasia.close(); process.exit(0);
});
" 2>&1
