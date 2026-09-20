# relay 钱包认 simnet（9-4 前置，一行逻辑）

- 改动：`kasia-relay/src/lib/wallet.mjs` `getNetworkType` 加 `case 'simnet': return NetworkType.Simnet;`（`getGeneratorNetworkId` 不动）。
- 病因：relay 起在 simnet 时 `relay.mjs` 顶层 `getWallet().getAddress()` 抛 `Unsupported network type: simnet` ⇒ relay 起不来。
- 测试末行：`wallet-simnet.test: 6 passed, 0 fail`；既有 `wallet.test` ALL PASS；变异 4/4 红（删 case / simnet 映射错 / mainnet 映射错 / default 放开）；lint 0 errors。
- 逐字对照：现 `getNetworkType` 删掉 simnet 那一行后与基线 `cd0b9f88` 逐字相同（夹具 `test-fixtures/wallet-simnet/`）；整个文件里 simnet 字样只出现在新增那一行。
- 只用进程内 randomBytes 的一次性密钥，不读不打印真实密钥。
