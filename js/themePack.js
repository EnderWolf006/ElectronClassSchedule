// 主界面课表条（原生 HTML 窗口）的主题包加载器，与 renderer/src/common/themePack.js 行为一致。
(function () {
    var ipcRenderer = null;
    try {
        ipcRenderer = require('electron').ipcRenderer;
    } catch (error) {
        return;
    }

    var loadedFonts = [];
    var loadedLinks = [];

    function unloadThemePack() {
        loadedFonts.forEach(function (face) {
            try { document.fonts.delete(face); } catch (error) { /* 忽略 */ }
        });
        loadedLinks.forEach(function (link) { link.remove(); });
        loadedFonts = [];
        loadedLinks = [];
    }

    function applyThemePack(pack) {
        unloadThemePack();
        if (!pack) return;
        var fonts = Array.isArray(pack.fonts) ? pack.fonts : [];
        var chain = Promise.resolve();
        fonts.forEach(function (font) {
            chain = chain.then(function () {
                return new FontFace(
                    font.family,
                    'url("' + font.src + '")',
                    { weight: font.weight || 'normal', style: font.style || 'normal' }
                ).load().then(function (face) {
                    document.fonts.add(face);
                    loadedFonts.push(face);
                }).catch(function (error) {
                    console.error('[theme-pack] 字体加载失败:', font.family, error);
                });
            });
        });
        chain.then(function () {
            (Array.isArray(pack.css) ? pack.css : []).forEach(function (href) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.setAttribute('data-theme-pack', '1');
                document.head.appendChild(link);
                loadedLinks.push(link);
            });
        });
    }

    ipcRenderer.invoke('get-active-theme-pack').then(applyThemePack).catch(function () { /* 忽略 */ });
    ipcRenderer.on('active-theme-changed', function (_event, pack) {
        applyThemePack(pack);
    });
})();
