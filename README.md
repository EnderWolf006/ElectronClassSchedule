<!-- > <font color=red>本分支为 `ECS v1` 个人修改版本，非原版，新增了部分功能。如需体验原版，请访问[ElectronClassSchedule](https://github.com/EnderWolf006/ElectronClassSchedule)。原作者：[@EnderWolf](https://github.com/EnderWolf006)（以下简称“原作者”）</font> -->

> 本分支为 `ECS v1` 个人修改版本，非原版。如需体验原版，请访问[ElectronClassSchedule](https://github.com/EnderWolf006/ElectronClassSchedule)
> `ECS v2` [传送门](https://github.com/EnderWolf006/ElectronClassSchedule/tree/ECS2.0) 正在开发中，将由 [@AwA](https://github.com/aawwaaa) 全权维护，敬请期待。
> 原作者：[@EnderWolf](https://github.com/EnderWolf006)（以下简称“原作者”）

# 电子课程表

![view](image/README/view.png)


## 软件介绍
来源于[原作者](https://github.com/EnderWolf006)。

- 本软件具有显示当天课表，当前星期，天数倒计时，下课/上课倒计时等功能。
- 支持动态调整课表，支持多周(最多四周)课表轮换，窗口置顶且可点击穿透。
- 使用Html + CSS + JavaScript三件套制作，使用Node.js+Electron完善系统级功能并打包。
- 新增了课表编辑。现在可以使用软件自带的编辑器编辑课表，而不是只能编辑文件。

## 食用说明
改编自[原作者](https://github.com/EnderWolf006)。
以下为在Windows系统下的使用方法

- 右侧Releases中下载Latest版本解压，`classSchedule.exe` 为程序主文件
- 在软件任务栏图标中右键菜单，单击 `编辑配置`即可配置课表（或者打开 `resources/app/js/scheduleConfig.js` 配置课表）
- 在软件任务栏图标中右键菜单，单击 `软件设置`即可调整星期栏、倒计时和多周轮换等全局设置
- `软件设置`左侧的 `样式设置` 可修改 `resources/app/js/settings.js` 中的 `css_style`，也可直接编辑 `resources/app/css/style.css` 中的颜色、字体和布局样式
- 多周课表轮换偏移保存在 `resources/app/js/settings.js` 的 `rotation_offset` 中
- `软件设置`左侧的 `组件设置` 可添加或删除星期、倒计日期、时间和自定义文本组件，并将它们与课表排列到不同的行；可拖动组件卡片或行号调整顺序，也可用按钮完成相同操作。布局保存在 `resources/app/js/settings.js` 的 `component_layout` 中。自定义文本内容保存在同一文件的 `custom_text` 中，使用倒计时字体、白色和课表主字号显示。星期、倒计日期和时间的显示选项位于组件特定设置中，时间组件可选择偏移时间或系统时间，课表组件包含每节课的倒计时，不会被其他组件的排列影响
- 设置菜单可以通过点击左侧的星期框中的中文角标或系统托盘打开。
- 菜单中 `课上计时` 选项可控制倒计时部分在上课时间是否显示
- 菜单中 `上课隐藏` 选项可控制课表本体、星期以及倒计时部分在上课时间是否显示
- 若将 `课上计时` 与 `上课隐藏` 同时开启(推荐默认开启)可实现课上仅显示倒计时小窗口

### 自定义每天加载的课表

`scheduleConfig.js` 中的 `daily_class` 是静态课表定义，可以继续追加任意数量的课表。新增的 `daily_schedule` 用来指定每天加载哪一个课表，数组位置按星期日到星期六排列，值是 `daily_class` 的数组索引。例如：

```js
"daily_schedule": [
	5, 1, 8, 1, 5, 9, 0
]
```

上例表示星期日加载第 6 个课表、星期一加载第 2 个课表、星期二加载第 9 个课表，以此类推。未设置 `daily_schedule` 时会继续按原来的星期顺序加载，旧配置无需修改。

## 修改说明
本说明来源于[原作者](https://github.com/EnderWolf006)。

- **注意：** 阅读以下内容需要一定的编程知识储备。如果您想修改软件源码自行打包（Windows），请阅读此部分内容。若您仅想使用本软件，请跳过此部分内容。
- **声明：** 强烈不推荐直接在打包后的软件中修改源码，这将导致更新新版本与提交 PR 等操作无法顺利进行。
1. 安装 Node.js v20 或以上版本。
2. 安装 Visual Studio v2019 或以上版本。
3. 安装 Python v3.8 或以上版本。
4. 使用 Git 克隆本仓库代码：在终端中执行 `git clone https://github.com/EnderWolf006/ElectronClassSchedule.git`。
5. 在本项目根目录中打开终端并执行 `pip install setuptools`。
6. 在本项目根目录中打开终端并执行 `npm install`。
7. 若需兼容 Windows7/8 系统，需额外执行 `npm install electron@22.3.27`。
8. 在本项目根目录中打开终端并执行 `node_modules/.bin/electron-rebuild`。
9. 在本项目根目录中打开终端并执行 `npm run build`。

- 执行上述环境及命令后，将在根目录生成一个 `out` 文件夹，其中包含您本地打包好的软件文件。
- 然后您可以修改软件代码，使用 `npm start` 调试，使用 `npm run build` 打包。
- 如果您认为您修改开发的软件内容可能对其他人有相似需求，您可以通过 Git 向主分支 `main` 提交 PR（Pull Request）。通过合并后，您的代码将并入主分支，为更多的人提供便利。

## 开源协议

来源于[原作者](https://github.com/EnderWolf006)。
本软件遵循 `GPLv3` 开源协议，以下为该协议内容解读摘要:

* 可自由复制 你可以将软件复制到你的电脑，你客户的电脑，或者任何地方。复制份数没有任何限制
* 可自由分发 在你的网站提供下载，拷贝到U盘送人，或者将源代码打印出来从窗户扔出去（环保起见，请别这样做）。
* 可以用来盈利 你可以在分发软件的时候收费，但你必须在收费前向你的客户提供该软件的 GNU GPL 许可协议，以便让他们知道，他们可以从别的渠道免费得到这份软件，以及你收费的理由。
* 可自由修改 如果你想添加或删除某个功能，没问题，如果你想在别的项目中使用部分代码，也没问题，唯一的要求是，使用了这段代码的项目也必须使用 GPL 协议。
* 如果有人和接收者签了合同性质的东西，并提供责任承诺，则授权人和作者不受此责任连带。
