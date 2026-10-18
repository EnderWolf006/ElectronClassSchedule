// 将 image/icon-frames/<size>.png 组装为合规的多尺寸 Windows ICO。
// ICO 结构：ICONDIR(6B) + N 个 ICONDIRENTRY(各16B) + 各帧 PNG 数据。
// PNG 压缩帧从 Windows Vista 起受支持；多尺寸可保证资源管理器/任务栏
// 在任何 DPI 下都取到合适图层，而不会回退到 Electron 默认图标。
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const imageDir = join(here, '..', 'image');
const frameDir = join(imageDir, 'icon-frames');
const outPath = join(imageDir, 'icon.ico');

const files = readdirSync(frameDir)
  .filter((f) => /^\d+\.png$/.test(f))
  .map((f) => ({ size: Number(f.replace('.png', '')), path: join(frameDir, f) }))
  .sort((a, b) => a.size - b.size);

if (files.length === 0) {
  console.error('未找到任何图标帧：', frameDir);
  process.exit(1);
}

const frames = files.map((f) => ({ size: f.size, data: readFileSync(f.path) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(frames.length, 4);

const entries = [];
let offset = 6 + 16 * frames.length;
for (const { size, data } of frames) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width（0 表示 256）
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2);  // palette color count
  entry.writeUInt8(0, 3);  // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(entry);
}

writeFileSync(outPath, Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]));
rmSync(frameDir, { recursive: true, force: true });
console.log(`icon.ico 已生成：${frames.length} 帧 (${frames.map((f) => f.size).join('/')}) -> ${outPath}`);
