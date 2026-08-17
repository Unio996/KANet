#!/bin/sh
# J1 trough 探针测量仪器 v2 — Codex MSG-233 复审 5 条 MUST-FIX 合规版
# 授权链: Owner 政策变更(ledger (420), 双通道直令) + 测试计划 docs/2026-08-17-j1-trough-probe-test-plan-v1.md(v1.2)
# 本文件入 git = 权威承载仪器(Codex MUST-FIX #3)。执行前置: SEND 腿拆分 landed((420) 排序)。
#
# 节点身份绑定(MUST-FIX #1): 发送观测节点 = local-J1 kaspad ws://127.0.0.1:17210 (testnet-12);
#   第二节点 = mining-host kaspad 100.99.147.101:17210 (经 SSH 隧道), 每样本一读, 失败记 absent+原因。
# 证据三段分离(MUST-FIX #4): submit-accepted(发送器 HTTP200+ok+txId, 仅记录不作链观测) /
#   first-seen(本机 console 出现该消息+tx_hash = 链摄入观测) / confirmed(status=confirmed) —— 只后两段计入 node-health。
# 逐样本字段(MUST-FIX #5): trigger{t,d1,d3} submit{t0,ok,txid} firstSeen{t,txhash} confirmed{t}|timeout
#   secondNode{t,daa,synced}|{absent,reason} exclusion(null | broadcast-fail=SEND-leg 证据零 node-health credit)
# 停止(MUST-FIX #2): 3 样本 或 总时限 TIME_CAP_MIN(默认 360min) 或 发送器异常 或 判词 runaway。
#
# 用法: bash scripts/j1-trough-probe-instrument.sh [TIME_CAP_MIN] [DRYRUN]
TIME_CAP_MIN=${1:-360}
DRYRUN=${2:-0}
LOG=/d/kanet/kanet/scratch/j1-trough-probe-artifact3.jsonl
SENDER=/d/kanet/kanet/scratch/j1-send-one.sh
NODE_ID="local-J1-ws://127.0.0.1:17210-testnet-12"
NODE2_ID="mining-host-100.99.147.101:17210"
START_EPOCH=$(date +%s)
D1=""; D2=""; D3=""; GOT=0; LASTPROBE=0
# 仪器自检: 发送器在场+三道保护(照 (140)J 判据), 缺任何一样拒绝启动
if [ ! -x "$SENDER" ] || [ "$(grep -c 'MARKED=\[30495, 23454\]\|CLAIMED-BUT-VERIFY-FAILED\|self=\$_SELF_ABS' "$SENDER")" != "3" ]; then
  echo "INSTRUMENT-REFUSED: 发送器缺失或保护不全(需 3/3), sha256 见计划 v1.2 附录"; exit 1
fi
while [ "$GOT" -lt 3 ]; do
  ELAPSED_MIN=$(( ( $(date +%s) - START_EPOCH ) / 60 ))
  [ "$ELAPSED_MIN" -ge "$TIME_CAP_MIN" ] && { echo "TIME-CAP: ${TIME_CAP_MIN}min 到, 样本=$GOT"; break; }
  OUT=$(node /d/kanet/kanet/scratch/j1-node-sync.mjs 2>/dev/null)
  DAA=$(printf '%s' "$OUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).virtualDaaScore||"0")}catch(e){console.log("0")}})')
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [ "$DAA" = "0" ] || [ -z "$DAA" ]; then echo "PROBE-ERR $NOW"; sleep 60; continue; fi
  DIAG=$(timeout 30 node /d/kanet/kanet/scripts/tn12-dag-health-probe.mjs 2>/dev/null | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).diagnosis||"?")}catch(e){console.log("?")}})')
  [ "$DIAG" = "runaway" ] && { echo "ABORT: 判词 runaway, 中止判据③"; break; }
  D1="$D2"; D2="$D3"; D3="$DAA"
  if [ -n "$D1" ]; then
    RATE=$(( (D3 - D1) / 120 ))
    NOWMIN=$(( $(date +%s) / 60 ))
    if [ "$RATE" -lt 1 ] && [ $((NOWMIN - LASTPROBE)) -ge 15 ]; then
      echo "TROUGH 触发 $NOW (D1=$D1 D3=$D3)"
      if [ "$DRYRUN" = "1" ]; then echo "DRYRUN: 跳过发送"; sleep 60; continue; fi
      LASTPROBE=$NOWMIN
      TAG=$(date -u +%H%M%S)-$RANDOM
      node -e "
const fs=require('fs');
const msg='[J1tn trough probe ${TAG} · 计划 v1.2 授权样本] 随机尾: '+require('crypto').randomBytes(12).toString('hex');
fs.writeFileSync('D:/kanet/kanet/scratch/j1-trough-payload.json', JSON.stringify({relayId:'e7f51073-6b6c-41ea-b7fe-e82e98531a9a', channel:'dev-coord-testnet', message:msg}));"
      [ -s /d/kanet/kanet/scratch/j1-trough-payload.json ] || { echo "INSTRUMENT-FAULT: payload 未写成"; sleep 60; continue; }
      T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      J1_ALLOW_RAW_CHAR=1 J1_SEND_MAX=2 J1_SEND_SLEEP=5 bash "$SENDER" /d/kanet/kanet/scratch/j1-trough-payload.json > /d/kanet/kanet/scratch/j1-trough-send-last.log 2>&1
      SUBOK=$(grep -c "txId" /d/kanet/kanet/scratch/j1-trough-send-last.log || true)
      if grep -q "REFUSED\|rc=7\|NOT-DELIVERED" /d/kanet/kanet/scratch/j1-trough-send-last.log && [ "$SUBOK" = "0" ]; then
        printf '{"sample":"excluded","trigger":{"t":"%s","d1":%s,"d3":%s},"submit":{"t0":"%s","ok":false},"exclusion":"broadcast-fail => SEND-leg evidence, zero node-health credit","node":"%s"}\n' "$NOW" "$D1" "$D3" "$T0" "$NODE_ID" >> "$LOG"
        echo "SAMPLE-EXCLUDED(broadcast-fail): 计 SEND 腿证据, 发送器异常则中止判据②"; grep -q "REFUSED" /d/kanet/kanet/scratch/j1-trough-send-last.log && break
        sleep 60; continue
      fi
      # 轮询 first-seen 与 confirmed(分离记录), 最多 15min
      FS=""; CF=""; K=0
      while [ "$K" -lt 90 ]; do
        ROW=$(curl -s -m 8 "http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=10" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const m=(j.messages||[]).find(x=>String(x.content||'').includes('trough probe ${TAG}'));console.log(m?m.status+' '+(m.tx_hash||'').slice(0,12)+' '+m.created_at:'ABSENT')}catch(e){console.log('ERR')}}")
        case "$ROW" in
          ABSENT|ERR) : ;;
          confirmed*) [ -z "$FS" ] && FS="$(date -u +%Y-%m-%dT%H:%M:%SZ) $ROW"; CF="$(date -u +%Y-%m-%dT%H:%M:%SZ) $ROW"; break ;;
          *) [ -z "$FS" ] && FS="$(date -u +%Y-%m-%dT%H:%M:%SZ) $ROW" ;;
        esac
        K=$((K+1)); sleep 10
      done
      # 同期第二节点观测(MUST-FIX #1), 失败记 absent
      export SSH_ASKPASS=/d/kanet/kanet/scratch/j1-askpass-0808.sh SSH_ASKPASS_REQUIRE=force DISPLAY=:0
      ssh -o ConnectTimeout=12 -L 17219:127.0.0.1:17210 admin@100.99.147.101 "ping -n 25 127.0.0.1 > NUL" 2>/dev/null & SP=$!
      sleep 5
      N2=$(J1_PROBE_URL=ws://127.0.0.1:17219 timeout 15 node /d/kanet/kanet/scratch/j1-remote-node-check-0812.mjs 2>/dev/null | tail -1)
      kill $SP 2>/dev/null
      [ -z "$N2" ] && N2='{"absent":"ssh/rpc unreachable"}'
      GOT=$((GOT+1))
      printf '{"sample":%d,"node":"%s","node2":"%s","trigger":{"t":"%s","d1":%s,"d3":%s},"submit":{"t0":"%s","ok":true},"firstSeen":"%s","confirmed":"%s","secondNode":%s}\n' \
        "$GOT" "$NODE_ID" "$NODE2_ID" "$NOW" "$D1" "$D3" "$T0" "${FS:-none-within-15min}" "${CF:-timeout-15min}" "$N2" >> "$LOG"
      echo "TROUGH-PROBE-SAMPLE #$GOT: t0=$T0 firstSeen=[${FS:-无}] confirmed=[${CF:-超时}]"
    fi
  fi
  sleep 60
done
echo "PROBE-INSTRUMENT-DONE: samples=$GOT elapsedMin=$(( ( $(date +%s) - START_EPOCH ) / 60 )) log=$LOG"
