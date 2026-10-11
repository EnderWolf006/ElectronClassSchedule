// 点名插件设置界面（软件设置 → 插件 → 点名）。
// 宿主（PluginsPage）加载本脚本后，用 window.__pluginSettingsMounts['rollcall'](container, api) 挂载。
(function () {
    window.__pluginSettingsMounts = window.__pluginSettingsMounts || {};

    var DEFAULT_COLOR = '#114514';

    function parseNames(text) {
        return String(text || '')
            .split(/[\n\r,，、;；\t]+/)
            .map(function (name) { return name.trim(); })
            .filter(Boolean);
    }

    function isValidColor(value) {
        return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
    }

    window.__pluginSettingsMounts['rollcall'] = function mount(container, api) {
        container.innerHTML = [
            '<div class="field">',
            '  <label>名单（每行一个，也可用逗号 / 顿号 / 分号分隔）</label>',
            '  <textarea id="rcNames" placeholder="张三&#10;李四&#10;王五"></textarea>',
            '</div>',
            '<div class="row">',
            '  <button class="primary" id="rcSave">保存名单</button>',
            '  <button id="rcImport">从 txt 导入…</button>',
            '  <button id="rcReset">清空本节抽取记录</button>',
            '</div>',
            '<div class="field" style="margin-top:18px">',
            '  <label>点名提醒颜色</label>',
            '  <div class="row">',
            '    <input type="color" id="rcColor" value="' + DEFAULT_COLOR + '">',
            '    <button id="rcColorReset">恢复默认</button>',
            '  </div>',
            '  <div class="hint" id="rcColorHint"></div>',
            '</div>',
            '<div class="hint" id="rcHint">正在读取名单…</div>',
        ].join('');

        var textarea = container.querySelector('#rcNames');
        var hint = container.querySelector('#rcHint');
        var colorInput = container.querySelector('#rcColor');
        var colorHint = container.querySelector('#rcColorHint');
        var colorTimer = 0;
        // 插件设置的本地副本：保存时整体写回，避免只写 names 时丢掉其他设置
        var state = { names: [], reminderColor: '' };

        function persist() {
            var payload = { names: state.names };
            if (state.reminderColor) payload.reminderColor = state.reminderColor;
            return api.saveSettings(payload);
        }

        function updateColorHint() {
            colorHint.textContent = state.reminderColor
                ? '本插件使用自定义颜色 ' + state.reminderColor + '；“恢复默认”后跟随系统强调色。'
                : '当前跟随系统强调色（Windows 设置 → 个性化 → 颜色）。';
        }

        function updateNamesHint() {
            hint.textContent = state.names.length
                ? '当前名单 ' + state.names.length + ' 人；每节课内每人最多被抽到一次，机会均等。'
                : '尚未设置名单。可粘贴，或点击“从 txt 导入…”。';
        }

        api.getSettings().then(function (settings) {
            state.names = Array.isArray(settings.names) ? settings.names : [];
            state.reminderColor = isValidColor(settings.reminderColor) ? String(settings.reminderColor).toLowerCase() : '';
            textarea.value = state.names.join('\n');
            if (state.reminderColor) colorInput.value = state.reminderColor;
            updateNamesHint();
            updateColorHint();
        }).catch(function () {
            hint.textContent = '读取插件设置失败。';
        });

        container.querySelector('#rcSave').addEventListener('click', function () {
            state.names = parseNames(textarea.value);
            textarea.value = state.names.join('\n');
            persist().then(function () {
                updateNamesHint();
                api.notify('点名名单已保存（' + state.names.length + ' 人）');
            }).catch(function (error) {
                hint.textContent = '保存失败：' + (error && error.message ? error.message : error);
            });
        });

        container.querySelector('#rcImport').addEventListener('click', function () {
            api.invoke('import-txt').then(function (result) {
                if (!result || !result.names) return;
                state.names = result.names;
                textarea.value = state.names.join('\n');
                return persist().then(function () {
                    updateNamesHint();
                    api.notify('已从 ' + result.file + ' 导入 ' + state.names.length + ' 人');
                });
            }).catch(function (error) {
                hint.textContent = '导入失败：' + (error && error.message ? error.message : error);
            });
        });

        container.querySelector('#rcReset').addEventListener('click', function () {
            api.invoke('reset-drawn').then(function () {
                api.notify('已清空抽取记录（下一节课重新开始）');
            }).catch(function (error) {
                hint.textContent = '操作失败：' + (error && error.message ? error.message : error);
            });
        });

        // 颜色保存到插件侧（不触发主窗口重载）
        function saveColor() {
            return api.invoke('set-reminder-color', { color: state.reminderColor });
        }

        // 取色过程中只更新界面不落盘；关闭取色器（change）或失焦后才保存，
        // 避免“刚动一下颜色就被保存”导致取色器被关闭
        colorInput.addEventListener('input', function () {
            state.reminderColor = isValidColor(colorInput.value) ? colorInput.value.toLowerCase() : '';
            updateColorHint();
        });

        colorInput.addEventListener('change', function () {
            state.reminderColor = isValidColor(colorInput.value) ? colorInput.value.toLowerCase() : '';
            updateColorHint();
            saveColor().catch(function () {
                colorHint.textContent = '颜色保存失败。';
            });
        });

        container.querySelector('#rcColorReset').addEventListener('click', function () {
            state.reminderColor = '';
            colorInput.value = DEFAULT_COLOR;
            updateColorHint();
            clearTimeout(colorTimer);
            saveColor().then(function () {
                api.notify('点名提醒已恢复为默认颜色');
            }).catch(function () {
                colorHint.textContent = '颜色保存失败。';
            });
        });

        return function cleanup() {
            clearTimeout(colorTimer);
        };
    };
})();