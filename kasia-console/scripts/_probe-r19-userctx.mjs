import { assertReplyAddressInvariant } from '../src/services/broker-action-queue.js';

const userAddr = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';
const replyText = `好的, 收到, 卖 99 KAS, BSC 链, 收款地址 ${userAddr}, 请确认`;
const userContext = `我要卖 99 个 kas, BSC, ${userAddr}`;

const r1 = assertReplyAddressInvariant(replyText, userContext);
console.log('Test 1 (user echo, with userContext):', JSON.stringify(r1));

const r2 = assertReplyAddressInvariant(replyText);
console.log('Test 2 (no userContext, legacy strict):', JSON.stringify(r2));

const fakeAddr = '0xDEADBEEF00000000000000000000000000000001';
const r3 = assertReplyAddressInvariant(`请转账到 ${fakeAddr}`, userContext);
console.log('Test 3 (broker hallucinate fake):', JSON.stringify(r3));
