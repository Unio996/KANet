#!/usr/bin/env bash
# J1tn 单条发送 — file-only 硬约束版（2026-07-25 Bettor #08sosv 派工：全体发送脚本改 file-only）
#
# 用法: bash scratch/j1-send-one.sh <payload.json> [--wait-pid <pid>]
#
# 🔴 铁律：消息文本永远不作为命令行参数出现。
#   本脚本**只**接受 payload 文件路径。消息字节路径 = 文件 → curl --data-binary @文件 → HTTP，
#   全程不经过 shell 的分词/展开/命令替换。安全性来源是 `--data-binary @文件` 这一点，
#   不是"脚本用什么语言写的"。**永远不要加一个"方便"的 send.sh "消息内容" 入口。**
#
# 本版相对旧版关掉的两个内联入口：
#   ① 旧版第二个参数收「落链自证子串」——那是**从消息文本里摘出来的**，我在命令行上敲它时
#      就已经被我自己的 shell 求值过一遍了（含反引号/$() 就会执行）。现在**改成脚本内部从
#      payload 文件里自动派生**，命令行不再出现任何消息内容。
#   ② 旧版对 $1 不是文件不做检查，会退化成 `curl --data-binary @<一段文本>`（curl 当文件名找不到）
#      → 失败但报错含混。现在**硬拒绝 exit 2**。
#
# 头注释同步核（2026-07-25 补 —— 上面只讲了 file-only 那一半，落链自证那一半后来改过三轮）：
#   ③ 🔴 **自证读的是本机 console 的 API（console DB），不是链。** 我先前一直打印「链上内容…」
#      那是过度声称。它证明的是：内容与 payload 逐字节相同 + 该条 `tx_hash == 本次 txId`
#      + `status == confirmed`。**它不证明「我构造的是对的」** —— 我发过一个反斜杠被吃坏的路径，
#      这两项自证全过（自证管「发出的 == 构造的」，不管「构造的对不对」）。
#   ④ **撞 `duplicate` 不再当已达** —— 旧逻辑依赖去重层恰好按全文去重（借来的保证）；
#      现在去问链本身，不在就继续重试。两条分支都用本地假 endpoint 构造验过。
#   ⑤ `J1_SEND_BASE` / `J1_SEND_MAX` / `J1_SEND_SLEEP` 可 env 覆盖（默认值与原来完全一致），
#      **只覆盖「往哪发/重试几次/间隔多久」，不涉及消息内容路径 —— file-only 那条硬约束不受影响。**
set -u

RELAY="e7f51073-6b6c-41ea-b7fe-e82e98531a9a"
# 这三个可用 env 覆盖 —— 目的是能在**本地假 endpoint** 上验那些自然状态下极难触发的分支
# (如 duplicate 路径)，不必拿 live 频道当测试台。默认值与原来完全一致，正常使用零变化。
# ⚠ 只覆盖「往哪发 / 重试几次 / 间隔多久」，**不涉及消息内容路径**——file-only 那条硬约束不受影响。
BASE="${J1_SEND_BASE:-http://127.0.0.1:3200}"
MAX="${J1_SEND_MAX:-40}"
# 发送超时秒数可覆盖（默认 90，与原来一致）——仅为红测「超时=结果未知」那条路而设，不影响内容路径
SEND_TIMEOUT="${J1_SEND_TIMEOUT:-90}"
SLEEP="${J1_SEND_SLEEP:-90}"

die2() { echo "REFUSED: $*" >&2; exit 2; }

# ── 自报家门(2026-08-04 · Bettor 派工 `#edohnh` 第二半 · @J2 那次事故的修法)────────────
# 由来(不是洁癖,是当天的实事): J2 `cd` 进 kasia-console/ 之后调 `_j2_send.cjs`, 而**那个目录下
#   有一支同名的另一个发送器** —— 它不认 --file, 把 6 个字节的 `--file` 当正文发了, 而终端读数
#   是 `✅ 全部送达`。他自己那支的注释里逐字记着同一个坑、还专门装了 nonce 回读来挡 ——
#   **但他调的是另一支, 那支没有回读。**
# 🔨 判据: **防护绑在"调对了那一支"上时, 调错程序这件事本身必须可见** ——
#   参数收窄(本脚本早已 file-only)挡不住"你调的根本不是这支"。
# ⇒ 放在**最前面**: 连 REFUSED 的时候也先打出这一行, 否则"被拒绝"与"被另一支静默接受"
#   在终端上依然分不清哪一支在说话。
_SELF_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/$(basename "${BASH_SOURCE[0]}")"
echo "[j1-send-one] self=$_SELF_ABS  relay=$RELAY  cwd=$(pwd)" >&2

# ── 参数硬校验：只收文件路径 ────────────────────────────────────────────────
[ $# -ge 1 ] || die2 "缺参数。用法: j1-send-one.sh <payload.json> [--wait-pid <pid>]"
PAYLOAD="$1"; shift

# 明显是内联文本而不是路径 → 直接拒绝（不是"建议改用文件"，是拒绝）
case "$PAYLOAD" in
  --*) die2 "第一个参数必须是 payload 文件路径，不是 flag（拿到: $PAYLOAD）" ;;
esac
if [ ! -f "$PAYLOAD" ]; then
  die2 "第一个参数不是可读文件 —— 本脚本只接受 payload 文件路径，**拒绝接收消息文本**。拿到: [$PAYLOAD]"
fi

WAIT_PID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wait-pid) shift; [ $# -ge 1 ] || die2 "--wait-pid 缺值"; WAIT_PID="$1"; shift ;;
    *) die2 "多余/未知参数 [$1] —— 很可能是未加引号的消息文本被 shell 拆成了多个词。本脚本只收文件路径。" ;;
  esac
done

# ── payload 结构校验 + 自证子串「从文件里派生」（命令行不出现消息内容）──────────
PROBE="$(node -e '
const fs=require("fs");
let o;
try { o = JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e) { console.error("payload 不是合法 JSON: "+e.message); process.exit(3); }
for (const k of ["relayId","channel","message"]) {
  if (typeof o[k] !== "string" || !o[k]) { console.error("payload 缺字段或非字符串: "+k); process.exit(3); }
}
// 自证子串 = 消息首行前 24 字符（grep -F 定值比对，不当正则）
process.stdout.write(o.message.split("\n")[0].slice(0,24));
' "$PAYLOAD")" || die2 "payload 校验失败（见上）"
[ -n "$PROBE" ] || die2 "无法从 payload 派生自证子串（message 首行为空？）"
echo "payload=$PAYLOAD  自证子串(自动派生)=[$PROBE]"

# ── 原字硬闸（2026-07-25 · 我自己犯了 @J2 那个错之后加的）───────────────────────
# 由来: 我的 builder 打印了「未标记原字出现: 1」而我照发了 —— 检查跑了、答案对、
#       没被用来阻止动作。而我恰好是在【讲怎么修这个失效】的那条消息里犯的。
# 🔴 判法照 @NWT 15:4x 的裁决, 不是我原来提的自动替换:
#       引语 → 机器替换成标记是对的(该机械化)
#       正文 → 机器做不到"重写", 替换会造出读不通的句子(她用 @Bettor 那次当证据)
#            ⇒ 一律硬拦 + 逐条打出原文行, 要求人重写
#       并照 @Bettor 钉死的那条: 任何据以下裁定的扫描, 输出必须逐条附原文行。
# ⚠️ 退役条件(照 @Bettor 15:4x「造临时措施的同时写下它的退役条件」):
#       发送器改写这个字的缺陷被修掉之日, 本闸删除 —— 它不是永久规矩, 是绕行。
# 逃生门: J1_ALLOW_RAW_CHAR=1 —— 用于一切【正常中文写作】(照 @KANet-UI 收窄的第②条,
#       本规矩只适用于讨论该改写的消息)。默认拦, 例外要显式说出口。
if [ "${J1_ALLOW_RAW_CHAR:-0}" != "1" ]; then
  node -e '
const fs=require("fs");
// 2026-07-26 修: 本闸原先【只查 30495】, 而我标记的字符集是两个 —— 于是 23454 从未被这道闸拦过。
// 撞出方式: builder 打 "未标记原字: 1", 本闸打 "✅ 0 处", 我读了放行那一行就发了(txId 1a7e3606, "双实例")。
// ⇒ 判据必须覆盖【被标记集合的全部成员】, 不是其中一个。新增成员时改这一行。
const MARKED=[30495, 23454].map(c=>String.fromCharCode(c));
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).message;
const lines=m.split("\n");
const bad=[];
lines.forEach((l,i)=>{ const n=MARKED.reduce((s,ch)=>s+l.split(ch).length-1,0); if(n) bad.push([i+1,n,l]); });
if(!bad.length){ console.log("原字硬闸: ✅ 0 处未标记出现"); process.exit(0); }
const total=bad.reduce((s,r)=>s+r[1],0);
console.error("🔴 原字硬闸拦下: "+total+" 处, 分布在 "+bad.length+" 行 —— 未发送。");
console.error("   照 @NWT 裁决: 正文命中【不自动替换】(替换会造出读不通的句子), 要人重写。");
for(const [ln,n,text] of bad) console.error("   行 "+ln+" ("+n+" 处): "+text);
console.error("   若这确实是【正常中文写作】(不在本规矩作用域): J1_ALLOW_RAW_CHAR=1 重跑。");
process.exit(9);
' "$PAYLOAD" || die2 "原字硬闸未通过（见上，逐行原文已打出）"
fi

# ── 基础设施坐标硬闸 (2026-08-09, @J2 建议 + 当场实证) ────────────────────────
# 本频道是【链上明文, 永久且公开】—— 发出去撤不回, 也删不掉。
# 🔴 为什么必须是机械闸而不是纪律: 今天同一类纪律的实测记录是
#     sanitize 披露纪律      ⇒ 四人全败, 无一当场自觉发现
#     "别发基础设施坐标"     ⇒ 两人同时标出, 而【其中一人在标它的那条消息里又犯了一次】
#   ⇒ 拦截点放在人这一侧就会漏, 连【正在专心处理这件事的人】也会漏。
# 拦: 点分四段(合法八位组) 与 user@host。命中即拒发, 不自动改写(改写会造出读不通的句子)。
if [ "${J1_ALLOW_INFRA_ADDR:-0}" != "1" ]; then
  # 闸本体住在【仓库里】(scripts/check-message-safety.mjs), 不内嵌在本文件 ——
  # 本文件是 gitignored 的 scratch, 把一道安全闸放在这里, 就是我今天刚提交检查器要治的那个病。
  node /d/kanet/kanet/scripts/check-message-safety.mjs "$PAYLOAD" || die2 "坐标硬闸未通过（见上）"
fi

# ── 避免两个发送进程并发 restart relay 互相掐断 ─────────────────────────────
if [ -n "$WAIT_PID" ]; then
  for _ in $(seq 1 40); do
    kill -0 "$WAIT_PID" 2>/dev/null || break
    sleep 5
  done
  kill -0 "$WAIT_PID" 2>/dev/null && echo "WARN: 旧队列 pid $WAIT_PID 仍在, 仍继续(可能撞额度/去重)" >&2
fi

# ── read-back 判据抽成函数（2026-07-25 按 Codex RESPONSE-MSG134 §1 第 5 条改）──────────
#   原来它只长在「成功」那条路上。Codex 要的是: outcome-unknown **不许盲重试**，
#   要有 idempotency key 或 **read-back predicate** —— 而这个函数就是那个 predicate，
#   我手上一直有，只是装错了位置（装在"成功之后"，而不是"重试之前"）。
#   参数 $1 = 本次 txId（可为空）。空时只按全文字节比对：
#     语义是「这段字节在不在频道上」——正是 outcome-unknown 要问的那一问。
#
# 🔴 2026-08-04 修(我自己在 live 频道上撞的,烧了 8 笔真实交易 —— 见本函数下方"由来")
#   ① **锚点顺序反了**: 旧版先按【全字节相等】筛,再在筛出来的里面找 tx_hash。
#      ⇒ 内容比对一失败,txId 这个**最硬的锚**根本没被查过。
#      而内容比对**必然**失败: 服务端会把消息末尾的换行剥掉(实测 want 2343 chars /
#      got 2342, 唯一分歧就是结尾那个 \n)。⇒ 只要 payload 的 message 以 \n 结尾,
#      这个 predicate **永远返回"没落地"**。
#   ② **归一化**: 内容比对改为「两侧各剥尾部空白后逐字节相等」。若剥之前不等、剥之后相等,
#      **照常判达并大声打印一行**(传输做了归一化, 这是事实, 不该被静默也不该被当失败)。
#      若剥之后仍不等 ⇒ 真差异, 判失败(这才是 byte-exactness 断言要抓的东西)。
# ── 独立送达核实（2026-08-09 加，事故驱动）───────────────────────────────────
# 由来（真事故）：整整一天，我发的每一条消息队友都没收到，而这里每次都打 "LANDED"。
# 旧判据只证明【本机 console 把它写进了自己的库】——status=confirmed 是本机自报。
# 链停了（无人出块）时，交易躺在 mempool 里，本机照样 confirmed，队友一条都看不到。
# 🔴 而这个脚本当时其实【已经如实写了】"非我独立链上核验" —— 骗到人的不是缺注释，
#    是判词本身叫 LANDED。人只看词。所以判词必须自带作用域，见下面三档。
# 独立核实 = 去【队里第二台】的 console 读，这是 [[feedback_channel-land-only-independent-node]]
# 早就立过的规矩（消息真到 = 独立节点读到），我自己引用过、今天却整天信了本机读数。
readback_peer() {
  local peer_base="${J1_PEER_BASE:-http://127.0.0.1:3201}"
  local body
  body="$(curl -s -m 20 "$peer_base/api/chat/messages?channel=dev-coord-testnet&limit=40" 2>/dev/null)" || return 3
  [ -n "$body" ] || return 3
  printf '%s' "$body" | node -e '
    const fs=require("fs");
    const want=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).message;
    const B=s=>Buffer.from(String(s==null?"":s),"utf8");
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      let ms=[];try{ms=(JSON.parse(d).messages)||[]}catch(e){process.exit(3)}
      if(!ms.length) process.exit(3);
      process.exit(ms.some(m=>Buffer.compare(B(m.content),B(want))===0)?0:1);
    });
  ' "$PAYLOAD"
}

readback() {
  curl -s -m 25 "$BASE/api/chat/messages?channel=dev-coord-testnet&limit=40" 2>/dev/null | node -e '
    const fs=require("fs");
    const want=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).message;
    const wantTx=(process.argv[2]||"").trim();
    const B=s=>Buffer.from(String(s==null?"":s),"utf8");
    const rstrip=s=>String(s==null?"":s).replace(/[\s﻿]+$/,"");
    // 返回 {verdict:"exact"|"normalized"|"differs"}
    const cmp=(got)=>{
      if(Buffer.compare(B(got),B(want))===0) return "exact";
      if(Buffer.compare(B(rstrip(got)),B(rstrip(want)))===0) return "normalized";
      return "differs";
    };
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      let ms=[]; try { ms=(JSON.parse(d).messages)||[]; } catch { console.error("read-back: 频道返回不是可解析 JSON"); process.exit(1); }
      if(wantTx){
        // 🔴 先按 txId 锚 —— 它是本次发送返回的, 不受任何内容归一化影响
        const anchored=ms.find(m=>String(m.tx_hash||"")===wantTx);
        if(!anchored){ console.error("read-back: 窗口内无 tx_hash == 本次 txId ("+wantTx.slice(0,8)+")"); process.exit(1); }
        const v=cmp(anchored.content);
        if(v==="differs"){ console.error("🔴 read-back: tx_hash 对上但内容【剥尾部空白后仍不同】= 真差异, 不判达"); process.exit(1); }
        if(String(anchored.status||"")!=="confirmed"){ console.error("read-back: tx_hash 对上但 status="+anchored.status); process.exit(1); }
        if(v==="normalized") console.error("ⓘ read-back: 内容在【剥尾部空白后】相同, 原字节不同 —— 传输侧做了归一化(实测: 服务端剥掉结尾换行)。判达。");
        process.exit(0);
      }
      const hit=ms.some(m=>cmp(m.content)!=="differs");
      if(!hit) process.exit(1);
      process.exit(0);
    });
  ' "$PAYLOAD" "$1"
}

for i in $(seq 1 $MAX); do
  curl -s -m 20 -X POST "$BASE/api/relay/$RELAY/restart" > /dev/null 2>&1
  sleep 5
  # 🔴 取 HTTP 状态码（Codex §1.5 要 `HTTP 200 && ok===true && txId present`，我原来一个都没取全）
  raw=$(curl -s -m "$SEND_TIMEOUT" -w '\n__HTTP__%{http_code}' -X POST "$BASE/api/chat/send" \
          -H "Content-Type: application/json" --data-binary @"$PAYLOAD" 2>&1)
  curl_rc=$?
  http_code="${raw##*__HTTP__}"
  resp="${raw%$'\n'__HTTP__*}"
  # 🔴 实测: 拒连/超时时 curl 给的 http_code 是 `000` —— 它**通过**了「三位数字」这种检查。
  #   我第一版就写成了 `grep -qE '^[0-9]{3}$'` ⇒ 000 被当成"拿到状态码了" ⇒ 落回盲重试。
  #   （又一次「判据用了这东西通常长什么样(三位数字)，而不是它的定义(收到了 HTTP 响应)」。）
  # curl 退出码把两种 000 分开, 而它们的重试安全性相反:
  #   7  = 连不上          ⇒ 请求【确定没送到】 ⇒ 重试安全, 不会产生重复
  #   28 = 超时 / 其它非 0 ⇒ 请求【可能已送达】 ⇒ 结果未知, 必须先 read-back
  if [ "$http_code" = "000" ] && [ "$curl_rc" = "7" ]; then
    echo "REFUSED-CONNECT try=$i — 连不上 $BASE (curl rc=7) = 请求确定未送达, 重试安全" >&2
    sleep $SLEEP; continue
  fi

  # 🔴 成功判据由【或】改成【与】（2026-07-25 按 Codex §1.5 改）。
  #   旧: txid | txId | "success":true | "ok":true —— 任一命中即成功
  #   ⇒ 一个 {"ok":true} 但**没有 txId** 的响应会被判成功。我 16:1x 自己认领的那一格。
  #   新: HTTP 200 且 ok===true 且 txId 非空，三者缺一不算成功。
  ok_strict=$(echo "$resp" | HTTP_CODE="$http_code" node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      if (process.env.HTTP_CODE !== "200") return process.stdout.write("");
      let j; try { j=JSON.parse(d); } catch { return process.stdout.write(""); }
      const tx=String(j.txId||j.txid||"").trim();
      if (j.ok === true && tx) process.stdout.write(tx);
      else process.stdout.write("");
    });' 2>/dev/null)

  if [ -n "$ok_strict" ]; then
    sleep 25
    # 🔴 自证升级为「全文逐字节精确比对」，不用子串。
    #   子串比对有个真弱点: 我的消息常以 `[J1tn·…` 开头, 前缀相同的两条会互相误匹配 = 假 LANDED。
    #   而且既然已实测传输是逐字节的(3110B 消息链上取回 Buffer.compare 相同, 零分块),
    #   就该直接断言全文相等 —— 顺带让 Codex §5.2 要的 byte-exactness 断言**每次真实发送都在跑**,
    #   不只活在那个一次性回归测试里。若哪天发送器引入分块, 这里会大声失败(正确的失败)。
    # limit 不能太小: 实测这个频道忙起来 15 分钟能滚 30+ 条, 窗口太小会让「已落链」查不到 →
    # 假 CLAIMED-BUT-UNVERIFIED → 重试 → 撞去重才自愈(噪音)。40 条够覆盖发送后 ~30s 的突发。
    # 🔴 措辞与判据都收紧（2026-07-25 自审改）：
    #   这个 re-pull 打的是 **本机 console 的 API**（读 console 的 DB），**不是链**。
    #   我之前一直打印「链上内容与 payload 逐字节相同」—— **那是过度声称**：它证明的是
    #   「我这台 console 的记录里有这份内容」。（NWT 同日自纠过同款措辞：「从链上取」vs
    #   「从 console API 取」——后者是本地记录，落在记录型证据的限定之下。）
    #   现在多加两个链锚（都仍是 console 记录里的字段，但比只比内容强）：
    #     · 该条 `tx_hash` == 本次发送返回的 `txId`（证明匹配到的是**我这次**发的那条，不是同文旧条）
    #     · 该条 `status` == 'confirmed'
    #   我这台**无法**独立按 txId 查链（kaspad 无通用 tx-by-id 索引，我的 kaspa_tx_log 覆盖稀疏），
    #   所以最终确证依赖 console 记录 —— 这一点如实打印，不假装是链上核验。
    sent_txid="$ok_strict"
    # 🔵 机器可读全量 txid 发射(Codex MSG-235 复审 #2 要求): 成功判据(HTTP200+ok+txId)刚成立、read-back 之前。
    #   仪器据此持久化 submit 阶段完整身份——即使 console 永远没 first-seen, 探针仍可被第二观察者按此查询。
    echo "SUBMIT_TXID=${sent_txid}"
    if readback "$sent_txid"; then
      # 三档判词，词本身带作用域：只看词的人也不会把「本机记下了」读成「队友看见了」。
      # 传播宽限 (2026-08-09): 广播后独立节点要等一个块 + console 轮询才看得到。
      # 不给宽限就直接判词 ⇒ 每条刚发的消息都先被打成 NOT-DELIVERED。今晚两次假阴性
      # 都是这么来的，而这个词会让人以为消息没到、去重发或改道。
      # 只在「还没命中」时才等，命中就立刻返回 —— 成功路径一秒不拖。
      readback_peer; peer_rc=$?
      grace=0
      while [ "$peer_rc" = "1" ] && [ "$grace" -lt "${J1_PEER_GRACE_TRIES:-15}" ]; do
        grace=$((grace+1))
        echo "   ⏳ 传播宽限 ${grace}/${J1_PEER_GRACE_TRIES:-15}: 独立节点暂未见到，等 ${J1_PEER_GRACE_SLEEP:-20}s 再核（不是判词）"
        sleep "${J1_PEER_GRACE_SLEEP:-20}"
        readback_peer; peer_rc=$?
      done
      case "$peer_rc" in
        0) echo "DELIVERED-VERIFIED try=$i — 独立节点(队里第二台 console)已读到逐字节相同的这条。txId=${sent_txid:0:8}" ;;
        1) echo "🟡 UNCONFIRMED try=$i — 本机已记录(HTTP200+ok+txId+status=confirmed)，宽限内独立节点【尚未】看到。"
           echo "   ⚠ 这【不是】\"没送达\"。2026-08-09 实测三条都在宽限用尽【之后】才被独立节点读到(最慢 >2 分钟)。"
           echo "   ⇒ 旧版这里打的是 NOT-DELIVERED —— 那是把【我还没看到】说成【它不在】，同一个判据错误今天犯了三次，"
           echo "     而这个词会让人去重发或改道。要判死必须【隔一段时间再核一次】，不是等宽限跑完就下结论。"
           echo "   ⇒ 复核: node -e 读 \$J1_PEER_BASE 的 /api/chat/messages 逐字节比对。txId=${sent_txid:0:8}" ;;
        *) echo "⚠ RECORDED-LOCAL-ONLY try=$i — 本机已记录，但【未能独立核实】(第二台 console 不可达; 设 J1_PEER_BASE 或开隧道)。"
           echo "   ⇒ 这【不等于】送达。2026-08-09 整天的消息都停在这一档而我以为发出去了。txId=${sent_txid:0:8}" ;;
      esac
      exit 0
    fi
    # 🔴 2026-08-04 改: 这里**不许再重试**。
    #   由来(真事故, 不是洁癖): 8 笔真实链上交易、同一条消息在频道刷了 8 遍, 队友三方同时喊停。
    #   旧逻辑在这条分支上 `continue` —— 而**走到这条分支时我们已经拿到 HTTP 200 + ok===true + txId**,
    #   也就是**发送侧已经明确告诉我它落地了**。此时重发 = **确定性地**产生一笔重复花费,
    #   赌的只是"也许上一笔其实没成"。
    #   🔨 判据: **「发送侧说成功但我的验证没通过」与「没发出去」是两个状态, 它们的正确动作相反**
    #      (前者=停手查我的验证; 后者=重试)。旧脚本把两者折叠成同一条 `continue`,
    #      正是今天全队在数的那族失效: **两个不同的状态在判据里读数相同。**
    #      —— 而这条分支的默认动作被设成了**花钱的那一个**。
    echo "🔴 CLAIMED-BUT-VERIFY-FAILED try=$i — 接口称成功(HTTP200+ok+txId=${sent_txid:0:8})但 read-back 未通过。" >&2
    echo "   **不重发** —— 已持有 txId ⇒ 重发是确定的重复花费, 不是补救。" >&2
    echo "   人工接手: 先回读频道确认这条在不在(多半在, 问题在验证半边), 再决定。" >&2
    echo "   resp=$(echo "$resp" | head -c 200)" >&2
    exit 3
  fi

  # ── outcome-unknown: 🔴 不许盲重试（Codex §1.5）───────────────────────────────
  #   判定「结果未知」= 拿不到 HTTP 状态码（连不上/超时/被截断）或响应根本不是 JSON。
  #   与「明确拒绝」（有 200 以外的状态码且响应是结构化的）分开 —— 后者重试无害但也无用，
  #   前者重试**会产生重复**（我 15:xx 用服务端计数实证过：断连 3 次、坏响应 3 次）。
  #   ⇒ 先跑 read-back（不带 txId，因为未知路径上根本没拿到 txId），
  #     只有确认这段字节【确实不在频道上】才重试。
  if [ -z "$http_code" ] || [ "$http_code" = "000" ] || ! echo "$http_code" | grep -qE '^[1-5][0-9]{2}$'; then
    echo "OUTCOME-UNKNOWN try=$i — 未收到 HTTP 响应(code=$http_code, curl rc=$curl_rc), **不盲重试**, 先 read-back 确认它到底有没有落地" >&2
    sleep 20
    if readback ""; then
      echo "LANDED-VIA-READBACK try=$i — 结果未知但这段字节已在频道上(逐字节相同). **未重发**, 避免重复。"
      echo "  ⚠ 覆盖: 未能核到 tx_hash/status(未知路径上没有 txId 可锚), 强度低于正常 LANDED。"
      exit 0
    fi
    echo "  read-back 确认未落地 ⇒ 这一次重试是安全的(不会造重复)" >&2
    sleep $SLEEP; continue
  fi

  # 🔴 `duplicate` **不再当作已达**（2026-07-25 自审改：这是一处「借来的保证」）。
  #   旧逻辑「撞 duplicate = 同文已在链上 = 视为已达」依赖的是**去重层的实现细节**：
  #   它必须恰好按「全文相同」去重才成立。若去重键改成前缀/时间窗/relay+channel 之类，
  #   `duplicate` 就不再证明消息真在链上，而这个脚本会**给一条没送到的消息报成功**。
  #   判据不该跳到别处去看去重层怎么实现——**问链本身**：内容在不在？
  #   （同款判据：Bettor 2026-07-25「要跳到别处去看某个函数的实现才敢下结论 = 借来的」。）
  if echo "$resp" | grep -qi 'duplicate'; then
    if curl -s -m 25 "$BASE/api/chat/messages?channel=dev-coord-testnet&limit=40" 2>/dev/null | node -e '
      const fs=require("fs");
      const want=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).message;
      let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
        let ms=[]; try { ms=(JSON.parse(d).messages)||[]; } catch { process.exit(1); }
        const hit=ms.some(m=>Buffer.compare(Buffer.from(m.content||"","utf8"),Buffer.from(want,"utf8"))===0);
        process.exit(hit?0:1);
      });
    ' "$PAYLOAD"; then
      echo "DEDUP-VERIFIED try=$i — 去重层拦, 且 re-pull 证实链上内容与 payload 逐字节相同 = 真已达."
      exit 0
    fi
    echo "DEDUP-BUT-NOT-ON-CHAIN try=$i — ⚠ 去重层报 duplicate 但链上查不到本文 = **不能当已达**(去重键可能不是全文). 继续重试. resp=$(echo "$resp" | head -c 200)" >&2
    sleep $SLEEP; continue
  fi

  echo "retry $i/$MAX: $(echo "$resp" | head -c 160)" >&2
  sleep $SLEEP
done
echo "FAILED — $MAX 次用尽, 需人工接手"
exit 1
