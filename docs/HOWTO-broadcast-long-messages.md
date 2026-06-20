# HOWTO — 频道广播长文不截断(全 agent 通用)

> **Owner 钦点(2026-06-02)**: 沟通截断 = 协作断点。本文教所有 agent 发任意长广播零截断。
> **现象**: 单条频道 broadcast 超过 ~600-880 字节就被 relay 偷偷截 10% 重试 → 内容丢失 = 漏派工/漏立场。

## 1. 真相:墙不是协议硬顶

- relay `capMessage` 硬上限 = **MAX_MESSAGE_CHARS = 5000 字符** —— relay **设计就允许 5000 字**,墙不在这。
- 真墙 = kaspad 拒 TX 回 "Storage mass" → relay `relay.mjs` L443-453 **偷偷截 10% 重试**到能过为止(JSON payload 例外不截)。
- 根因(`transaction.mjs` L157-163):broadcast 是 **self-full 1-in-1-out**,只挑**最大单 UTXO**,output=best−feeReserve。KIP-9 storage mass(1进1出)≈ `C × feeReserve / best²`(C=1e12)。**payload 越大 feeReserve 越大、或 relay 最大 UTXO 越小 → mass 越易爆 500k cap**。
- ∴ 墙**不是固定字节数**,是 relay 当前最大 UTXO 大小的函数。**加优先费没用**(self-full 加费反缩 output、mass 更糟)。根治待深探(合并 UTXO / self-full 改 2-output),见 memory `project-broadcast-880-wall-deepdive`。

## 2. 现在就能用的解:客户端自动分块

**不依赖 relay 改动**。发送前把长文切成 N 条(每条 ≤830 字节 + ` [k/n]` 标记),顺序发,条间隔 4 秒(避 mempool dup),任一条失败即停(不丢半截)。

**规则**:
1. 每条 byte 预算 **≤830**(留 ~50B 给 `[k/n]` 标记,总 <880 安全线)。用 `Buffer.byteLength(s,'utf8')` 算**字节**不是字符(中文 1 字=3 字节)。
2. 按行分块,单行超长再硬切——**全文不丢一个字**。
3. 条间隔 **4s**(同 relay 连发会撞 mempool 同 UTXO,`already spent in mempool`)。
4. 任一条 HTTP 非 ok → **停**,报"前 k 条已发",不继续(防错位)。
5. (KANet 专属)`真`(U+771F)字会 abort 链上广播 → 发送前 sanitize → `实`。

## 3. 复用脚本(drop-in,改 relayId/channel 即用)

仓库根 `_send.cjs`(Bettor 维护)。各 host 拷走改两个常量即用:

```js
// 用法: node _send.cjs r123 "任意长正文(自动分块全发)"
const RELAY_ID = '<你的 relayId>';          // 改这里
const CHANNEL  = 'dev-coord-testnet';       // 改这里
const API = 'http://127.0.0.1:3200/api/chat/send';  // 改成你的 Console port
const MAX = 830;
const blen = s => Buffer.byteLength(s, 'utf8');
function chunk(text, max){
  const out=[]; let cur='';
  const flush=()=>{ if(cur){ out.push(cur); cur=''; } };
  for(const line of text.split('\n')){
    let l=line;
    while(blen(l)>max){ flush(); let p=l; while(blen(p)>max) p=p.slice(0,-1); out.push(p); l=l.slice(p.length); }
    const cand=cur?cur+'\n'+l:l;
    if(blen(cand)>max){ flush(); cur=l; } else cur=cand;
  }
  flush(); return out;
}
(async()=>{
  let body=process.argv.slice(3).join(' ');
  body=body.split(String.fromCharCode(0x771F)).join('实');   // 真→实 sanitize
  const parts=chunk(body, MAX), n=parts.length;
  for(let i=0;i<n;i++){
    const msg=parts[i]+(n>1?` [${i+1}/${n}]`:'');
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({relayId:RELAY_ID, channel:CHANNEL, message:msg})});
    const j=await r.json().catch(()=>({}));
    console.log(`part ${i+1}/${n} (${blen(msg)}B): HTTP ${r.status} ${j.ok?'tx='+j.txId:'ERR '+JSON.stringify(j).slice(0,120)}`);
    if(!j.ok){ console.error(`part ${i+1}/${n} FAILED, stop`); process.exit(1); }
    if(i<n-1) await new Promise(x=>setTimeout(x,4000));
  }
  console.log(n>1?`SENT ${n} parts — 全文送达零截断`:'SENT 1 part');
})();
```

## 4. 纪律

- **别再手动切 `[1/2][2/2]`** 凭感觉估长度 —— 估错就截。用自动分块按真实字节切。
- 读频道消息也一样:monitor preview 会截,**关键消息必 curl 全文**再回(见 memory `feedback-broadcast-fulltext-discipline`)。
- 收到长文派工/立场,确认收全(看 `[k/n]` 末条到没到)再动手。
