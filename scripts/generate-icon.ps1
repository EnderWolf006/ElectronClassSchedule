# 生成 eSchedule 图标 (256x256 PNG)
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角矩形底座 (深灰)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 32  # corner radius
$w = $size - 32
$h = $size - 32
$path.AddArc(16, 16, $r*2, $r*2, 180, 90)
$path.AddArc($w - $r, 16, $r*2, $r*2, 270, 90)
$path.AddArc($w - $r, $h - $r, $r*2, $r*2, 0, 90)
$path.AddArc(16, $h - $r, $r*2, $r*2, 90, 90)
$path.CloseFigure()
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 52, 54))
$g.FillPath($bgBrush, $path)

# 顶部青绿色装饰条
$topRect = New-Object System.Drawing.Rectangle(16, 16, $w, 56)
$topBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 184, 148))
$g.FillRectangle($topBrush, $topRect)

# 课表网格（4列 x 3行）
$gridX = 32
$gridY = 88
$cellW = 48
$cellH = 44
$gap = 8
$gray = [System.Drawing.Color]::FromArgb(99, 110, 114)
$green = [System.Drawing.Color]::FromArgb(0, 230, 180)

for ($row = 0; $row -lt 3; $row++) {
    for ($col = 0; $col -lt 4; $col++) {
        $cx = $gridX + $col * ($cellW + $gap)
        $cy = $gridY + $row * ($cellH + $gap)
        $cellRect = New-Object System.Drawing.Rectangle($cx, $cy, $cellW, $cellH)
        $cellPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $cellPath.AddArc($cx, $cy, 12, 12, 180, 90)
        $cellPath.AddArc($cx + $cellW - 12, $cy, 12, 12, 270, 90)
        $cellPath.AddArc($cx + $cellW - 12, $cy + $cellH - 12, 12, 12, 0, 90)
        $cellPath.AddArc($cx, $cy + $cellH - 12, 12, 12, 90, 90)
        $cellPath.CloseFigure()

        # 高亮第二列第一行的格子（当前课程）
        if ($col -eq 1 -and $row -eq 0) {
            $cellBrush = New-Object System.Drawing.SolidBrush($green)
        } else {
            $cellBrush = New-Object System.Drawing.SolidBrush($gray)
        }
        $g.FillPath($cellBrush, $cellPath)
    }
}

# 保存 PNG
$outDir = Join-Path (Join-Path $PSScriptRoot '..') 'image'
if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$outDir = (Resolve-Path $outDir).Path
$pngPath = Join-Path $outDir 'icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# 生成各尺寸 PNG 帧（16/24/32/48/64/128/256）到 frames 目录；
# 合规多尺寸 ICO 由 Node 脚本 build-ico.mjs 组装（PowerShell 5 二进制写入易踩解析器坑）
$frameDir = Join-Path $outDir 'icon-frames'
if (Test-Path $frameDir) { Remove-Item $frameDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $frameDir | Out-Null
$iconSizes = @(16, 24, 32, 48, 64, 128, 256)
foreach ($s in $iconSizes) {
    $frame = New-Object System.Drawing.Bitmap($s, $s)
    $fg = [System.Drawing.Graphics]::FromImage($frame)
    $fg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $fg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $fg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $fg.Clear([System.Drawing.Color]::Transparent)
    $fg.DrawImage($bmp, 0, 0, $s, $s)
    $frame.Save((Join-Path $frameDir ("$s.png")), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()
    $frame.Dispose()
}

# 48x48 小图（任务栏等）直接复用帧图
Copy-Item (Join-Path $frameDir '48.png') (Join-Path $outDir 'icon48.png') -Force

# 调用 Node 组装多尺寸 ICO
$buildScript = Join-Path $PSScriptRoot 'build-ico.mjs'
& node $buildScript
if ($LASTEXITCODE -ne 0) { throw 'build-ico.mjs 执行失败' }

Write-Host "Icons generated:"
Write-Host "  $pngPath"
Write-Host "  $(Join-Path $outDir 'icon.ico')"
Write-Host "  $smallPath"
