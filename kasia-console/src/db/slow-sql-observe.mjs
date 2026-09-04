// slow-sql-observe.mjs — M10 v3-A observe-only: 在 better-sqlite3 驱动边界记慢 SQL (2026-09-05, Bettor 批·六硬条件 + NWT C1-C5; 设计 scratch/_j2_m10v3_spec_2026-09-04T22-33Z.md §1A).
// 给一个 Database 实例的 prepare() 套一层: 返回的 Statement 用 Proxy 包住, 只拦 .all/.get/.run 计时;
//   ≥ slowMs 才打一行:  [diag:step] sql.<all|get|run> ms=<n> rows=<n|-> sql="<去空白截80>" src=<caller file:line> at=<ISO>
//   (NWT C1: at= 必须是时间戳, 与 v2 全部行/readout 正则 `at=(\S+)` 同契约; 调用点用 src=)
// 硬条件(Bettor 1-4 / NWT C2-C3):
//   1. fail-open: 计时/取栈/拼日志任何一步抛错都吞掉; 原语句照常执行; 返回值/异常对象/this 不变。
//   2. 只拦 all/get/run; 其它方法一律 v.apply(target, args)(C++ 方法以 Proxy 为 receiver 会 Illegal invocation);
//      返回 `this` 的链方法(raw/pluck/expand/bind/safeIntegers…) 若返回 target 则换回 Proxy ⇒ 链后的 all/get/run 仍计时
//      (覆盖仓内 monitor-service.js:62 的 .pluck() 与 drizzle 内部 stmt.raw().get/all)。非函数属性(reader/source/database)原样。
//   3. 只记 SQL 文本(截 80), 不记 bind 参数; 栈只在 ≥slowMs 时取, 取一层 caller file:line 即止。
//   4. 阈值 env DIAG_SQL_SLOW_MS 可调(默认 200); 0/负/非数 ⇒ 不安装(prepare 原样, 回滚不用改码)。
//   C3. rows: all=length, get=0/1, run=info.changes, 抛错=-; 返回对象原样(lastInsertRowid 等不动)。
//   位置: 只挂在 db/client.js 的 sqlite 实例上(pragma 之后、drizzle(sqlite) 之前); prepare() 本身不计时不改(编译期抛错原样);
//   drizzle 也经同一个 prepare ⇒ 一并覆盖; sqlite.exec/pragma/transaction 本身不包(transaction 内的语句各自计时, 不双计)。
// 测试(M0a 门: 测试文件不得裸 import better-sqlite3): 安装后把 {slowMs, log} 挂在 db.__slowSqlObserver(不可枚举)上, 计时闭包
//   每次调用读它 ⇒ 测试经 DB_PATH=临时库 import client.js 拿到实例后改阈值/日志即可, 不需要第二个 Database。

export const DEFAULT_SLOW_MS = 200;
export const STATE_KEY = '__slowSqlObserver';
const TIMED = new Set(['all', 'get', 'run']);

export function resolveSlowMs(env = process.env) {
  const raw = env.DIAG_SQL_SLOW_MS;
  if (raw == null || raw === '') return DEFAULT_SLOW_MS;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;   // 0 = off
}

function _sqlHead(sql) {
  try { return String(sql).replace(/\s+/g, ' ').trim().slice(0, 80); } catch { return '?'; }
}

// 取第一层不在本文件/驱动内部的调用帧, 形如 src/services/x.js:703 (路径去到 kasia-console/ 之后); 取不到 ⇒ '?'
export function callerFrame(stack, selfMarker = 'slow-sql-observe.mjs:') {
  try {
    const lines = String(stack || '').split('\n').slice(1);
    for (const l of lines) {
      if (l.includes(selfMarker) || l.includes('node:internal') || l.includes('better-sqlite3')) continue;
      const m = l.match(/(?:\(|\s)((?:file:\/\/\/)?[^\s()]+?):(\d+):\d+\)?\s*$/);
      if (!m) continue;
      let p = m[1].replace(/^file:\/\/\//, '').replace(/\\/g, '/');
      const i = p.lastIndexOf('kasia-console/');
      if (i >= 0) p = p.slice(i + 'kasia-console/'.length);
      return `${p}:${m[2]}`;
    }
  } catch { /* observe-only */ }
  return '?';
}

function _rowsOf(name, out) {
  try {
    if (name === 'all') return Array.isArray(out) ? out.length : '-';
    if (name === 'get') return out === undefined ? 0 : 1;
    if (name === 'run') return out && typeof out.changes === 'number' ? out.changes : '-';
  } catch { /* observe-only */ }
  return '-';
}

/**
 * installSlowSqlObserver(db, {slowMs, log}) — 就地替换 db.prepare。返回 true = 已安装, false = 阈值 0 未安装。
 * 幂等: 已安装过的实例再调用不重复包(state 保留原样)。state = db[STATE_KEY] = { slowMs, log }(计时闭包每次读, 可被测试改)。
 */
export function installSlowSqlObserver(db, { slowMs = resolveSlowMs(), log = console.log } = {}) {
  if (!db || typeof db.prepare !== 'function') return false;
  if (!(slowMs > 0)) return false;
  if (db[STATE_KEY]) return true;
  const state = { slowMs, log };
  const origPrepare = db.prepare;
  const wrappedPrepare = function prepare(sql, ...rest) {
    const stmt = origPrepare.call(this, sql, ...rest);   // 编译期错误原样抛出(不在诊断路径上)
    let head = null;
    const cache = Object.create(null);   // 每个 Statement 一份, 零重复分配(NWT nit b)
    let proxy;
    const timed = (name) => function (...args) {
      const t0 = Date.now();
      let out, threw = true;
      try {
        out = stmt[name](...args);   // this = 原 Statement(非 Proxy); 异常对象原样透出
        threw = false;
        return out;
      } finally {
        try {
          const ms = Date.now() - t0;
          if (state.slowMs > 0 && ms >= state.slowMs) {   // NWT: 运行期 state.slowMs 被改成 0 也是"关", 不是"全打"
            if (head == null) head = _sqlHead(sql);
            state.log(`[diag:step] sql.${name} ms=${ms} rows=${threw ? '-' : _rowsOf(name, out)} sql=${JSON.stringify(head)} src=${callerFrame(new Error().stack)} at=${new Date().toISOString()}`);
          }
        } catch { /* observe-only: 诊断路径任何错误都吞掉 */ }
      }
    };
    const passthrough = (fn) => function (...args) {
      const r = fn.apply(stmt, args);   // C2: receiver 永远是原 Statement
      return r === stmt ? proxy : r;    // 链方法返回 this ⇒ 换回 Proxy, 链后 all/get/run 仍计时
    };
    proxy = new Proxy(stmt, {
      get(t, k) {
        if (typeof k === 'string' && TIMED.has(k)) return cache[k] || (cache[k] = timed(k));
        const v = Reflect.get(t, k, t);
        if (typeof v !== 'function') return v;   // reader/source/database 等原样
        const ck = typeof k === 'string' ? k : null;
        if (ck && cache[ck]) return cache[ck];
        const w = passthrough(v);
        if (ck) cache[ck] = w;
        return w;
      },
    });
    return proxy;
  };
  db.prepare = wrappedPrepare;
  try { Object.defineProperty(db, STATE_KEY, { value: state, enumerable: false }); } catch { /* observe-only */ }
  return true;
}
