# 后台自动推送：本地 main 领先 origin/main 时执行 git push（使用本机已保存的 GitHub 登录凭证）
# 日志：data\auto-push.log
param([int]$Interval = 30)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
New-Item -ItemType Directory -Force (Join-Path $repo 'data') | Out-Null
$log = Join-Path $repo 'data\auto-push.log'
function Write-Log($text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text" | Out-File -Append -Encoding utf8 $log }
Write-Log '自动推送已启动'
while ($true) {
  try {
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    if ($branch -eq 'main') {
      git fetch -q origin main 2>$null
      $ahead = [int](git rev-list --count origin/main..main 2>$null)
      $behind = [int](git rev-list --count main..origin/main 2>$null)
      if ($ahead -gt 0 -and $behind -eq 0) {
        $out = git push -q origin main 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Log "已推送 $ahead 个提交：$(git log -1 --format=%s)" }
        else { Write-Log "推送失败：$out" }
      } elseif ($ahead -gt 0 -and $behind -gt 0) {
        Write-Log "本地与远程已分叉（领先 $ahead / 落后 $behind），跳过，请手动处理"
      }
    }
  } catch { Write-Log "异常：$_" }
  Start-Sleep -Seconds $Interval
}
