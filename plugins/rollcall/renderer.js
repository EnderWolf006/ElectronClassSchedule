// 点名插件（主窗口渲染脚本）：注册“点名”组件，显示本节已点到的名单。
// 组件由主界面的插件宿主渲染到 .pluginComponent 容器中。
(function () {
    var host = window.pluginHost;
    if (!host) return;

    var lastRefresh = 0;
    var lastText = null;

    function refresh(container, options) {
        var prefix = String((options && options.prefix) || '已点：');
        var emptyText = String((options && options.emptyText) || '本节未被点名');
        host.ipcRenderer.invoke('plugin:rollcall:get-state').then(function (state) {
            var text = emptyText;
            if (state && Array.isArray(state.drawn) && state.drawn.length) {
                text = prefix + state.drawn.join(' ');
            }
            if (text !== lastText) {
                lastText = text;
                container.textContent = text;
                container.title = text;
            }
        }).catch(function () {
            // 插件停用或通道不存在时静默（保留原有内容）
        });
    }

    host.registerComponent('rollcall', {
        render: function (container, options) {
            lastText = null;
            refresh(container, options);
        },
        update: function (container, options) {
            // tick 每秒触发：内部节流到 1.5 秒，避免频繁 IPC
            var now = Date.now();
            if (now - lastRefresh < 1500) return;
            lastRefresh = now;
            refresh(container, options);
        },
    });
})();