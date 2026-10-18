// 自绘托盘右键菜单（替代系统原生菜单，便于放大按钮/字体/图标）
const { ipcRenderer } = require('electron');

const RESTART_SVG = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 3v4h-4" /></svg>';

const menuEl = document.getElementById('menu');

function render(items) {
    menuEl.innerHTML = '';
    items.forEach((item) => {
        if (item.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'separator';
            menuEl.appendChild(sep);
            return;
        }
        const row = document.createElement('div');
        row.className = 'item';
        row.dataset.id = item.id;

        const iconBox = document.createElement('span');
        iconBox.className = 'icon';
        if (item.svg === 'restart') {
            iconBox.innerHTML = RESTART_SVG;
        } else if (item.svgText) {
            // 插件自带的内联 SVG 图标
            iconBox.innerHTML = item.svgText;
        } else if (item.icon) {
            const img = document.createElement('img');
            img.src = item.icon;
            img.draggable = false;
            iconBox.appendChild(img);
        }
        row.appendChild(iconBox);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.label;
        row.appendChild(label);

        if (item.type === 'checkbox') {
            const check = document.createElement('span');
            check.className = 'check';
            check.textContent = item.checked ? '\u2713' : '';
            row.appendChild(check);
        }

        row.addEventListener('click', () => {
            ipcRenderer.send('tray-menu-action', item.id);
        });
        menuEl.appendChild(row);
    });

    requestAnimationFrame(() => {
        // 上报含四周 18px 透明阴影边距的窗口总尺寸（与 main.js TRAY_MENU_SHADOW_MARGIN 一致）
        const m = 18;
        const h = menuEl.getBoundingClientRect().height + m * 2;
        ipcRenderer.send('tray-menu-size', { width: 248 + m * 2, height: Math.ceil(h) });
    });
}

ipcRenderer.on('tray-menu-data', (event, data) => {
    document.body.classList.toggle('dark', !!data.dark);
    render(data.items);
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ipcRenderer.send('tray-menu-close');
});

// 首次加载完成后通知主进程可以下发数据
ipcRenderer.send('tray-menu-ready');
