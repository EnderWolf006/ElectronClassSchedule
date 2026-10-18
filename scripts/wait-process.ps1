param(
    [Parameter(Mandatory = $true)][int]$ProcessId
)

# Wait for a process to exit using only SYNCHRONIZE access.
# We must NOT use OpenProcess(PROCESS_TERMINATE) liveness checks: the DACL
# applied by protect-process.ps1 denies TERMINATE even on exited-but-zombie
# process objects, returning ACCESS_DENIED that looks identical to "alive".
# SYNCHRONIZE is not denied; WaitForSingleObject returns WAIT_OBJECT_0 as soon
# as the process has truly exited, even while handles to the zombie remain.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProcessWaiter {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    private const uint SYNCHRONIZE = 0x00100000u;
    private const uint WAIT_OBJECT_0 = 0x00000000u;

    // 0 = process exited; 1 = open failed (does not exist or access denied)
    public static int WaitUntilExit(int processId) {
        IntPtr handle = OpenProcess(SYNCHRONIZE, false, processId);
        if (handle == IntPtr.Zero) { return 1; }
        uint result = WaitForSingleObject(handle, 0xFFFFFFFFu);
        CloseHandle(handle);
        return result == WAIT_OBJECT_0 ? 0 : 1;
    }
}
"@

exit [ProcessWaiter]::WaitUntilExit($ProcessId)
