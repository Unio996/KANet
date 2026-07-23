// M0c-1 app provision — grant registry schema 单一真相源
// 设计: docs/2026-07-23-m0c-1-app-provision-design.md §2 (grant 绑定字段) + 母卡 §4.2 (relay-authoritative 防 grant inflation)
// migrate.js v190 与 operator provision 脚本 (scripts/m0c1-grant-provision.mjs) 共用本 DDL, 防两处漂移。
//
// 🔴 写入方静态可枚举 (母卡 §4.3 / M1-5): 仅 operator 离线脚本 scripts/m0c1-grant-provision.mjs 一处
//    (migrate v190 只建表不写行)。任何 HTTP handler / IPC handler / daemon tick 出现本表写入
//    = 实现批 diff 审直接打回。运行时自注册禁止。
// 读取方: kasia-relay/src/lib/grant-registry.mjs (readonly fresh 读, authorizeAppCommand gate 评估)。
// 乙路 TCB 诚实边界 (§1): 本表宿主在 Console 可达信任域内 — 对场景 A (应用伪造不了 operator 签发的
//    grant) 有效, 对场景 B (被攻陷 Console 直接改表自授权) 无效, 抗场景 B 需 R 收口。禁称"抗 Console"。

export const M0C1_GRANT_TABLE = 'm0c1_app_grants';

// 时间列全 INTEGER unix 秒 (SQLite ISO 字符串按字典序比较陷阱, 见 memory reference-sqlite-iso-timestamp-string-compare-trap)。
// scope 维度列 NULL 语义 = 该维度未授权 (缺维度默认最严, M0c-2 §3 同纪律): intent 触及该维度即拒,
// 不是"不限制"。operator 要放开某维度必须显式写入集合/上限。
export const M0C1_GRANT_DDL = `
  CREATE TABLE ${M0C1_GRANT_TABLE} (
    grant_id TEXT PRIMARY KEY,
    app_key_id TEXT NOT NULL,
    app_pubkey TEXT NOT NULL,
    allowed_commands TEXT NOT NULL,
    typed_intent_version INTEGER NOT NULL DEFAULT 1,
    relay_scope TEXT NOT NULL,
    network TEXT NOT NULL,
    market_scope TEXT,
    outpoint_scope TEXT,
    branch_scope TEXT,
    payee_scope TEXT,
    max_amount_sompi INTEGER,
    max_cumulative_sompi INTEGER,
    max_fee_sompi INTEGER,
    valid_from INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    grant_version INTEGER NOT NULL DEFAULT 1,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    provisioned_by TEXT NOT NULL DEFAULT 'operator-offline-script'
  );
  CREATE INDEX idx_m0c1_grants_app_key ON ${M0C1_GRANT_TABLE}(app_key_id);
`;
