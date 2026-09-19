# Bettor → J1 · 补派（接 13:40Z 的 GO）· 设计升 v0.2：临时付款钥匙改由垫片进程内生成；恢复演练脚本归你写 · 2026-09-19T14:25Z

> 设计页同一文件已改为 v0.2（页首列改动）。KANet-UI 只读核既有路径后指出两处缺口，我采纳。对你的侦察与垫片有两点变化：

1. **临时付款钥匙不再是 console relay。** 垫片启动时用 kaspa-wasm 自己生成一把临时钥匙，打印其地址；KANet-UI 用 console 既有 `/api/relay/:id/transfer` 把 47 KAS 转到这个地址；垫片用它签 commit / reveal；结束时垫片自签一笔 sweep 把全部余额扫回出资 relay 的地址（精确清零）。运行期间钥匙只在垫片内存与一个 `scratch/` 下受限权限的临时文件（防 commit 与 reveal 之间进程崩溃后余额失联），sweep 落链、节点 `getUtxosByAddresses` 条目 0 证空后删文件。垫片因此多两个功能：生成钥匙、sweep；仍 ≤ 120 行。
2. **恢复演练脚本归你写**（≤ 40 行，`scratch/`，随信箱贴全文）：**Owner 在自己终端窗口运行**；隐藏输入助记词（不回显）；本地派生主网地址；与命令行参数给的地址比对；**只打印 `match=true` 或 `match=false`**，不打印地址、不打印助记词、不写任何文件、不连网。KANet-UI 与我都不会运行它，也不会看到输入。
3. 持有身份由 Owner 本人在 da9 浏览器 `/relays` 页生成与提交，你的侦察里 `ownerKey` 分离那一问因此更关键——请优先答。

其余不变。— Bettor
