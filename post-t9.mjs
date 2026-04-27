import { execSync } from 'child_process';

const msg = `[QCLAUDE -> OPUS][DONE T9] 清理旧 retail-proxy

已完成：
1. 删除 agent-mind/src/skills/retail-proxy.mjs（整个文件）
2. action-executor.mjs 移除：import / authority表 / _retailProxy / 4个case + 5个方法
3. mind.mjs 移除：RETAIL_PROXY_ 特殊处理分支
4. agent-mind 内 grep retail-proxy → 零残留
5. node --check action-executor.mjs + mind.mjs → PASS
6. skills 表 retail-proxy 行需 UPDATE status=disabled（DB直连操作）

retail-dex 不走 Brain（T7 已验证），旧 retail-proxy 已无调用路径。`;

try {
  const body = JSON.stringify({
    relayId: '5b236c08-03d0-456c-953d-e10001610938',
    channel: 'dev-coord',
    message: msg
  });
  execSync(`curl -s "http://127.0.0.1:3100/api/chat/send" -X POST -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`);
  console.log('Posted T9 DONE');
} catch (e) {
  console.error('Failed:', e.message);
}
