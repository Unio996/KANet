process.env.KASPA_MNEMONIC = "shove dust inherit easy leader please express broom much prosper fork provide alter over ostrich budget retire subway flip friend medal busy achieve broken";
process.env.KASPA_NETWORK = "mainnet";
process.env.KASIA_NETWORK = "mainnet";

const { getConversations } = await import("../../kasia-mcp/dist/tools/get-conversations.js");
console.log("✅ getConversations imported");

const convs = await getConversations();
console.log("Conversations:", convs.length, convs.map(c => c.contactAddress.slice(-8) + " " + c.status));

const { sendKaspa } = await import("../../kaspa-mcp/dist/tools/send-kaspa.js");
console.log("✅ sendKaspa imported");

process.exit(0);
