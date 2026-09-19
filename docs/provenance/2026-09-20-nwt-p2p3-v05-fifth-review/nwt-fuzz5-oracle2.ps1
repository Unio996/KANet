# NWT 五审 N4-3 oracle v2: 启动器 env 加载循环(逐字同 scripts/start-console-mainnet.ps1:53-56) + 直接读 Win32 进程环境块(GetEnvironmentStringsW),
# 不经过任何以"变量名"为键的 PowerShell/.NET 字典(那会按区域比较规则把只差零宽字符的名字折叠成一个)。
# 输出: 每个文件 -> [ { nameHex(大写名的 UTF-16 十六进制), value } ... ] + threw 计数。只动本进程环境的 NWTZ_ 前缀变量。
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class NwtEnv {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetEnvironmentStringsW();
  [DllImport("kernel32.dll")] static extern bool FreeEnvironmentStringsW(IntPtr p);
  public static List<string[]> Dump() {
    var res = new List<string[]>(); IntPtr p = GetEnvironmentStringsW(); IntPtr q = p;
    while (true) {
      string s = Marshal.PtrToStringUni(q); if (string.IsNullOrEmpty(s)) break;
      q = IntPtr.Add(q, (s.Length + 1) * 2);
      int eq = s.IndexOf('=', 1);           // entries like "=C:=C:\" start with '='
      if (eq > 0) res.Add(new string[] { s.Substring(0, eq), s.Substring(eq + 1) });
    }
    FreeEnvironmentStringsW(p); return res;
  }
}
'@
$dir = Join-Path $env:TEMP 'nwt-fuzz-env5'
$res = [ordered]@{}
foreach ($f in Get-ChildItem $dir -Filter 'case_*.env' | Sort-Object Name) {
  foreach ($e in [NwtEnv]::Dump()) { if ($e[0].StartsWith('NWTZ_', [StringComparison]::OrdinalIgnoreCase)) { [Environment]::SetEnvironmentVariable($e[0], $null, 'Process') } }
  $threw = 0
  Get-Content $f.FullName | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([^=]+)=(.*)$') {
      try { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } catch { $script:threw++ }
    }
  }
  $pairs = New-Object System.Collections.ArrayList
  foreach ($e in [NwtEnv]::Dump()) {
    if ($e[0].StartsWith('NWTZ_', [StringComparison]::OrdinalIgnoreCase)) {
      $hex = (($e[0].ToUpperInvariant().ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join '')
      [void]$pairs.Add([ordered]@{ nameHex = $hex; value = $e[1] })
    }
  }
  $res[$f.Name] = [ordered]@{ pairs = @($pairs); threw = $threw }
}
$res | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $env:TEMP 'nwt-fuzz-oracle5b.json')
"oracle2 cases: " + $res.Count
