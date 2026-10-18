// 常用应用插件设置界面（软件设置 → 插件 → 常用应用）。
// 宿主（PluginsPage）加载本脚本后，用 window.__pluginSettingsMounts['apps'](container, api) 挂载。
(function () {
    window.__pluginSettingsMounts = window.__pluginSettingsMounts || {};

    window.__pluginSettingsMounts['apps'] = function mount(container, api) {
        container.innerHTML = [
            '<div class="field">',
            '  <label>窗口大小：<b id="apScaleValue">100%</b></label>',
            '  <input type="range" id="apScale" min="70" max="160" step="5" value="100">',
            '  <label>图标大小：<b id="apIconValue">36px</b></label>',
            '  <input type="range" id="apIcon" min="20" max="64" step="2" value="36">',
            '  <div class="hint">拖动后立即生效：窗口大小按比例缩放整个浮窗，图标大小只调整图标尺寸。</div>',
            '</div>',
            '<div class="hint" id="apHint">正在读取应用列表…</div>',
            '<div class="row">',
            '  <button class="primary" id="apAdd">添加应用…</button>',
            '  <button id="apFolder">打开插件文件夹</button>',
            '</div>',
            '<div class="list" id="apList"></div>',
            '<div class="hint">支持 .lnk 快捷方式与 .exe 程序（exe 会自动创建快捷方式）。最多 10 个，'
            + '1-5 个显示为一行、6-10 个显示为两行；课表为“右侧竖排”时浮窗会自动避让，浮窗始终位于其他窗口下层。</div>',
        ].join('');

        var listEl = container.querySelector('#apList');
        var hint = container.querySelector('#apHint');
        var scaleInput = container.querySelector('#apScale');
        var iconInput = container.querySelector('#apIcon');
        var scaleValue = container.querySelector('#apScaleValue');
        var iconValue = container.querySelector('#apIconValue');
        var displayTimer = 0;

        function applyDisplay(display) {
            if (!display) return;
            var scale = Math.round((Number(display.panelScale) || 1) * 100);
            var icon = Math.round(Number(display.iconSize) || 36);
            scaleInput.value = String(scale);
            iconInput.value = String(icon);
            scaleValue.textContent = scale + '%';
            iconValue.textContent = icon + 'px';
        }

        // 拖动滑块：本地立即显示数值，防抖 180ms 后保存（主进程会同步缩放浮窗）
        function pushDisplay() {
            var scalePercent = Number(scaleInput.value) || 100;
            var icon = Number(iconInput.value) || 36;
            scaleValue.textContent = Math.round(scalePercent) + '%';
            iconValue.textContent = Math.round(icon) + 'px';
            clearTimeout(displayTimer);
            displayTimer = setTimeout(function () {
                api.invoke('set-display', { panelScale: scalePercent / 100, iconSize: icon }).catch(function () {
                    hint.textContent = '保存显示设置失败。';
                });
            }, 180);
        }
        scaleInput.addEventListener('input', pushDisplay);
        iconInput.addEventListener('input', pushDisplay);

        function renderList(payload) {
            var items = payload && Array.isArray(payload.items) ? payload.items : [];
            hint.textContent = items.length + ' / ' + (payload && payload.max ? payload.max : 10) + ' 个应用';
            if (payload && payload.display) applyDisplay(payload.display);
            listEl.innerHTML = '';
            items.forEach(function (item) {
                var row = document.createElement('div');
                row.className = 'list-item';
                if (item.icon) {
                    var img = document.createElement('img');
                    img.src = item.icon;
                    img.width = 20;
                    img.height = 20;
                    img.style.borderRadius = '4px';
                    row.appendChild(img);
                }
                var name = document.createElement('span');
                name.textContent = item.name;
                name.title = item.target;
                row.appendChild(name);
                var remove = document.createElement('button');
                remove.textContent = '删除';
                remove.addEventListener('click', function () {
                    api.invoke('remove', { id: item.id }).then(renderList);
                });
                row.appendChild(remove);
                listEl.appendChild(row);
            });
        }

        api.invoke('list').then(renderList).catch(function () {
            hint.textContent = '读取失败：插件未启用时无法管理应用列表。';
        });

        container.querySelector('#apAdd').addEventListener('click', function () {
            api.invoke('add').then(function (result) {
                if (!result) return;
                renderList(result);
                if (result.skipped && result.skipped.length) {
                    api.notify('部分文件未添加：' + result.skipped.join('；'));
                } else if (result.added && result.added.length) {
                    api.notify('已添加 ' + result.added.length + ' 个应用');
                }
            }).catch(function (error) {
                hint.textContent = '添加失败：' + (error && error.message ? error.message : error);
            });
        });

        container.querySelector('#apFolder').addEventListener('click', function () {
            api.openPluginsFolder();
        });

        // 主进程侧列表变化（例如浮窗中操作）时同步刷新
        var listener = null;
        try {
            listener = function (_event, payload) { renderList(payload); };
            window.require('electron').ipcRenderer.on('plugin:apps:changed', listener);
        } catch (error) { /* 非 Electron 环境忽略 */ }

        // 卸载时移除监听，避免重复挂载后回调叠加
        return function cleanup() {
            clearTimeout(displayTimer);
            try {
                if (listener) window.require('electron').ipcRenderer.removeListener('plugin:apps:changed', listener);
            } catch (error) { /* 忽略 */ }
        };
    };
})();