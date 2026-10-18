# 检测当前 Windows 会话是否正在关机/注销。
# 输出 1 = 正在关机/注销（调用方不应再重新拉起程序）；0 = 正常状态。
# 原理：user32!GetSystemMetrics(SM_SHUTTINGDOWN = 0x2000)。
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Session -MemberDefinition @'
[DllImport("user32.dll")]
public static extern int GetSystemMetrics(int nIndex);
'@

Write-Output ([Win32.Session]::GetSystemMetrics(0x2000))
exit 0
