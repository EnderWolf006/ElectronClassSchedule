// 逐页面构建 renderer/ 下的多页入口。
// Electron 通过 file:// 加载页面，vite-plugin-singlefile 将 JS/CSS 全部内联进单个 HTML，
// 避免多 chunk 在 file:// 下的模块加载限制。
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pages = [
  'config-editor',
  'software-settings',
  'exit-confirm',
  'schedule-dialog',
  'course-fusion',
];

for (let i = 0; i < pages.length; i += 1) {
  const page = pages[i];
  process.stdout.write(`[renderer] building ${page}.html ...\n`);
  await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [react(), viteSingleFile()],
    root: resolve(root, 'renderer'),
    base: './',
    build: {
      outDir: resolve(root, 'dist'),
      emptyOutDir: i === 0,
      assetsInlineLimit: 100000000,
      chunkSizeWarningLimit: 100000000,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(root, 'renderer', `${page}.html`),
        output: {
          inlineDynamicImports: true,
          entryFileNames: `${page}.js`,
          assetFileNames: `${page}.[ext]`,
        },
      },
    },
  });
}

process.stdout.write('[renderer] all pages built into dist/\n');
