<!-- > <font color=red>本分支为 `ECS v1` 版本，如无严重漏洞将不会继续维护更新，推荐使用 `ECS v2` [传送门](https://github.com/EnderWolf006/ElectronClassSchedule/tree/ECS2.0)</font> -->

> 本分支为 `ECS v1` 版本，如无严重漏洞将不会继续维护更新。 
> `ECS v2` [传送门](https://github.com/EnderWolf006/ElectronClassSchedule/tree/ECS2.0) 正在开发中，将由 [@AwA](https://github.com/aawwaaa) 全权维护，敬请期待。

# 电子课程表

![view](image/README/view.png)


## 软件介绍

- 本软件具有显示当天课表，当前星期，天数倒计时，下课/上课倒计时等功能。
- 支持动态调整课表，支持多周(最多四周)课表轮换，窗口置顶且可点击穿透。
- 使用Html + CSS + JavaScript三件套制作，使用Node.js+Electron完善系统级功能并打包。
- 软件由一位高三牲制作，含有大量屎山代码，望大家海涵。
- 在电子白板在学校普及的今天，欢迎大家下载体验与分享，但也请不要用于商业用途。
- 喜欢本项目的话，点击右上角的Star或发视频宣传一波支持一下作者吧😘
- [【点我加群】电子课程表QQ交流二群: 914887202](https://qm.qq.com/cgi-bin/qm/qr?k=SL4_VQ9Zmpch-64RbYhkKbTZ5cNjIZ-N&jump_from=webapi&authKey=kxhiNZcQZwoSC/85e3dPxUsL+kpaLIBmxbrcfRLjSJeH35o0D0a/tHBVYI1as5p1)

## 食用说明
以下为在Windows系统下的使用方法，其他操作系统请各位大佬自行拉取仓库打包

- 右侧Releases中下载Latest版本解压，`classSchedule.exe` 为程序主文件
- 打开 `resources/app/js/scheduleConfig.js` 配置课表，里面有详细的注释
- 设置菜单可以通过点击左侧的星期框中的中文角标或系统托盘打开。
- 菜单中 `课上计时` 选项可控制倒计时部分在上课时间是否显示
- 菜单中 `上课隐藏` 选项可控制课表本体、星期以及倒计时部分在上课时间是否显示
- 若将 `课上计时` 与 `上课隐藏` 同时开启(推荐默认开启)可实现课上仅显示倒计时小窗口

或者..尝试终极解决方案：邮箱联系 `enderwolf006@gmail.com` ，如果我有空我可以为你的安装提供帮助，当然你也可以来和我交流问题😊

## 修改说明
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

本软件遵循 `GPLv3` 开源协议，以下为该协议内容解读摘要:

* 可自由复制 你可以将软件复制到你的电脑，你客户的电脑，或者任何地方。复制份数没有任何限制
* 可自由分发 在你的网站提供下载，拷贝到U盘送人，或者将源代码打印出来从窗户扔出去（环保起见，请别这样做）。
* 可以用来盈利 你可以在分发软件的时候收费，但你必须在收费前向你的客户提供该软件的 GNU GPL 许可协议，以便让他们知道，他们可以从别的渠道免费得到这份软件，以及你收费的理由。
* 可自由修改 如果你想添加或删除某个功能，没问题，如果你想在别的项目中使用部分代码，也没问题，唯一的要求是，使用了这段代码的项目也必须使用 GPL 协议。
* 如果有人和接收者签了合同性质的东西，并提供责任承诺，则授权人和作者不受此责任连带。
