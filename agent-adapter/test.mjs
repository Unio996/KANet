// 直接测试 OpenClaw WebSocket，不经过 adapter HTTP 层
import { askAgent } from "./src/openclaw.mjs";

console.log("测试 OpenClaw Gateway WebSocket...\n");

try {
  const reply = await askAgent("你好，这是来自 agent-adapter 的测试消息。", "test-" + Date.now());
  console.log("\n✅ 成功！Agent 回复：\n");
  console.log(reply);
} catch (e) {
  console.error("\n✗ 失败：", e.message);
}
