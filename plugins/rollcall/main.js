// 点名插件（主进程）：
// - 名单来自“软件设置 → 插件 → 点名”（settings.plugins.rollcall.names），支持从 txt 导入（逗号/换行分隔）；
// - 托盘菜单“点名”打开抽取人数选择窗，抽取结果通过主界面提醒显示；
// - 每次抽取从“本节候选中尚未被抽到的人”里等概率抽取（每人每节课最多一次；
//   候选不足时抽完剩余的人，本节抽完提示下节课重置）。
const fs = require('fs');
const path = require('path');

module.exports = function activate(api) {
    const { storage } = api;
    let promptResolver = null;

    // 抽完记录按“日期#节次开始时间”分组，仅保留最近 3 天的记录
    const readDrawn = () => {
        const value = storage.get('drawn', {});
        return value && typeof value === 'object' ? value : {};
    };
    const pruneDrawn = (drawn, todayKey) => {
        const days = Object.keys(drawn)
            .map((key) => String(key).split('#')[0])
            .filter((day) => day && day !== todayKey)
            .sort();
        const keep = new Set(days.slice(-2));
        const result = {};
        Object.keys(drawn).forEach((key) => {
            const day = String(key).split('#')[0];
            if (day === todayKey || keep.has(day)) result[key] = drawn[key];
        });
        return result;
    };

    const getNames = () => {
        const settings = api.getSettings();
        const names = Array.isArray(settings.names) ? settings.names : [];
        return names.map((name) => String(name).trim()).filter(Boolean);
    };

    const getPeriod = async () => {
        const mainWin = api.getMainWindow();
        if (!mainWin || mainWin.isDestroyed()) return { key: 'none', slotStart: '', isDuringClass: false };
        try {
            const raw = await mainWin.webContents.executeJavaScript(
                'typeof getCurrentPeriodKey === "function" ? JSON.stringify(getCurrentPeriodKey()) : ""',
                true
            );
            const value = raw ? JSON.parse(raw) : null;
            if (value && value.key) return value;
        } catch (error) {
            api.log('读取当前节次失败:', error && error.message);
        }
        return { key: 'none', slotStart: '', isDuringClass: false };
    };

    const currentState = async () => {
        const period = await getPeriod();
        const drawn = readDrawn();
        return {
            names: getNames(),
            drawn: drawn[period.key] || [],
            periodKey: period.key,
            periodSlot: period.slotStart,
        };
    };

    // 抽取：allowRepeat=true 时不做本节去重（每次都能抽到任何人，用于“快速点名”等场景）
    const draw = async (count, allowRepeat) => {
        const names = getNames();
        if (!names.length) {
            return { error: '尚未导入名单，请在“软件设置 → 插件 → 点名”中导入 txt 名单。' };
        }
        const period = await getPeriod();
        let drawnMap = readDrawn();
        const today = String(period.key).split('#')[0];
        drawnMap = pruneDrawn(drawnMap, today);
        const drawn = Array.isArray(drawnMap[period.key]) ? drawnMap[period.key] : [];
        const pool = allowRepeat ? names : names.filter((name) => !drawn.includes(name));
        if (!pool.length) {
            return {
                empty: true,
                message: '本节候选已全部抽完，下节课重置',
            };
        }
        const take = Math.max(1, Math.min(Math.floor(Number(count) || 1), pool.length));
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const picked = shuffled.slice(0, take);
        if (!allowRepeat) {
            drawnMap[period.key] = [...drawn, ...picked];
            storage.set('drawn', drawnMap);
        }
        return {
            picked,
            total: names.length,
            remaining: allowRepeat ? null : pool.length - take,
            allowRepeat: allowRepeat === true,
        };
    };

    // 提醒遮罩颜色：settings.plugins.rollcall.reminderColor（未设置时跟随主界面“提醒”页颜色）
    const reminderColorOf = () => {
        const value = String(api.getSettings().reminderColor || '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
    };
    const showReminder = (text, duration) => {
        const color = reminderColorOf();
        api.reminder.show(color ? { text, duration, color } : { text, duration });
    };

    // 抽取并显示提醒
    const drawAndNotify = async (count, allowRepeat) => {
        const result = await draw(count, allowRepeat);
        if (result.error) {
            showReminder(result.error, 5200);
            return result;
        }
        if (result.empty) {
            showReminder(result.message, 4200);
            return result;
        }
        const suffix = !allowRepeat && result.remaining === 0 ? '（本节已抽完）' : '';
        showReminder(result.picked.join('　') + suffix, 6000);
        api.broadcast('plugin:rollcall:changed', { picked: result.picked });
        return result;
    };

    // 人数选择窗：由 prompt.html 返回 { count } 或 null。
    // 收到结果或用户直接关窗后必须关闭窗口，否则窗口会常驻且主窗口置顶不会恢复。
    let promptWindow = null;

    const closePromptWindow = () => {
        const winObj = promptWindow;
        promptWindow = null;
        if (winObj && !winObj.isDestroyed()) {
            winObj.close();
        }
    };

    const askCount = (maxCount) => new Promise((resolve) => {
        // 连续触发托盘项时不叠加窗口：先关掉旧的选择窗
        closePromptWindow();
        promptResolver = resolve;
        const mainWin = api.getMainWindow();
        const restoreMainTop = () => {
            if (mainWin && !mainWin.isDestroyed() && api.store.get('isWindowAlwaysOnTop', true)) {
                mainWin.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
            }
        };
        if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(false);
        const promptWin = api.createWindow({
            width: 380,
            height: 260,
            frame: false,
            transparent: true,
            resizable: false,
            minimizable: false,
            maximizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            show: false,
            center: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        promptWindow = promptWin;
        promptWin.setAlwaysOnTop(true, 'screen-saver');
        promptWin.loadFile(api.resolve('prompt.html'), {
            query: {
                max: String(Math.max(1, maxCount)),
                last: String(Math.max(1, Math.floor(Number(storage.get('lastCount', 1)) || 1))),
                repeat: storage.get('lastAllowRepeat', false) === true ? '1' : '0',
            },
        });
        promptWin.once('ready-to-show', () => {
            if (!promptWin.isDestroyed()) promptWin.show();
        });
        promptWin.on('closed', () => {
            if (promptWindow === promptWin) promptWindow = null;
            restoreMainTop();
            if (promptResolver === resolve) {
                promptResolver = null;
                resolve(null);
            }
        });
    });

    api.registerIpcListener('prompt-result', (payload) => {
        const resolve = promptResolver;
        promptResolver = null;
        const count = payload && Number(payload.count) > 0
            ? Math.max(1, Math.floor(Number(payload.count)))
            : null;
        // 结果形如 { count, allowRepeat }；取消/关闭返回 null
        const answer = count ? { count, allowRepeat: payload.allowRepeat === true } : null;
        // 先关闭窗口（其 closed 处理器恢复主窗口置顶；promptResolver 已清空，不会重复 resolve）
        closePromptWindow();
        if (resolve) resolve(answer);
    });

    api.registerIpc('get-state', async () => currentState());

    // txt 导入：逗号 / 换行 / 顿号 / 分号分隔
    api.registerIpc('import-txt', async () => {
        const mainWin = api.getMainWindow();
        const result = await api.dialog.showOpenDialog(mainWin || undefined, {
            title: '导入名单（txt）',
            properties: ['openFile'],
            filters: [
                { name: '文本文件', extensions: ['txt', 'csv'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        });
        if (result.canceled || !result.filePaths.length) return null;
        const text = fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
        const names = text
            .split(/[\n\r,，、;；\t]+/)
            .map((name) => name.trim())
            .filter(Boolean);
        return { names, file: path.basename(result.filePaths[0]) };
    });

    api.registerIpc('reset-drawn', async () => {
        storage.set('drawn', {});
        return true;
    });

    // 单独保存提醒颜色：走插件侧保存（不触发主窗口 reload，调色时可即时生效）
    api.registerIpc('set-reminder-color', async (payload) => {
        const settings = api.getSettings();
        const value = String((payload && payload.color) || '').trim();
        const next = { ...settings };
        if (/^#[0-9a-fA-F]{6}$/.test(value)) next.reminderColor = value.toLowerCase();
        else delete next.reminderColor;
        api.saveSettings(next);
        return { reminderColor: next.reminderColor || '' };
    });

    api.registerIpc('draw', async (payload) => drawAndNotify(
        Number(payload && payload.count) || 1,
        payload && payload.allowRepeat === true,
    ));

    // 托盘菜单：快速点名（直接抽 1 人，允许重复）+ 自定义点名（选人数与是否允许重复）
    api.addTrayAction({
        id: 'rollcall-quick',
        label: '快速点名',
        svgText: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M4.8 20c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6"/><path d="M17.5 5.5 20 8l2.5-2.5"/></svg>',
        onClick: async () => {
            const names = getNames();
            if (!names.length) {
                showReminder('尚未导入名单，请在“软件设置 → 插件 → 点名”中导入 txt 名单。', 5200);
                return;
            }
            // 快速点名：直接抽取 1 人，且允许重复（不做本节去重）
            await drawAndNotify(1, true);
        },
    });

    api.addTrayAction({
        id: 'rollcall',
        label: '自定义点名',
        svgText: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M4.8 20c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6"/></svg>',
        onClick: async () => {
            const names = getNames();
            if (!names.length) {
                showReminder('尚未导入名单，请在“软件设置 → 插件 → 点名”中导入 txt 名单。', 5200);
                return;
            }
            const answer = await askCount(names.length);
            if (!answer || !answer.count) return;
            storage.set('lastCount', answer.count);
            storage.set('lastAllowRepeat', answer.allowRepeat === true);
            await drawAndNotify(answer.count, answer.allowRepeat === true);
        },
    });

    return {
        cleanup: () => {
            promptResolver = null;
        },
    };
};