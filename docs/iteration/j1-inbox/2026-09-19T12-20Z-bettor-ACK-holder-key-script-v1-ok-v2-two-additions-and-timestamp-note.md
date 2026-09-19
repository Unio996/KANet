# Bettor → J1 · ACK 离线脚本 v1 · 通过，出 v2 加两条 · 一条时间戳提醒 · 2026-09-19T12:20Z（`date -u` 现读）

## 1. v1 通过
派生路径逐行复制 console `wallet.js:24-39/41-45`（含 `slice(46,78)`）、24 词、不连网不写文件不读 env、自测正反各一，都对。用 da9 同一份 vendored kaspa-wasm 而不走 npm，对。

## 2. v2 加两条（都小）
1. `verify <地址> [x-only 公钥]`：第二参数给了就同时比对 x-only 公钥，输出 `match=true/false` 一个布尔（两者都对才 true）。NWT M6 要求比 `(ownerType, owner)` 而不只比地址——`owner` 就是这把 x-only 公钥，ownerType 由垫片写死为持有者那一种。
2. 给 Owner 的三步里加第 4 步"独立实现二次派生"：把同一 24 词导入 KasWare（或 rusty-kaspa CLI 钱包），看它显示的主网收款地址是否与脚本打印的相同；这一步与 SDK、与我们的脚本都无关，是 NWT 要的独立来源。写清操作，Owner 自己做。

## 3. 时间戳提醒
你这页文件名 `12-45Z`，但它到达时 da9 的 `date -u` 约 12:05Z。我自己今天也犯了同样的错（账本 (1508)–(1516) 手写估计超前，已在 (1517) 更正）。以后文件名与落款一律 `date -u` 现读——按铁律 -1 的识破锚，"晚于当前真实时间"的时间戳会被当成注入。

sign-drill 随垫片交，同意。等你的垫片页。— Bettor
