param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [ValidateSet('protect', 'restore')][string]$Mode = 'protect'
)

# 进程保护开关：修改目标进程对象的 DACL（自主访问控制列表），
# - protect：拒绝“当前用户”结束/挂起该进程的权利。非管理员的任务管理器
#   结束该进程时会显示“拒绝访问”；SYSTEM 与管理员（SeDebugPrivilege）仍可管理，
#   因此不影响注销/关机/系统维护。
# - restore：恢复为允许（关闭密码保护时调用）。
# 该权限只存在于运行中的进程对象上，进程结束后自动消失，不会留下持久化设置。
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class ProcGuard
{
    // 进程访问权
    const int PROCESS_TERMINATE = 0x0001;
    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_SUSPEND_RESUME = 0x0800;
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const int READ_CONTROL = 0x00020000;
    const int WRITE_DAC = 0x00040000;
    const int SYNCHRONIZE = 0x00100000;
    const int PROCESS_ALL_ACCESS = 0x001F0FFF;

    const int SE_KERNEL_OBJECT = 6;
    const uint DACL_SECURITY_INFORMATION = 0x00000004;
    const int GRANT_ACCESS = 1;
    const int DENY_ACCESS = 3;
    const int TRUSTEE_IS_SID = 0;
    const int TRUSTEE_IS_USER = 1;
    const int TRUSTEE_IS_GROUP = 2;

    [StructLayout(LayoutKind.Sequential)]
    struct TRUSTEE
    {
        public IntPtr pMultipleTrustee;
        public int MultipleTrusteeOperation;
        public int TrusteeForm;
        public int TrusteeType;
        public IntPtr ptstrName;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct EXPLICIT_ACCESS
    {
        public int grfAccessPermissions;
        public int grfAccessMode;
        public int grfInheritance;
        public TRUSTEE Trustee;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr LocalFree(IntPtr hMem);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint SetSecurityInfo(IntPtr handle, int ObjectType, uint SecurityInfo,
        IntPtr psidOwner, IntPtr psidGroup, IntPtr pDacl, IntPtr pSacl);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint SetEntriesInAcl(int cCountOfExplicitEntries, EXPLICIT_ACCESS[] pListOfExplicitEntries,
        IntPtr OldAcl, out IntPtr NewAcl);

    static IntPtr ToSid(string sddl)
    {
        SecurityIdentifier sid = new SecurityIdentifier(sddl);
        byte[] bytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(bytes, 0);
        IntPtr ptr = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, ptr, bytes.Length);
        return ptr;
    }

    static EXPLICIT_ACCESS Entry(IntPtr sid, int trusteeType, int accessMode, int rights)
    {
        TRUSTEE trustee = new TRUSTEE();
        trustee.pMultipleTrustee = IntPtr.Zero;
        trustee.MultipleTrusteeOperation = 0;
        trustee.TrusteeForm = TRUSTEE_IS_SID;
        trustee.TrusteeType = trusteeType;
        trustee.ptstrName = sid;
        EXPLICIT_ACCESS entry = new EXPLICIT_ACCESS();
        entry.grfAccessPermissions = rights;
        entry.grfAccessMode = accessMode;
        entry.grfInheritance = 0;
        entry.Trustee = trustee;
        return entry;
    }

    public static string Apply(int pid, string mode)
    {
        IntPtr hProc = OpenProcess(WRITE_DAC | READ_CONTROL | PROCESS_QUERY_INFORMATION, false, pid);
        if (hProc == IntPtr.Zero)
        {
            return "OpenProcess failed: " + Marshal.GetLastWin32Error();
        }
        IntPtr pUser = IntPtr.Zero;
        IntPtr pSystem = IntPtr.Zero;
        IntPtr acl = IntPtr.Zero;
        try
        {
            pUser = ToSid(WindowsIdentity.GetCurrent().User.Value);
            pSystem = ToSid("S-1-5-18");
            System.Collections.Generic.List<EXPLICIT_ACCESS> entries = new System.Collections.Generic.List<EXPLICIT_ACCESS>();
            if (mode == "protect")
            {
                // 先拒绝当前用户结束/挂起进程，再放开查询类权限（任务管理器仍能看到进程名与占用）
                entries.Add(Entry(pUser, TRUSTEE_IS_USER, DENY_ACCESS, PROCESS_TERMINATE | PROCESS_SUSPEND_RESUME));
                entries.Add(Entry(pUser, TRUSTEE_IS_USER, GRANT_ACCESS,
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | READ_CONTROL | WRITE_DAC | SYNCHRONIZE));
                entries.Add(Entry(pSystem, TRUSTEE_IS_GROUP, GRANT_ACCESS, PROCESS_ALL_ACCESS));
            }
            else
            {
                entries.Add(Entry(pUser, TRUSTEE_IS_USER, GRANT_ACCESS, PROCESS_ALL_ACCESS));
                entries.Add(Entry(pSystem, TRUSTEE_IS_GROUP, GRANT_ACCESS, PROCESS_ALL_ACCESS));
            }
            uint rc = SetEntriesInAcl(entries.Count, entries.ToArray(), IntPtr.Zero, out acl);
            if (rc != 0)
            {
                return "SetEntriesInAcl failed: " + rc;
            }
            rc = SetSecurityInfo(hProc, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, acl, IntPtr.Zero);
            if (rc != 0)
            {
                return "SetSecurityInfo failed: " + rc;
            }
            return "OK";
        }
        finally
        {
            if (acl != IntPtr.Zero) LocalFree(acl);
            if (pUser != IntPtr.Zero) Marshal.FreeHGlobal(pUser);
            if (pSystem != IntPtr.Zero) Marshal.FreeHGlobal(pSystem);
            CloseHandle(hProc);
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

$result = [ProcGuard]::Apply($ProcessId, $Mode)
Write-Output $result
if ($result -ne 'OK') { exit 1 }
exit 0