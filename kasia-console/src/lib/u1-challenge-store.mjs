// u1 · N8 一次性挑战存储 —— **结构绑定到某一个 SQLite 事务域**
// 承接: Codex c0a1f50c 复核 96b6121b = NOT FULLY CLOSED · @Bettor (354) 采纳 option A。
//
// 🔴 **它解决的是什么(别读成"又一层封装")**:
//    上一版把 `consumeChallenge` / `readChallenge` 收成两个**自由函数**, 并声称
//    "BEGIN IMMEDIATE + 前置读 + 消费 + 后置读 = 真 CAS, 且不要求调用方自己实现 CAS"。
//    **那句话的作用域是错的** —— `.immediate` 只序列化【身份表所在的那个连接】。
//    挑战存储若坐在**另一个连接 / 另一个库**上, 我持的锁管不到它, 那四步就不是原子的。
//    ⇒ 原子性不是"写法"能挣来的, 它**只在同一个事务域内成立** ⇒ 存储必须**结构上**被钉在那个域里。
//
// 🔨 **为什么用模块私有 WeakMap, 不用 Symbol / 不用鸭子类型检查**:
//    鸭子类型(`typeof s.consume === 'function'`)与 Symbol 标记都是**可以伪造**的 ——
//    任何人构造一个长得像的对象就绕过去了, 那还是"靠调用方自觉", 正是 Codex 判不合格的那一档。
//    WeakMap 的成员资格**没有外部入口**: 只有本模块的 `createChallengeStore()` 能写进去。
//    ⇒ 未绑定事务域的 store **在结构上进不来**, 不是"检查时被拦下"。
//
// ⚠ 表 schema 按 Codex 可 post-land: 本工厂**要求表已存在**, 不自建表、不碰 migrate.js。

const BOUND = new WeakMap();   // store 对象 → { sqlite, table } —— 唯一写入口在下面的工厂

// 🔴 (370) Codex e008bbbc 第七级: 上一版绑定只记 handle, **不记表身份** ⇒ 持合法 handle 的调用方
//    可以造一个指向【他自己那张表】的 store(里面塞永不过期、永远 unused 的挑战), 绑定检查照过。
//    ⇒ 生产路径必须钉死【规范表】; 表名不是调用方能选的东西。
export const CANONICAL_CHALLENGE_TABLE = 'u1_identity_challenge';

/**
 * 造一个绑定到 `sqlite` 这个事务域的一次性挑战存储。
 * @param {object} sqlite  better-sqlite3 handle —— **必须与 registerIdentity 收到的是同一个对象**
 * @param {string} table   挑战表名(需已存在; 列: challenge TEXT PK, used_at INTEGER, expires_at INTEGER)
 */
export function createChallengeStore(sqlite, table) {
  if (!sqlite || typeof sqlite.prepare !== 'function') {
    throw new Error('createChallengeStore: 需要一个可用的 better-sqlite3 handle');
  }
  if (typeof table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    // 🔴 表名要拼进 SQL(不能参数化), 所以只收白名单形状的标识符 —— 不是洁癖, 是注入面。
    throw new Error(`createChallengeStore: 表名非法(只允许 [A-Za-z_][A-Za-z0-9_]*): ${table}`);
  }
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!exists) {
    // fail-closed: 表不存在就别造一个"看起来能用、其实每次都查空"的 store。
    throw new Error(`createChallengeStore: 表 ${table} 在这个 handle 上不存在(schema 未落 or handle 拿错)`);
  }

  const readStmt = sqlite.prepare(`SELECT challenge, used_at, expires_at FROM ${table} WHERE challenge = ?`);
  // 🔴 消费必须是 CAS(`WHERE used_at IS NULL`), 不是无条件 SET ——
  //    无条件 SET 会让"已被别人用掉"读起来仍像成功。SQL 归 store 自己拥有, 正是为了
  //    **不让调用方有机会把它写成非 CAS**(上一版就是把这件事托付出去才出的洞)。
  const consumeStmt = sqlite.prepare(`UPDATE ${table} SET used_at = ? WHERE challenge = ? AND used_at IS NULL`);

  // 🔴 (374) 权威实现【留在模块里】, 不挂到返回给调用方的对象上。
  //    返回的 store 是一个**不透明 token**: 它自己没有任何 authority-bearing 方法可供替换。
  const ops = {
    read(challenge) {
      const r = readStmt.get(String(challenge));
      return r ? { challenge: r.challenge, usedAt: r.used_at, expiresAt: r.expires_at } : null;
    },
    consume(challenge, nowMs = Date.now()) {
      const info = consumeStmt.run(nowMs, String(challenge));
      if (info.changes !== 1) {
        throw new Error(`挑战不可消费(不存在 / 已被用掉): ${challenge}`);
      }
    },
  };
  Object.freeze(ops);   // 弱兜底: 即使将来某处不慎泄漏了引用, 方法也改不掉(承重的仍是不导出能力)
  // token 本身不带方法 —— 调用方拿到的是一个冻结的空壳, 换不掉任何东西(它上面本来就没有东西)。
  const store = Object.freeze({ __u1ChallengeStoreToken: true });
  BOUND.set(store, { sqlite, table, ops });
  return store;
}

/**
 * 这个 store 是不是【本模块造的】且【绑在 expectedSqlite 这个事务域上】。
 * 外部无法把自己塞进 BOUND_HANDLE ⇒ 伪造的 store 在这里必然 false。
 */
export function isStoreBoundTo(store, expectedSqlite, expectedTable) {
  // 🔴 (372) expectedTable **必填, 缺参即拒** —— 上一版把它做成可选(`expectedTable !== undefined` 时才比),
  //    那意味着**将来任何一个两参调用会静默退回只验 handle**, 而 (370) 那个洞就原样回来了,
  //    且没有任何东西会喊。可选参数 = 少传一个就静默降级, 与 (343) 的 optional consumeChallenge 同族;
  //    今晚唯一调用点已武装所以不急这个论证已被推翻两次((364) 命名约定 / (359) 书面要求)。
  //    ⇒ 不留这个形状。
  // 🔨 **为什么是 throw 不是 return false**(@Bettor 指定, 我认): 缺参是**编程错误**, 不是运行时输入错误。
  //    返回 false 会被"某个忽略返回值 / 只在 if 里用一半"的调用点悄悄吞掉, 而 throw 吞不掉。
  //    ⚠ 且它**永远不可能被外部输入触发** —— 唯一调用点固定传三参, 所以 throw 不会变成可被打的拒绝路径。
  if (expectedTable === undefined) {
    throw new Error('isStoreBoundTo: expectedTable 必填 —— 缺它会静默退回只验 handle, 而 (370) 那个洞就原样回来了');
  }
  if (typeof expectedTable !== 'string' || expectedTable === '') return false;
  if (!store || typeof store !== 'object') return false;
  const b = BOUND.get(store);
  if (!b) return false;
  // 两维都要 —— handle **且** 表身份。只验 handle 时, 指向别的表的 store 照样过。
  return b.sqlite === expectedSqlite && b.table === expectedTable;
}

// 🔴🔴 (376) Codex 80b34870 第九级: 上一版导出 `getBoundOps()` 并 `return BOUND.get(store).ops`
//    —— 交出去的是 registration **正在用的那个可变对象**。持真 token 的调用方自己调一次就拿到它,
//    改掉 `leaked.read/consume` 即可让 registration 信任被改过的实现。
//    🔨 **我把方法移出了 token, 却把保险柜的钥匙导出了。** (374) 那个洞换了一道门重开。
//
// 🔨 **现在的不变式(照 @Bettor 定的原话)**: 调用方**可以持有 token**, 但**永远拿不到、也替换不了** read/consume 能力。
//    ⇒ 不再有任何导出会返回 op 对象。改为两个**动词式**导出: 各自先验绑定 → 跑模块私有 op → 只返回**数据**。
//    🔵 判据: **别导出能力, 导出动作** —— 能力可以被握住和改写, 动作做完就没了。

/** 读一条挑战记录(先验绑定)。返回纯数据快照, 不返回任何函数。 */
export function readBoundChallenge(store, expectedSqlite, expectedTable, challenge) {
  if (!isStoreBoundTo(store, expectedSqlite, expectedTable)) {
    throw new Error('readBoundChallenge: store 未绑定到 (本次 sqlite 事务域 ∧ 规范表) — 拒');
  }
  return BOUND.get(store).ops.read(challenge);
}

/** 消费一条挑战(先验绑定)。CAS 语义在模块私有 op 内, 调用方无从改写。无返回值。 */
export function consumeBoundChallenge(store, expectedSqlite, expectedTable, challenge, nowMs) {
  if (!isStoreBoundTo(store, expectedSqlite, expectedTable)) {
    throw new Error('consumeBoundChallenge: store 未绑定到 (本次 sqlite 事务域 ∧ 规范表) — 拒');
  }
  BOUND.get(store).ops.consume(challenge, nowMs);
}
