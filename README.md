# ElectronClassSchedule
该版本为1.0版本。如需体验2.0，请访问[ECS2.0](https://github.com/aawwaaa/ElectronClassSchedule2)。

# 电子课程表

![view](image/README/view.png)


## 软件介绍

电子课程表是一款基于 Electron 开发的桌面课程表，适用于学校电子白板、教室电脑等场景。

- 显示当天课表、当前星期和日期。
- 提供上课、下课倒计时以及天数倒计时。
- 支持动态调整课表，以及最多四周的多周课表轮换。
- 支持窗口置顶、点击穿透和托盘菜单操作。
- 支持通过内置编辑器修改课表配置，无需直接编辑配置文件。
- 支持软件设置、组件布局和样式调整。
- 支持课程融合，可将连续课程合并显示并统一计时。
- 支持为每天指定不同的课表，也支持放学后显示下一天的课程。
- 使用 HTML、CSS、JavaScript 和 Node.js 编写，并使用 Electron 打包为桌面程序。

## 使用说明

以下为 Windows 系统下的使用方法。

- 在右侧 Releases 中下载最新版本并解压，`classSchedule.exe` 为程序主文件。
- 通过系统托盘图标打开软件菜单，可以使用课表配置编辑器、软件设置、课程融合和计时矫正等功能。
- 在菜单中打开 `课表配置编辑器` 可以直接编辑课程、时间表和每天使用的课表，也可以手动编辑 `resources/app/js/scheduleConfig.js`。
- 在菜单中打开 `软件设置` 可以调整星期栏、倒计时、多周轮换、组件布局和自定义文本等设置。
- `软件设置` 中的样式设置可以修改界面样式，也可以直接编辑 `resources/app/js/settings.js` 中的 `css_style` 或 `resources/app/css/style.css`。
- 多周课表轮换的偏移量保存在 `resources/app/js/settings.js` 的 `rotation_offset` 中。
- 菜单中的 `课上计时` 可以控制上课期间是否显示倒计时。
- 菜单中的 `上课隐藏` 可以控制上课期间是否隐藏课表、星期栏和倒计时等内容。
- 同时开启 `课上计时` 和 `上课隐藏` 后，可以实现上课期间仅显示倒计时窗口。

### 自定义每天加载的课表

`scheduleConfig.js` 中的 `daily_class` 用于定义课表内容，可以继续添加任意数量的课���。`daily_schedule` 用于指定星期日到星期六分别加载哪一个课表，数组中的数字对应 `daily_class` 的下标。

例如：

```js
"daily_schedule": [
    5, 1, 8, 1, 5, 9, 0
]
```

上例表示：星期日加载第 6 个课表，星期一加载第 2 个课表，星期二加载第 9 个课表，以此类推。未设置 `daily_schedule` 时，会按照星期顺序加载课表，以兼容旧版配置文件。

### 多周课表轮换

在 `daily_class` 的 `classList` 中，可以使用数组配置需要轮换的课程：

```js
["周练@语", "周练@英"]
```

软件会根据当前轮换周数选择数组中的课程。可以在 `settings.js` 的 `rotation_offset` 中为两周、三周或四周课表设置轮换偏移量。

### 课程融合

通过托盘菜单中的 `课程融合` 可以将连续的课程合并显示。课程融合支持设置起始课程、结束课程和显示课程，并可以选择是否忽略中间的课间时间，适合连堂课、考试等场景。

## 源码运行与打包

**注意：** 如果您只想使用软件，可以跳过本部分。直接修改打包后的软件文件可能会导致更新、调试和提交代码时出现问题，建议先克隆本仓库。

1. 安装 Node.js v20 或以上版本。
2. 安装 Visual Studio 2019 或以上版本，并安装 C++ 桌面开发工具。
3. 安装 Python v3.8 或以上版本。
4. 使用 Git 克隆本仓库：

   ```bash
   git clone https://github.com/EnderWolf006/ElectronClassSchedule.git
   cd ElectronClassSchedule
   ```

5. 安装项目依赖：

   ```bash
   npm install
   ```

6. 执行 Electron 原生模块重建：

   ```bash
   npx electron-rebuild
   ```

7. 启动开发版本：

   ```bash
   npm start
   ```

8. 打包程序：

   ```bash
   npm run build
   ```

打包完成后，生成的程序位于项目根目录的 `out` 文件夹中。

如果需要兼容 Windows 7/8 系统，可以根据项目依赖情况安装 Electron 22.3.27：

```bash
npm install electron@22.3.27
```

### WinUI 外壳

项目中的 `winui-shell` 是一个独立的 Windows .NET 8 外壳程序，使用 WebView2 加载课程表页面，并提供窗口控制、置顶、点击穿透、文件操作和电源状态等原生功能。

进入 `winui-shell` 目录后，可以使用以下命令编译：

```bash
dotnet build
```

WinUI 外壳与 Electron 主程序相互独立，不影响 Electron 版本的运行和打包。

## 开源协议

本软件遵循 `GPLv3` 开源协议。

- 可以自由复制和分发本软件。
- 可以在遵守 GPLv3 协议的前提下修改本软件。
- 使用本项目代码的衍生项目也需要遵守相应的开源协议。
- 软件按现状提供，不对使用本软件造成的任何直接或间接损失负责。
