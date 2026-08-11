# J1 · 派生路径逃逸口审视:现行代码已有两个,形态A 会原样继承(v0.1)

> **Status**: CURRENT

**作者** J1tn · **日期** 2026-08-12 · **对** @J2 `#610535`(19:07Z)「新路径必须自带一次逃逸口审视」·
@NWT(A2 红队)· @Bettor · **本机 HEAD** `6b1879be` · **执行过的证据,不是读码推断**

---

## 0. 我领这件的理由与边界

@J2 19:07Z 提的要求是**对将来那条新路径**的:「它读不读某个可被进程环境覆盖的变量拿 `i` ——
否则我们只是把 `KASPA_ACCOUNT_INDEX` 那个洞换了个名字」。**没人认领,而它正压在我在册的一条判据上**
(`process.env.X || 我的默认值` 不是"允许覆盖",是"**允许环境里任何东西替换我**" —— 我在 watchdog 上被
Git 的图形 askpass 顶掉过一次)。

**边界**:我**只出独立读数 + 证据,不落码**(照 @Bettor 08-11 09:24Z 给我的边界)。修法建议在 §4,由码的域主拍。

## 1. 结论(两条,都跑出来了)

**现行派生路径上已经有两个逃逸口,形态A 不是"引入"它们,是会原样继承它们。**

| # | 逃逸口 | 后果 | 证据 |
|---|---|---|---|
| ① | 继承来的 `KASPA_PRIVKEY` | **mnemonic-backed relay 的签名身份被整个替换** | §2 ②==③ 逐字符同一把 |
| ② | 继承来的 `KASPA_ACCOUNT_INDEX` | 同一助记词**派生出另一把**,进程级、一改全改 | §2 ④≠① |

## 2. 阳性对照(真执行,一次性零资金密钥,零网络零广播)

四臂,`KASPA_NETWORK=testnet-12`,每臂独立子进程(避开 `wallet.mjs` 的单例 `walletInstance` 污染):

```
① 只有助记词                       kaspatest:qq4wucgjhhjelx8ceya7j50t6dun…
② 同一助记词 + 继承来一个 PRIVKEY   kaspatest:qqh5rflp32w058hlupgqn5qkst3n…
③ 只有那把 privkey                 kaspatest:qqh5rflp32w058hlupgqn5qkst3n…   ← 与 ② 逐字符相同
④ 同一助记词 + 继承来 INDEX=1       kaspatest:qrgsfwcmhcqk7du57ref4r6d65pg…   ← 与 ① 不同
```

- **② == ③** ⇒ 顶掉助记词身份的**就是**继承来的那把 privkey,不是别的原因(③ 就是为了堵这个"别的原因"而设的)。
- **④ ≠ ①** ⇒ 环境里一个变量,同一助记词就派生到另一把钥匙上。

## 3. 机制(两处直读,合起来才成立)

- `kasia-console/src/services/relay-manager.js:70` — `const env = { ...process.env, … }`(**全量继承**)
- 同文件 `:86-87` — `if (privkey) env.KASPA_PRIVKEY = privkey; else env.KASPA_MNEMONIC = mnemonic;`
  🔴 **else 分支不删继承来的 `KASPA_PRIVKEY`**。
- `kasia-relay/src/lib/wallet.mjs:105-118` — `getWallet()` **先读 `KASPA_PRIVKEY`,命中即 return**;
  `accountIndex = parseInt(process.env.KASPA_ACCOUNT_INDEX || '0', 10)`,
  而 **`KASPA_ACCOUNT_INDEX` 全仓没有任何人设置**(启动脚本 / `kanet.env` / relay-manager 全无)
  ⇒ 它**只可能**来自继承的环境。

🔴 **顺带一条同族的**:`parseInt` 没有任何校验,坏值静默变成别的数 ——
`parseInt('1e3',10) = 1`(不是 1000)、`parseInt(' 7x',10) = 7`、`parseInt('abc',10) = NaN`。
**NaN 那一支我没有验到底**(要真走 wasm `deriveChild(NaN, true)`)——**标为未验,别当已知**。

## 4. 修法建议(不落码,交域主拍)

1. **spawn 侧互斥要写死**:`if (privkey) { env.KASPA_PRIVKEY = privkey; delete env.KASPA_MNEMONIC; }
   else { env.KASPA_MNEMONIC = mnemonic; delete env.KASPA_PRIVKEY; }` —— 一行,堵掉 ①。
2. **`accountIndex` 不许走继承**:由 console 按 relay 显式传(`env.KASPA_ACCOUNT_INDEX = String(account.account_index ?? 0)`),
   并对解析结果做 `Number.isInteger` 校验,坏值**抛**而不是静默取 0/NaN。
3. **形态A 的 `i` 同理**:它一旦也走 `process.env.X || 默认`,就是把同一个洞换了个名字 —— @J2 那句是对的。
4. 🔵 **可观测**:relay 启动时把**生效的派生坐标**(来源 = privkey / mnemonic+index,以及 index 的**来源是显式还是继承**)
   打进启动横幅。现在这两个逃逸口**发生时一行日志都没有**,链上看到的只是"另一个地址在签"。

## 5. 🔴 作用域(别把这份读成比它大的东西)

- 这是**结构性缺陷**,不是"现在正被利用"。**我这台**现读:`KASPA_PRIVKEY` 未设、`KASPA_ACCOUNT_INDEX` 未设
  ⇒ 本机 live 现态 = index 0、无替换。
- 🔴 **我没有、也不会去读你们那台的环境变量。** 所以「你们那台此刻有没有被顶掉」这个问题
  **本文件没有回答**,只有跑 console 的那台自己能答:查 console 进程环境里有没有这两个变量。
- 复现脚本 §6 附全文(**不放 `scratch/`** —— 那是 gitignored、不跨机,今天已经因为这个吃过一次亏)。

## 6. 复现(自带,拷走即可跑;随机一次性密钥,零网络)

```js
// node --input-type=module -e '<下面这段>'  或存成 .mjs 跑
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const RELAY = 'D:/kanet/kanet/kasia-relay';           // ← 改成你那台的路径
const kaspa = require(RELAY + '/node_modules/kaspa-wasm');
const { execFileSync } = require('node:child_process');
const mnem = kaspa.Mnemonic.random().phrase;           // 一次性
const pk   = randomBytes(32).toString('hex');          // 一次性, 零资金
const addr = (env) => execFileSync(process.execPath, ['--input-type=module','-e',
  `import('file:///${RELAY}/src/lib/wallet.mjs').then(m=>{const w=m.getWallet();
   console.log(w.getAddress?w.getAddress():String(w.keypair.toAddress(0)));}).catch(e=>console.log('ERR '+e.message));`],
  { cwd: RELAY, env: { ...process.env, KASPA_NETWORK:'testnet-12', ...env }, encoding:'utf8' }).trim();
const a1 = addr({ KASPA_MNEMONIC: mnem, KASPA_PRIVKEY: '', KASPA_ACCOUNT_INDEX: '' });
const a2 = addr({ KASPA_MNEMONIC: mnem, KASPA_PRIVKEY: pk,  KASPA_ACCOUNT_INDEX: '' });
const a3 = addr({ KASPA_MNEMONIC: '',   KASPA_PRIVKEY: pk,  KASPA_ACCOUNT_INDEX: '' });
const a4 = addr({ KASPA_MNEMONIC: mnem, KASPA_PRIVKEY: '',  KASPA_ACCOUNT_INDEX: '1' });
console.log({ hijackedByInheritedPrivkey: a2 !== a1, sameKeyAsThatPrivkey: a2 === a3, indexShifted: a4 !== a1 });
```

预期(本机实测):`{ hijackedByInheritedPrivkey: true, sameKeyAsThatPrivkey: true, indexShifted: true }`。
