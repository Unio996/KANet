# Broker 测试客户端编码指南 (T-J2-23)

Owner 04-26 RCA: NWT/J2 测试 broker 中文 6/6 fail 不是 Qwen 模型限制, 是**测试客户端编码 corrupt** CJK 字节.

## 必须用

| 客户端 | 命令 | 状态 |
|---|---|---|
| Node | `fetch(url, { headers: {'Content-Type': 'application/json; charset=utf-8'}, body: JSON.stringify({...}) })` | ✓ |
| curl | `curl --data-binary @file -H 'Content-Type: application/json; charset=utf-8'` | ✓ |
| Python | `requests.post(url, json={...})` | ✓ |

## 不要用

| 客户端 | 错因 |
|---|---|
| `curl -d "$body"` (bash double-quote) | bash/MSYS locale 把 CJK "买" 替换 `?` |
| PowerShell `Invoke-RestMethod` 默认 | UTF-16 BOM corrupt CJK |
| PowerShell `Invoke-WebRequest -Body $body` | 同上 |

PowerShell 严格 UTF-8 写法:
```powershell
$body = @{ relayNodeId='...'; peer='...'; message='买 50 KAS' } | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/agent/reply' `
  -Method POST -ContentType 'application/json; charset=utf-8' -Body $bytes
```

## 推荐 (Dev 工具)

```bash
node kasia-console/scripts/broker-probe.mjs               # 跑默认 10 case 矩阵
node kasia-console/scripts/broker-probe.mjs '买 50 KAS'   # 单独跑一条
```

## 服务端保护 (T-J2-23)

`src/index.js` fastify preHandler hook 验 `/api/agent/reply` body.message 字段是否含 U+FFFD / lone surrogate. 命中返 400 + 提示用 Node fetch / --data-binary.

注意: bash curl -d 把"买"直接替换 `?` (ASCII), 不会被 U+FFFD 检测命中. **dev 自己用 broker-probe.mjs 跑测试是底线**.

## 生产环境影响

零. Kasia 客户端 → 链上 broadcast (UTF-8 字节序列) → broker relay catch-up (`Buffer.from(payload, 'hex').toString('utf8')` 严格 UTF-8) → conversations.js fork → handleLlmDialog. 真用户走链上 message 永远 UTF-8 valid.

## 历史

- 2026-04-26 Owner 测试 broker 中文 → broker LLM 问 "买还是卖" → Owner 怒 → NWT/J1/J2 6 轮 retest debug → J1 怀疑模型限制 → Owner 提示 "编码问题吧?" → J2 用 `curl --data-binary` vs `-d` 复现, J1 用 Node fetch 复现 → Owner 编码 RCA 100% 证实 → 加 fastify hook + dev probe + 本指南.
