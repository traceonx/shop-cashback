# 安装后台自动推送：登录 Windows 时自动在后台运行 auto-push.ps1，并立即启动一次
# 用法（PowerShell，项目目录下）：powershell -ExecutionPolicy Bypass -File scripts\install-auto-push.ps1
# 卸载：Unregister-ScheduledTask -TaskName shop-cashback-auto-push -Confirm:$false
$script = Join-Path $PSScriptRoot 'auto-push.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'shop-cashback-auto-push' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'shop-cashback-auto-push'
Write-Host '已安装并启动后台自动推送。日志：data\auto-push.log'
