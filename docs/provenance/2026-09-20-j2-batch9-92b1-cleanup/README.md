# 批9 9-2b (i)：清理 + F3-1（无运行时效果）

> **Status**: CURRENT（设计 §19.2 清单 1、10、11、12；分支 `coord/j2-batch9-92b-driver-core-v0`，基于 9-2a `ed6bb165`）

- F3-1：pointers 测试补 `covenantId` 抛错路径的 `TransactionOutput`/`Transaction` 创建数 == 释放数
- 清理：c1 / chain-checks 测试删掉"起临时 DB 只为过 import 链"的 bootstrap，换成"无 `DB_PATH` 子进程逐模块真 import"守卫
- 共享扫描器 `kasia-console/test-fixtures/source-scan/` → `shared/test-fixtures/source-scan/`（两包可引用；旧路径留 re-export 兼容层，KANet-UI 的 D26-scan 分支旧 import 不断）；relay `utxo-facts.test.mjs` 那份简单正则 `stripComments` 改用共享状态机版
- F5-1：扫描器自测补两条"注释里的引用不报"对照

测试末行：pointers 27/0、c1 45/0、chain-checks 51/0、scan 10/0、utxo-facts 42/0、claim-draw（引用共享扫描器）见下；变异 `mutants=6 survivors=0`（`mutation-raw.txt`）；lint `lint.txt`。
**超出设计条目**：旧路径 re-export 兼容层；扫描器排除前缀加 `shared/test-fixtures/`。
57 passed, 0 failed
