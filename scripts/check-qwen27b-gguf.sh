#!/usr/bin/env bash
# Qwen3.6-27B GGUF 可用性轮询脚本
# 用法：bash scripts/check-qwen27b-gguf.sh
#   发现 Q4_K_M 文件时：退出码 0 + stdout 打印 URL 和大小
#   未发现时：退出码 1 + 简短状态
#
# 可接 Windows Task Scheduler 每小时跑一次。

set -uo pipefail

REPOS=(
  "unsloth/Qwen3.6-27B-GGUF"
  "bartowski/Qwen_Qwen3.6-27B-GGUF"
  "Qwen/Qwen3.6-27B-GGUF"
)

FOUND=0
for REPO in "${REPOS[@]}"; do
  RESULT=$(curl -s -m 10 "https://huggingface.co/api/models/$REPO" 2>/dev/null \
    | node -e "
let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>{
  try{
    const d=JSON.parse(s);
    if(d.error){console.log('ERR:'+d.error); return;}
    const g=(d.siblings||[]).filter(x=>x.rfilename.endsWith('.gguf'));
    if(g.length===0){console.log('EMPTY'); return;}
    const q4=g.find(x=>/Q4_K_M/i.test(x.rfilename));
    const q4xl=g.find(x=>/Q4_K_XL|UD-Q4/i.test(x.rfilename));
    const pick=q4||q4xl;
    if(pick) console.log('FOUND:'+pick.rfilename);
    else console.log('PARTIAL:'+g.length+':'+g[0].rfilename);
  }catch(e){console.log('PARSE_ERR');}
});
" 2>/dev/null)

  STATUS="${RESULT%%:*}"
  DETAIL="${RESULT#*:}"

  if [ "$STATUS" = "FOUND" ]; then
    URL="https://huggingface.co/$REPO/resolve/main/$DETAIL"
    SIZE=$(curl -sI -L -m 10 "$URL" 2>/dev/null | grep -i '^content-length' | tail -1 | awk '{print $2}' | tr -d '\r\n')
    SIZE_GB=$(node -e "console.log(($SIZE/1e9).toFixed(2))" 2>/dev/null || echo "?")
    echo "✓ FOUND in $REPO"
    echo "  file: $DETAIL"
    echo "  size: ${SIZE_GB}G"
    echo "  url:  $URL"
    FOUND=1
    break
  elif [ "$STATUS" = "PARTIAL" ]; then
    COUNT="${DETAIL%%:*}"
    FIRST="${DETAIL#*:}"
    echo "~ $REPO: $COUNT gguf files but no Q4_K_M yet. First: $FIRST"
  elif [ "$STATUS" = "EMPTY" ]; then
    echo "— $REPO: repo exists, no GGUF yet"
  else
    echo "— $REPO: $STATUS"
  fi
done

if [ $FOUND -eq 1 ]; then
  echo ""
  echo "下一步："
  echo "  1. 下载: curl -L -o C:/kanet/models/Qwen3.6-27B-Q4_K_M.gguf '<url>'"
  echo "  2. 创建 C:/kanet/qclaude-deep.bat（复制 qclaude.bat，改 LLAMA_MODEL 路径）"
  echo "  3. 按需冷切换（taskkill llama-server → 跑 qclaude-deep.bat）"
  exit 0
else
  echo ""
  echo "Qwen3.6-27B Q4_K_M 还没出，下次再试。"
  exit 1
fi
