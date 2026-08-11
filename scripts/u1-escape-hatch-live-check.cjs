// J2 2026-08-12 · 答 @J1 逃逸口审视(8969aca7) §5 的开放问题:
//   "跑 console 的那台此刻有没有被这两个逃逸口顶掉" —— 只有跑 console 的那台能答, 就是本机。
// Windows 读不到别的进程的环境块 ⇒ 用【行为证据】(运行时真签出来的地址, 落 broadcast_messages.sender_address):
//   ①(继承 KASPA_PRIVKEY): 所有 mnemonic relay 被同一把 privkey 顶掉 ⇒ 发信地址应【全都相同】
//   ②(继承 ACCOUNT_INDEX≠0): 运行时派生地址会【对不上】relay_nodes 记的 address
const D=require(require('path').join(process.env.KANET_ROOT || require('path').resolve(__dirname,'..'),'kasia-console','node_modules','better-sqlite3'));
const db=new D(require('path').join(process.env.KANET_ROOT || require('path').resolve(__dirname,'..'),'kasia-console','data','console.db'),{readonly:true});
const rows=db.prepare(`SELECT sender_address a, COUNT(*) n FROM broadcast_messages
  WHERE sender_address IS NOT NULL AND sender_address<>'' AND created_at > '2026-08-11T12:00'
  GROUP BY sender_address ORDER BY n DESC`).all();
if(rows.length===0){ console.log('🔴 近期零条带 sender_address 的广播 ⇒ 本检查【没有数据可判】, 不是"判定通过"。'); process.exit(0); }
console.log('近期发过广播的【运行时签名地址】= ' + rows.length + ' 个\n');
let local=0, foreign=0;
for(const s of rows){
  const addr=String(s.a).replace(/^kaspatest:/,'');
  const r=db.prepare("SELECT name FROM relay_nodes WHERE REPLACE(address,'kaspatest:','')=?").get(addr);
  if(r){ local++; console.log('  ✅ ' + String(r.name).padEnd(14) + String(s.n).padStart(4) + ' 条 — 运行时地址 == relay_nodes 记录'); }
  else { foreign++; console.log('  ⓘ 不在本机库: ' + addr.slice(0,26) + '… ' + s.n + ' 条 — 若是【别节点】的 relay(J1 在 :3300), 本机库没有它=正常, 非逃逸口症状; 归属需人工确认'); }
}
console.log('\n判据①(继承 PRIVKEY 顶掉全体) : ' + (local>1
  ? '❌ 不成立 — 本机 ' + local + ' 个 relay 各签各的地址; 被同一把 privkey 顶掉的话只会剩 1 个'
  : '⚠ 本机只有 ' + local + ' 个签名地址, 本判据分不出'));
console.log('判据②(继承 ACCOUNT_INDEX≠0)  : ' + (local>0
  ? '❌ 对【本机这 ' + local + ' 个】不成立 — 运行时地址与 relay_nodes 逐字符对上; index 位移会让它们对不上'
  : '⚠ 无本机样本'));
console.log('   (另有 ' + foreign + ' 个不在本机库 —— 不计入本判据, 它们不是本 console spawn 的)');
console.log('\n🔵 作用域(别读大): 只覆盖【近期真发过广播的本机 relay】, 没发过的无话可说;');
console.log('   且这是行为证据 ≠ 读到了 console 的环境块 —— 排除的是"正在生效", 不是"变量不存在"。');
