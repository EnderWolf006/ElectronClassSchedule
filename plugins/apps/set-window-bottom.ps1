param(
    [Parameter(Mandatory = $true)][string]$Handle
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32Bottom {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

$hwnd = [IntPtr]([int64]$Handle)
# HWND_BOTTOM(1) | SWP_NOSIZE(0x1) | SWP_NOMOVE(0x2) | SWP_NOACTIVATE(0x10)
[Win32Bottom]::SetWindowPos($hwnd, [IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null
Write-Output 'ok'