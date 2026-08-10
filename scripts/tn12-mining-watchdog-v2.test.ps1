function Say($m) { [Console]::WriteLine($m) }

$ErrorActionPreference = 'Stop'
$path = if ($env:WD_PATH) { $env:WD_PATH } else { Join-Path $PSScriptRoot 'tn12-mining-watchdog-v2.ps1' }
$lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)

$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*if \(\$pulseHalted\) \{') { $start = $i; break } }
if ($start -lt 0) { throw 'FIXTURE-BROKEN: cannot find the start of the pulse decision chain' }

# depth returns to 0 after EACH block of an if/elseif/else chain, so closing once is not the end:
# keep going while the following non-blank line continues the chain.
$depth = 0; $end = -1
for ($i = $start; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  $code = if ($l -match '^\s*#') { '' } else { $l }
  $depth += ([regex]::Matches($code, '\{')).Count
  $depth -= ([regex]::Matches($code, '\}')).Count
  if ($depth -le 0 -and $i -gt $start) {
    $j = $i + 1
    while ($j -lt $lines.Count -and $lines[$j].Trim() -eq '') { $j++ }
    if ($j -lt $lines.Count -and $lines[$j] -match '^\s*(\}\s*)?(elseif|else)\b') { continue }
    $end = $i; break
  }
}
if ($end -lt 0) { throw 'FIXTURE-BROKEN: chain never closed' }
$chain = ($lines[$start..$end] -join "`n")
$branches = ([regex]::Matches($chain, '(?m)^\s*(elseif|else)\b')).Count + 1
Say ("extracted lines {0}-{1} ({2} lines, {3} branches)" -f ($start+1), ($end+1), ($end-$start+1), $branches)
if ($branches -lt 5) { throw "FIXTURE-BROKEN: only $branches branches extracted -- the chain has more, the test would silently cover a fragment" }
Say ''

$stubs = @'
function Start-Miner-Unless-Paused { $global:STARTED++ }
function Stop-Miner { $global:STOPPED++ }
function Start-Sleep { param($Seconds) $global:SLEPT += $Seconds }
function Alert($m) { $global:ALERTS += @($m) }
function Log($m)   { $global:LOGS   += @($m) }
'@

$script:pass = 0; $script:fail = 0
function Run-Case($name, $halted, $adv, $count, $tips, $refTips, $expPulsed, $expHalted) {
  $global:STARTED = 0; $global:STOPPED = 0; $global:SLEPT = 0
  $global:ALERTS = @(); $global:LOGS = @()
  $pulseHalted = $halted; $daaAdvancing = $adv; $pulseCount = $count
  $pulseRefTips = $refTips; $MAX_PULSES = 20; $PULSE_CHECK = 5
  $PULSE_SEC = 20; $TIPS_RESUME = 50; $round = 20; $prevDaa = 123456
  . ([scriptblock]::Create($stubs + "`n" + $chain))
  $pulsed = ($global:STARTED -gt 0)
  $ok = ($pulsed -eq $expPulsed) -and ($pulseHalted -eq $expHalted)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Say ("[{0}] {1,-32} pulsed={2,-5} halted={3,-5} slept={4} alerts={5}" -f $mark, $name, $pulsed, $pulseHalted, $global:SLEPT, $global:ALERTS.Count)
  if (-not $ok) { Say ("       expected pulsed={0} halted={1}" -f $expPulsed, $expHalted) }
  if ($global:ALERTS.Count) { Say ("       alert: " + $global:ALERTS[0].Substring(0, [Math]::Min(84, $global:ALERTS[0].Length))) }
}

Run-Case 'already halted -> no pulse'     $true  $true   3 150 200 $false $true
Run-Case 'DAA unknown -> no pulse'        $false $null   0 150 200 $false $false
Run-Case 'DAA flat (wedge) -> suppress'   $false $false  3 150 200 $false $true
Run-Case 'budget exhausted -> halt'       $false $true  20 150 200 $false $true
Run-Case 'normal -> pulse'                $false $true   1 150 200 $true  $false
Run-Case 'checkpoint, tips NOT down'      $false $true   4 210 200 $true  $true
# 边界: tips 与参考值【相等】。变异测试(-ge 改 -gt)证明前一条用例【测不到这个】——
# 210>200 时 -gt 也拦得住, 于是那条用例的名字("没降就停")覆盖不了它自称覆盖的一半。
# "没有下降" 包含 "持平", 而持平正是脉冲无效最典型的样子(2026-08-09 楔死那次就是纹丝不动)。
Run-Case 'checkpoint, tips FLAT (== ref)' $false $true   4 200 200 $true  $true
Run-Case 'checkpoint, tips down -> go on' $false $true   4 150 200 $true  $false

Say ''
Say '--- part 2: the DAA three-state derivation (mutation testing showed part 1 never reaches it) ---'
# 变异④(把 UNKNOWN 塌成 $true)在 part 1 下【全绿】, 因为那些用例直接给 $daaAdvancing 赋值,
# 从不执行推导它的那几行 ⇒ 承重的 [uint64] 强转和三态判定当时零覆盖。
# 同样抽文件里的真字节, 不重实现。
$ds = -1; $de = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\$daaNow = \$null\s*$') { $ds = $i; break } }
if ($ds -lt 0) { throw 'FIXTURE-BROKEN: cannot find the DAA derivation block' }
for ($i = $ds; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*if \(\$null -ne \$daaNow\) \{ \$prevDaa = \$daaNow \}') { $de = $i; break } }
if ($de -lt 0) { throw 'FIXTURE-BROKEN: DAA derivation block has no end' }
$deriv = ($lines[$ds..$de] -join "`n")
# 🔴 锚点【故意】不是 [uint64]。原先这里断言 "必须含 [uint64]" —— 那等于让 fixture 去断言
#    用例本身存在的理由, 于是拆掉强转时是 fixture 先炸, 而不是那条以它命名的用例变红,
#    真正的失败信号被一条更早的断言盖住了。
#    ⇒ 通则: fixture 只许锚在【它不测的东西】上。这里锚 $daaAdvancing(结构标识),
#    强转在不在, 交给下面 "lexicographic trap" 那两条用例去说。
if ($deriv -notmatch '\$daaAdvancing') { throw 'FIXTURE-BROKEN: extracted block is not the DAA derivation' }
Say ("extracted lines {0}-{1} ({2} lines)" -f ($ds+1), ($de+1), ($de-$ds+1))

function Run-Daa($name, $prev, $scoreString, $expect) {
  $health = if ($null -eq $scoreString) { [pscustomobject]@{ } } else { [pscustomobject]@{ virtualDaaScore = $scoreString } }
  $prevDaa = $prev
  $daaAdvancing = 'untouched'
  . ([scriptblock]::Create($deriv))
  $got = if ($null -eq $daaAdvancing) { 'unknown' } else { [string]$daaAdvancing }
  $ok = ($got -eq $expect)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-40} -> {2,-8} (expect {3})" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $got, $expect)
}

Run-Daa 'no previous reading -> unknown'        $null '76812253' 'unknown'
Run-Daa 'no virtualDaaScore field -> unknown'   ([uint64]100) $null 'unknown'
Run-Daa 'advanced 100 -> 101'                   ([uint64]100) '101' 'True'
Run-Daa 'flat 100 -> 100 (the wedge)'           ([uint64]100) '100' 'False'
Run-Daa 'went backwards 100 -> 99'              ([uint64]100) '99'  'False'
# 🔴 这条是全 part 2 最承重的: 字符串比较下 "9" -gt "10" 为真, 于是【楔死】会被读成【在推进】,
#    刹车照常脉冲, 而日志看起来完全正常。真实 DAA 是 8 位数, 跨位数的时刻天天都在发生。
Run-Daa 'lexicographic trap: 9 -> 10 must rise' ([uint64]9)   '10'  'True'
Run-Daa 'lexicographic trap: 99 -> 100 rises'   ([uint64]99)  '100' 'True'
Run-Daa 'garbage score -> unknown, not false'   ([uint64]100) 'abc' 'unknown'

Say ''
Say ("result: {0} PASS / {1} FAIL" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
