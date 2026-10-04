# KANet-UI 交件：6 个主网委员钱包置 is_oracle=1（账本 1837 第 ② 步）

作者自报；请 Bettor 独立核。无 env 改动、无重启、无资金动作。未碰 C:\KANet。

## 做法
1. 备份：better-sqlite3 在线 `.backup`（源只读打开），`kasia-console/data/backups/console.mainnet.pre-is-oracle-20261004.db`，74473472 B，sha256 `277ced352df9b9c2c833429b2febeaf4142b3469505f288771f37e7b46484d20`；九表行数源=备份全 match（relay_nodes 24）。
2. 库：`DB_PATH` 取自 `kanet.mainnet.env`（只 grep 该行），即 `kasia-console/data/console.mainnet.db`。列 = `relay_nodes.is_oracle INTEGER DEFAULT 0`（migrate v124）。
3. 写前 SELECT：`oracle-mn-01..06` 共 6 行，network=mainnet，is_oracle 全 0，role 全 null；全库 is_oracle=1 为 0；地址与 ASSET-INVENTORY 二·附逐个一致。经 Bettor 看过并回 go。
4. 写：一个事务，`UPDATE relay_nodes SET is_oracle=1 WHERE is_oracle=0 AND name LIKE 'oracle-mn-%' AND id IN (6 个 id)`，只动这一列；`changes()==6` 否则回滚。实际 changes=6，提交。

## 写后 SELECT
| name | id | is_oracle | role |
|---|---|---|---|
| oracle-mn-01 | 1c38742a-31c8-466e-b6d3-138027821c1e | 1 | null |
| oracle-mn-02 | ee93890e-d6e6-4590-a3f8-f8adf59b0819 | 1 | null |
| oracle-mn-03 | a8593afc-f089-435d-8881-4ee0809c55c4 | 1 | null |
| oracle-mn-04 | b2ba6db2-b772-4de3-a9a2-1c59b4a00341 | 1 | null |
| oracle-mn-05 | b201f032-2dee-4134-950b-963f28a90861 | 1 | null |
| oracle-mn-06 | 74278338-eace-4395-84c7-ba2a1c5c1157 | 1 | null |

全库 is_oracle=1 共 6 行，relay_nodes 总数仍 24。console :3202 写后 `/api/oracle-pool/state` 200。

## 注意
- 运行中的 console 不一定热读这列；是否生效、是否需要重启，按第 ④ 步（Owner GO 后重启 console）。我没重启。
- 回滚：从上述备份还原 relay_nodes.is_oracle，或对这 6 个 id 置回 0。
- 脚本：`kasia-console/scratch/_kanetui_set_is_oracle.mjs`（gitignored）。
