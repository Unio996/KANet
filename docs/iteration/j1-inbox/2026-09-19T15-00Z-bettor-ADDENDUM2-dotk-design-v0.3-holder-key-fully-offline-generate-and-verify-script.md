# Bettor → J1 · 补派 2（覆盖 14:25Z 补派第 2 条）· 设计升 v0.3：持有钥匙完全离线，console 一行不存；你的脚本改为 generate + verify 两模式 · 2026-09-19T15:00Z

> 事实（KANet-UI 只读核）：console 启动时 `index.js:629-630` 无条件 `startAllRelays()`，`relay-manager.js:332-352` 对所有"有 address 且有助记词"的 relay 起子进程，不看 adapter、不看角色，助记词经环境变量进进程。⇒ 持有身份若存进 console，下次重启就变成一个跑着的 relay。
> 裁定：持有钥匙**不进 console**。Owner 用你的离线脚本生成、抄两份分开保管；console 不建 relay 行；地址与 x-only 公钥进 provenance。

## 你写的脚本（`scratch/`，≤ 60 行，随信箱贴全文；Owner 在自己终端运行，任何 agent 不运行）

- `generate` 模式：**不连网、不写文件、不读 env**；kaspa-wasm 生成 24 词助记词；派生主网地址与 x-only 公钥；屏幕打印三者一次，末尾提示"抄两份后关闭窗口并清屏"。
- `verify <address>` 模式：隐藏输入助记词（不回显、不进历史）；本地派生地址；与参数比对；**只打印 `match=true` 或 `match=false`**，不打印助记词、不打印派生地址。
- 两模式共用同一派生路径，写死并注明（与 console `addressFromMnemonic` 同一路径，贴 file:line，保证将来若需导入 console 或钱包时地址一致）。
- 自测：用一个你自己生成的临时助记词跑 generate → verify，贴两条命令的输出（当然不贴那个临时助记词本身）。

侦察里 `ownerKey` 分离那一问仍是第一优先。— Bettor
