// 常用应用插件（主进程）：
// - 应用列表保存在 settings.plugins.apps.items（{ id, name, target }，target 为 lnk 路径；
//   导入 exe 时自动在插件目录 shortcuts/ 下创建快捷方式）；
// - 右下角浮窗（panel.html）最多显示 10 个应用：1-5 个一行、6-10 个两行；
// - 课表窗口为“右侧竖排”（window_position=right）时，浮窗左移到课表条左侧避免遮挡；
// - 图标通过 PowerShell（System.Drawing）从 exe / lnk 中提取并缓存到插件目录 icons/。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const createShortcut = require('windows-shortcuts');

const MAX_APPS = 10;
const ICON_CELL_MIN = 56;   // 每个应用格子的最小宽度
const PANEL_PADDING = 12;
const TITLE_HEIGHT = 34;

module.exports = function activate(api) {
    const { shell, screen } = api;
    let panelWin = null;
    let repositionTimer = 0;

    const iconsDir = api.resolve('icons');
    const shortcutsDir = api.resolve('shortcuts');

    const ensureDirs = () => {
        [iconsDir, shortcutsDir].forEach((dir) => {
            try { fs.mkdirSync(dir, { recursive: true }); } catch (error) { /* 忽略 */ }
        });
    };

    // ===== 列表读写 =====
    const readItems = () => {
        const settings = api.getSettings();
        const items = Array.isArray(settings.items) ? settings.items : [];
        return items
            .filter((item) => item && item.id && typeof item.target === 'string')
            .map((item) => ({
                id: String(item.id),
                name: String(item.name || path.basename(item.target, path.extname(item.target))),
                target: String(item.target),
            }))
            .filter((item) => fs.existsSync(item.target));
    };

    const writeItems = (items) => {
        const settings = api.getSettings();
        api.saveSettings({ ...settings, items });
    };

    const iconPathOf = (id) => path.join(iconsDir, `${id}.png`);
    const iconUrlOf = (id) => {
        const file = iconPathOf(id);
        return fs.existsSync(file) ? pathToFileURL(file).href : null;
    };

    // 图标尚未生成时按需提取（异步），完成后通知浮窗刷新
    const iconPending = new Set();
    const ensureIcons = (items) => {
        items.forEach((item) => {
            if (iconUrlOf(item.id) || iconPending.has(item.id)) return;
            iconPending.add(item.id);
            extractIcon(item).then(() => {
                iconPending.delete(item.id);
                if (iconUrlOf(item.id)) notifyPanel();
            });
        });
    };

    const listPayload = () => {
        const items = readItems();
        ensureIcons(items);
        return {
            max: MAX_APPS,
            display: readDisplay(),
            items: items.map((item) => ({ ...item, icon: iconUrlOf(item.id) })),
        };
    };

    // 图标提取（异步、结果缓存到插件目录；失败时前端显示首字母占位）
    const extractIcon = (item) => new Promise((resolve) => {
        const out = iconPathOf(item.id);
        if (fs.existsSync(out)) { resolve(); return; }
        const script = api.resolve('extract-icon.ps1');
        if (!fs.existsSync(script)) { resolve(); return; }
        execFile('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', script, '-Path', item.target, '-Out', out,
        ], { windowsHide: true, timeout: 30000 }, () => resolve());
    });

    const notifyPanel = () => {
        api.broadcast('plugin:apps:changed', listPayload());
    };

    // ===== 显示参数（窗口大小 / 图标大小）=====
    const clampNumber = (value, min, max, fallback) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };
    const readDisplay = () => {
        const settings = api.getSettings();
        return {
            panelScale: clampNumber(settings.panelScale, 0.7, 1.6, 1),
            iconSize: Math.round(clampNumber(settings.iconSize, 20, 64, 36)),
        };
    };
    // 格子宽度/行高由图标大小与窗口缩放共同决定；内边距、文字随窗口缩放
    const metricsOf = (display) => {
        const scale = display.panelScale;
        return {
            cell: Math.round(Math.max(ICON_CELL_MIN, display.iconSize + 26) * scale),
            rowHeight: Math.round((display.iconSize + 46) * scale),
            padding: Math.round(PANEL_PADDING * scale),
        };
    };

    // ===== 浮窗尺寸与位置 =====
    // 最多 10 个：1-5 个一行；6-10 个两行（每行 5 个）。空列表时给一个最小宽度显示提示。
    const panelSize = (count, display) => {
        const rows = count > 5 ? 2 : 1;
        const perRow = count > 5 ? 5 : Math.max(count, 3);
        const { cell, rowHeight, padding } = metricsOf(display);
        return {
            width: padding * 2 + perRow * cell,
            height: TITLE_HEIGHT + rows * rowHeight + padding,
        };
    };

    // 浮窗必须位于最底层：调用 user32 SetWindowPos(HWND_BOTTOM) 压到窗口栈底
    // （窗口创建时设置了 focusable:false，点击不会激活/抬起它）
    const sendToBottom = () => {
        if (!panelWin || panelWin.isDestroyed()) return;
        const script = api.resolve('set-window-bottom.ps1');
        if (!fs.existsSync(script)) return;
        let handleText = '';
        try {
            const buffer = panelWin.getNativeWindowHandle();
            handleText = buffer.length >= 8
                ? buffer.readBigInt64LE(0).toString()
                : String(buffer.readUInt32LE(0));
        } catch (error) {
            return;
        }
        execFile('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', script, '-Handle', handleText,
        ], { windowsHide: true, timeout: 15000 }, () => { /* 失败不影响使用 */ });
    };

    const positionPanel = () => {
        if (!panelWin || panelWin.isDestroyed()) return;
        const count = readItems().length;
        const { width, height } = panelSize(count, readDisplay());
        const { workArea } = screen.getPrimaryDisplay();
        const margin = 12;
        let x = workArea.x + workArea.width - width - margin;
        const y = workArea.y + workArea.height - height - margin;
        // 课表为“右侧竖排”时窗口贴屏幕右缘：浮窗移到课表条左侧，避免被遮挡
        const mode = (api.readAppSettings() || {}).window_position || 'top';
        const mainWin = api.getMainWindow();
        if (mode === 'right' && mainWin && !mainWin.isDestroyed()) {
            const bounds = mainWin.getBounds();
            x = Math.min(x, bounds.x - width - margin);
        }
        x = Math.max(workArea.x + margin, x);
        panelWin.setBounds({ x, y, width, height });
    };

    const scheduleReposition = () => {
        clearTimeout(repositionTimer);
        repositionTimer = setTimeout(() => {
            try {
                if (panelWin && !panelWin.isDestroyed()) {
                    const count = readItems().length;
                    const { width, height } = panelSize(count, readDisplay());
                    const bounds = panelWin.getBounds();
                    if (bounds.width !== width || bounds.height !== height) {
                        panelWin.setBounds({ ...bounds, width, height });
                    }
                    positionPanel();
                    sendToBottom();
                }
            } catch (error) {
                api.log('浮窗定位失败:', error && error.message);
            }
        }, 60);
    };

    const createPanel = () => {
        if (panelWin && !panelWin.isDestroyed()) return panelWin;
        ensureDirs();
        const count = readItems().length;
        const { width, height } = panelSize(count, readDisplay());
        panelWin = api.createWindow({
            width,
            height,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            show: false,
            hasShadow: false,
            // 不置顶且不可激活：点击不会把浮窗抬到最前，配合 sendToBottom 固定在窗口栈底
            alwaysOnTop: false,
            focusable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false,
            },
        });
        panelWin.loadFile(api.resolve('panel.html'));
        panelWin.once('ready-to-show', () => {
            positionPanel();
            panelWin.showInactive();
            sendToBottom();
        });
        panelWin.on('show', () => sendToBottom());
        panelWin.on('closed', () => { panelWin = null; });
        return panelWin;
    };

    // ===== IPC（设置界面 / 浮窗共用） =====
    api.registerIpc('list', async () => listPayload());

    api.registerIpc('add', async () => {
        const mainWin = api.getMainWindow();
        const result = await api.dialog.showOpenDialog(mainWin || undefined, {
            title: '选择要添加的应用（.lnk 快捷方式或 .exe 程序）',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: '应用 / 快捷方式', extensions: ['lnk', 'exe'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        });
        if (result.canceled || !result.filePaths.length) return null;
        ensureDirs();
        const items = readItems();
        const added = [];
        const skipped = [];
        for (const filePath of result.filePaths) {
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== '.lnk' && ext !== '.exe') {
                skipped.push(`${path.basename(filePath)}（仅支持 lnk / exe）`);
                continue;
            }
            if (items.length + added.length >= MAX_APPS) {
                skipped.push(`${path.basename(filePath)}（最多 ${MAX_APPS} 个）`);
                continue;
            }
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
            let target = filePath;
            let name = path.basename(filePath, ext);
            if (ext === '.exe') {
                // exe：在插件目录创建快捷方式（与用户要求一致），后续统一用 lnk 启动
                const lnkPath = path.join(shortcutsDir, `${name}.lnk`);
                try {
                    await new Promise((resolve, reject) => {
                        createShortcut.create(lnkPath, {
                            target: filePath,
                            workingDir: path.dirname(filePath),
                            icon: filePath,
                        }, (error) => (error ? reject(error) : resolve()));
                    });
                    target = lnkPath;
                } catch (error) {
                    api.log('创建快捷方式失败，回退为直接启动 exe:', error && error.message);
                    target = filePath;
                }
            }
            const item = { id, name, target };
            added.push(item);
            await extractIcon(item);
        }
        if (added.length) {
            writeItems([...items, ...added]);
            notifyPanel();
            scheduleReposition();
        }
        return { added, skipped, ...listPayload() };
    });

    api.registerIpc('remove', async (payload) => {
        const id = payload && payload.id;
        const items = readItems();
        const next = items.filter((item) => item.id !== id);
        if (next.length !== items.length) {
            writeItems(next);
            try {
                const icon = iconPathOf(id);
                if (fs.existsSync(icon)) fs.unlinkSync(icon);
            } catch (error) { /* 忽略 */ }
            notifyPanel();
            scheduleReposition();
        }
        return listPayload();
    });

    api.registerIpc('open', async (payload) => {
        const id = payload && payload.id;
        const item = readItems().find((entry) => entry.id === id);
        if (!item) return { error: '应用不存在（可能已被移动或删除）' };
        const error = await shell.openPath(item.target);
        return error ? { error } : { ok: true };
    });

    // 浮窗里的“设置”按钮：打开软件设置的插件页
    api.registerIpcListener('open-settings', () => {
        api.openSoftwareSettings('plugins');
    });

    // 显示参数（窗口大小 / 图标大小）：保存后立即重排浮窗并广播给浮窗刷新
    api.registerIpc('set-display', async (payload) => {
        const settings = api.getSettings();
        const display = readDisplay();
        const next = { ...settings };
        if (payload && payload.panelScale !== undefined) {
            next.panelScale = clampNumber(payload.panelScale, 0.7, 1.6, display.panelScale);
        }
        if (payload && payload.iconSize !== undefined) {
            next.iconSize = Math.round(clampNumber(payload.iconSize, 20, 64, display.iconSize));
        }
        api.saveSettings(next);
        scheduleReposition();
        notifyPanel();
        return listPayload();
    });

    // ===== 生命周期 =====
    createPanel();
    // 位置模式等全局设置变化后重新定位（save-settings-file 会触发）
    api.onSettingsChanged(() => scheduleReposition());
    const onDisplayChange = () => scheduleReposition();
    try { screen.on('display-metrics-changed', onDisplayChange); } catch (error) { /* 忽略 */ }

    return {
        cleanup: () => {
            clearTimeout(repositionTimer);
            try { screen.removeListener('display-metrics-changed', onDisplayChange); } catch (error) { /* 忽略 */ }
        },
    };
};