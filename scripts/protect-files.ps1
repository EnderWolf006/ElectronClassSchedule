param(
    [ValidateSet('protect', 'restore')][string]$Mode = 'protect',
    [string]$InstallRoot = '',
    [string]$ProtectedDir = ''
)

# 文件保护开关：与进程保护同思路，但作用于文件/目录对象的 DACL。
#
# 关键机制：Windows 删除一个文件时，只要调用方拥有“父目录”的
# DELETE_CHILD 权限，就不会再检查文件自身的 DACL（给单个文件加 Deny DELETE
# 会被父目录权限直接绕过）。因此正确做法是对“目录”拒绝
# DeleteSubdirectoriesAndFiles：
#   - 对安装根目录加“可继承的拒绝”ACE，系统自动传播到全部子目录/文件，
#     之后新建的文件也会自动继承，无需重新遍历数千个文件；
#   - 对专用数据子目录（ProtectedDir，存放密码文件等）加同样的 ACE。
#     不能直接对整个 userData 加——Chromium 缓存需要频繁删除目录项。
# 只拒绝删除/改名，不拒绝写入：软件以原地覆盖方式 (writeFileSync)
# 保存 scheduleConfig.js / settings.js、新建主题/插件文件均不受影响。
#
# restore：移除上述 ACE（按 SID 精确匹配），系统自动收回继承。
# 文件属主始终可以自行改回 DACL，提权管理员也可绕过，这与进程防护的
# 边界一致；本开关目标是阻止资源管理器/普通命令行随手删除程序与关键数据。
$ErrorActionPreference = 'Stop'

try {
    $sid = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
} catch {
    Write-Output ('FAIL: cannot resolve current user SID: ' + $_.Exception.Message)
    exit 1
}

$dirRights = [System.Security.AccessControl.FileSystemRights]::Delete -bor `
             [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
$inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
           [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$propNone = [System.Security.AccessControl.PropagationFlags]::None

# .NET 读回 ACE 时身份可能被翻译为账户名，统一转成 SID 再比较
function Test-IsOurSid($identityReference) {
    try {
        return $identityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value
    } catch {
        return $false
    }
}

function Set-DirRule([string]$target, [string]$action) {
    if (-not (Test-Path -LiteralPath $target)) { return 'missing' }
    $acl = Get-Acl -LiteralPath $target
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid, $dirRights, $inherit, $propNone,
        [System.Security.AccessControl.AccessControlType]::Deny)
    $exists = $false
    foreach ($r in $acl.Access) {
        if ($r.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
            (Test-IsOurSid $r.IdentityReference) -and
            ($r.FileSystemRights -band $dirRights) -eq $dirRights) {
            $exists = $true
            break
        }
    }
    if ($action -eq 'protect') {
        if ($exists) { return 'skip' }
        $acl.AddAccessRule($rule)
    } else {
        if (-not $exists) { return 'skip' }
        [void]$acl.RemoveAccessRule($rule)
    }
    Set-Acl -LiteralPath $target -AclObject $acl
    return 'ok'
}

$changes = 0
$skips = 0
$missing = 0
foreach ($target in @($InstallRoot, $ProtectedDir)) {
    if (-not $target) { continue }
    $r = Set-DirRule $target $Mode
    if ($r -eq 'ok') { $changes++ } elseif ($r -eq 'missing') { $missing++ } else { $skips++ }
}

if ($Mode -eq 'protect') {
    Write-Output ('OK (changed: ' + $changes + ', already: ' + $skips + ', missing: ' + $missing + ')')
} else {
    Write-Output ('OK (removed: ' + $changes + ', clean: ' + $skips + ', missing: ' + $missing + ')')
}
exit 0
