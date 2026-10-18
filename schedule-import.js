// 课表导入解析（主进程）：Excel / CSV 表格与图片 OCR 结果 → 统一的课表结构。
// 解析结果结构：
// {
//   mode: 'grid' | 'single',        // grid：识别到星期表头，逐日课表；single：单列时间+科目
//   timetableName: string,          // 建议的时间表分组名（表格取工作表名，图片取文件名）
//   group: { 'HH:MM-HH:MM': classIndex },
//   days: [{ name, en, dayOfWeek, classList }],
//   dailySchedule: number[7] | null,// 星期（0=周日）→ days 下标；single 模式为 null
//   subjects: string[],
//   summary: string
// }
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const XLSX = require('xlsx');

// 单个时间：8:00 / 08：00 / 8.00 / 8·00（容忍 OCR 与表格中的全角/点号变体）
const TIME_PATTERN = /([0-2]?\d)\s*[:：.·]\s*([0-5]\d)/g;

const WEEKDAYS = [
  { dayOfWeek: 1, name: '星期一', en: 'MON' },
  { dayOfWeek: 2, name: '星期二', en: 'TUE' },
  { dayOfWeek: 3, name: '星期三', en: 'WED' },
  { dayOfWeek: 4, name: '星期四', en: 'THU' },
  { dayOfWeek: 5, name: '星期五', en: 'FRI' },
  { dayOfWeek: 6, name: '星期六', en: 'SAT' },
  { dayOfWeek: 0, name: '星期日', en: 'SUN' },
];
const CN_NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 七: 0 };

const normalizeCell = (value) => String(value ?? '')
  .replace(/\u00a0/g, ' ')
  // 全角数字/冒号/句点归一化为半角，兼容 OCR 与中文输入法产生的变体
  .replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  .replace(/\uff1a/g, ':')
  .replace(/\uff0e/g, '.')
  .replace(/\s+/g, ' ')
  .trim();

function minutesToText(minutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

// 提取文本中的所有时间（分钟数 + 出现位置）
function collectTimes(text) {
  const found = [];
  const value = String(text || '');
  TIME_PATTERN.lastIndex = 0;
  let match = TIME_PATTERN.exec(value);
  while (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours <= 23 && minutes <= 59) {
      found.push({ minutes: hours * 60 + minutes, index: match.index, raw: match[0] });
    }
    match = TIME_PATTERN.exec(value);
  }
  return found;
}

// 去掉时间文本后的剩余内容（用于判断单元格是否只有时间、以及提取科目文本）
const stripTimes = (text) => String(text || '').replace(/([0-2]?\d)\s*[:：.·]\s*([0-5]\d)/g, ' ').replace(/\s+/g, ' ').trim();

// 单元格 → 科目文本：去掉时间、“第 N 节”标记与被移除时间残留的连接符（- ~ 至 等），
// 并丢弃只剩标点/符号的噪声（OCR 常把识别失败的字符输出为 · 等符号）
function cleanSubjectText(text) {
  const cleaned = stripTimes(text)
    .replace(/^\s*第\s*[\d一二三四五六七八九十]+\s*[节课節]\s*/, '')
    .replace(/^[\s\-~～—－至·、,，。.．:：;；]+/, '')
    .replace(/[\s\-~～—－至·、,，。.．:：;；]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\u3400-\u9fff0-9A-Za-z]/.test(cleaned) ? cleaned : '';
}

// 统一单元格表示：{ text, center }；center 为可选的像素中心（OCR 单元格用于列对齐）
function toCell(value) {
  if (value && typeof value === 'object') {
    const center = Number.isFinite(value.center)
      ? value.center
      : (Number.isFinite(value.x) && Number.isFinite(value.w) ? value.x + value.w / 2 : null);
    return { text: normalizeCell(value.text), center };
  }
  return { text: normalizeCell(value), center: null };
}

function detectWeekday(text) {
  // OCR 常把“星期一”识别为“星 期 一”：先去掉所有空白再匹配
  const value = normalizeCell(text).replace(/\s+/g, '');
  if (!value) return null;
  const cn = /(?:星期|週|周|礼拜)([一二三四五六日天七1-7])/.exec(value);
  if (cn) {
    if (/[1-7]/.test(cn[1])) {
      const num = Number(cn[1]);
      return num === 7 ? 0 : num;
    }
    if (Object.prototype.hasOwnProperty.call(CN_NUMERALS, cn[1])) return CN_NUMERALS[cn[1]];
  }
  const en = /^(MON|TUE|WED|THU|FRI|SAT|SUN)/i.exec(value);
  if (en) {
    const index = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(en[1].toUpperCase());
    if (index >= 0) return index;
  }
  if (/^[一二三四五六日天]$/.test(value)) return CN_NUMERALS[value];
  return null;
}

// 查找星期表头行：取前 12 行中星期单元格最多的一行（至少 2 列才认为是表头）
function findWeekdayHeader(rows) {
  let best = null;
  const limit = Math.min(rows.length, 12);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const columns = [];
    rows[rowIndex].forEach((cell, col) => {
      const dayOfWeek = detectWeekday(cell.text);
      if (dayOfWeek !== null) columns.push({ col, dayOfWeek });
    });
    if (columns.length >= 2 && (!best || columns.length > best.columns.length)) {
      best = { rowIndex, columns };
    }
  }
  return best;
}

// 收集所有含时间信息的行 → 时间段
function collectPeriods(rows, skipRowIndex) {
  const periods = [];
  rows.forEach((row, rowIndex) => {
    if (rowIndex === skipRowIndex) return;
    const found = [];
    row.forEach((cell, col) => {
      collectTimes(cell.text).forEach((time) => found.push({ col, ...time }));
    });
    if (!found.length) return;
    found.sort((a, b) => a.col - b.col || a.index - b.index);
    // 取最靠前的两个时间作为开始/结束；只有一个时结束时间稍后按下一行补齐
    const startMin = found[0].minutes;
    const endMin = found.length >= 2 ? found[1].minutes : null;
    const timeCols = new Set([found[0].col, ...(found.length >= 2 ? [found[1].col] : [])]);
    const textParts = [];
    row.forEach((cell, col) => {
      if (timeCols.has(col)) return;
      const text = cleanSubjectText(cell.text);
      if (!text) return;
      textParts.push(text);
    });
    periods.push({ rowIndex, row, startMin, endMin, text: textParts.join(' ').trim() });
  });
  periods.sort((a, b) => a.startMin - b.startMin || a.rowIndex - b.rowIndex);
  // 补全缺失的结束时间：取下一时间段的开始时间，否则 +45 分钟
  periods.forEach((period, index) => {
    if (period.endMin === null) {
      const next = periods[index + 1];
      period.endMin = next && next.startMin > period.startMin ? next.startMin : period.startMin + 45;
    }
  });
  return periods
    .filter((period) => period.endMin > period.startMin)
    .slice(0, 24);
}

// 表格行（字符串或 {text, x, w} 单元格）→ 课表结构
function parseTableRows(rawRows, timetableName) {
  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => (Array.isArray(row) ? row : []).map(toCell));
  if (!rows.some((row) => row.some((cell) => cell.text))) {
    throw new Error('表格内容为空');
  }
  const header = findWeekdayHeader(rows);
  const periods = collectPeriods(rows, header ? header.rowIndex : -1);
  if (!periods.length) {
    throw new Error('未识别到时间段：表格中需要包含形如 8:00-8:45 的时间范围');
  }

  const name = String(timetableName || '').trim() || '导入课表';
  const group = {};
  let classIndex = 0;
  periods.forEach((period) => {
    const key = `${minutesToText(period.startMin)}-${minutesToText(period.endMin)}`;
    if (Object.prototype.hasOwnProperty.call(group, key)) return;
    group[key] = classIndex;
    classIndex += 1;
  });

  const subjects = [];
  const collectSubject = (text) => {
    if (text && !subjects.includes(text)) subjects.push(text);
  };

  if (header) {
    // 多日模式：星期表头 → 每天一份课表
    const headerCells = rows[header.rowIndex];
    const headerColumns = header.columns.map((column) => ({
      col: column.col,
      dayOfWeek: column.dayOfWeek,
      center: headerCells[column.col] && Number.isFinite(headerCells[column.col].center)
        ? headerCells[column.col].center
        : null,
    }));
    // OCR 表格的列切分不稳定：所有表头与数据单元格都有像素坐标时，
    // 按“单元格中心就近匹配表头中心”分配列，避免逐行切列造成的错位
    const useGeometry = headerColumns.every((column) => column.center !== null);
    let tolerance = 0;
    if (useGeometry) {
      const centers = headerColumns.map((column) => column.center).sort((a, b) => a - b);
      const spacings = [];
      for (let i = 1; i < centers.length; i += 1) spacings.push(centers[i] - centers[i - 1]);
      const sortedSpacings = spacings.sort((a, b) => a - b);
      const medianSpacing = sortedSpacings.length ? sortedSpacings[Math.floor(sortedSpacings.length / 2)] : 120;
      tolerance = Math.max(60, medianSpacing * 0.45);
    }
    const classLists = headerColumns.map(() => []);
    periods.forEach((period) => {
      const perDay = new Array(headerColumns.length).fill('');
      if (useGeometry) {
        const usable = [];
        period.row.forEach((cell) => {
          const text = cleanSubjectText(cell.text);
          if (!text || !Number.isFinite(cell.center)) return;
          usable.push({ text, center: cell.center });
        });
        const pairs = [];
        usable.forEach((cell, cellIndex) => {
          headerColumns.forEach((column, dayIndex) => {
            pairs.push({ cellIndex, dayIndex, distance: Math.abs(cell.center - column.center) });
          });
        });
        pairs.sort((a, b) => a.distance - b.distance);
        const usedCells = new Set();
        pairs.forEach((pair) => {
          if (usedCells.has(pair.cellIndex) || perDay[pair.dayIndex] || pair.distance > tolerance) return;
          usedCells.add(pair.cellIndex);
          perDay[pair.dayIndex] = usable[pair.cellIndex].text;
        });
      } else {
        headerColumns.forEach((column, dayIndex) => {
          const cell = period.row[column.col];
          perDay[dayIndex] = cleanSubjectText(cell ? cell.text : '');
        });
      }
      perDay.forEach((text, dayIndex) => classLists[dayIndex].push(text));
    });
    const days = [];
    headerColumns.forEach((column, dayIndex) => {
      const classList = classLists[dayIndex];
      while (classList.length > 1 && classList[classList.length - 1] === '') classList.pop();
      classList.forEach(collectSubject);
      if (!classList.some((item) => item !== '')) return;
      const weekday = WEEKDAYS.find((item) => item.dayOfWeek === column.dayOfWeek)
        || { name: `星期${column.dayOfWeek}`, en: '' };
      days.push({
        dayOfWeek: column.dayOfWeek,
        name: weekday.name,
        en: weekday.en,
        classList: classList.length ? classList : [''],
      });
    });
    if (!days.length) {
      throw new Error('识别到星期表头，但各天均没有课程内容');
    }
    // 星期（0=周日）→ days 下标；表中没有的星期默认使用第一个导入日
    const dailySchedule = [0, 0, 0, 0, 0, 0, 0];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const index = days.findIndex((day) => day.dayOfWeek === dayOfWeek);
      dailySchedule[dayOfWeek] = index >= 0 ? index : 0;
    }
    return {
      mode: 'grid',
      timetableName: name,
      group,
      days,
      dailySchedule,
      subjects,
      summary: `识别到 ${Object.keys(group).length} 个时间段、${days.length} 天课程`,
    };
  }

  // 单列模式：时间 + 科目两列（或仅时间）
  const classList = periods.map((period) => period.text);
  classList.forEach(collectSubject);
  return {
    mode: 'single',
    timetableName: name,
    group,
    days: [{
      dayOfWeek: null,
      name,
      en: 'IMPORT',
      classList: classList.length ? classList : [''],
    }],
    dailySchedule: null,
    subjects,
    summary: `识别到 ${Object.keys(group).length} 个时间段（未识别到星期表头，已作为单个课表导入）`,
  };
}

// CSV / Excel 文件 → 课表结构（逐个工作表尝试，取第一个能解析出时间段的）
function parseTableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let workbook;
  if (ext === '.csv') {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    workbook = XLSX.read(text, { type: 'string', raw: false });
  } else {
    workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  }
  const baseName = path.basename(filePath, ext);
  let lastError = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    try {
      return parseTableRows(rows, sheetName || baseName);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('表格中没有可解析的内容');
}

// ===== 图片 OCR =====
function runOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'scripts', 'ocr-image.ps1');
    if (!fs.existsSync(script)) {
      reject(new Error('缺少 OCR 脚本：scripts/ocr-image.ps1'));
      return;
    }
    execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-ImagePath', imagePath,
    ], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 90000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || '').trim();
        if (/OCR_ENGINE_UNAVAILABLE/.test(detail)) {
          reject(new Error('系统 OCR 引擎不可用：请在“设置 → 时间和语言 → 语言”中为中文或英文安装基本语言包（含 OCR 组件）'));
        } else {
          reject(new Error(`OCR 识别失败：${detail.split('\n').filter(Boolean).slice(-2).join(' ') || '未知错误'}`));
        }
        return;
      }
      const text = String(stdout || '').replace(/^\uFEFF/, '').trim();
      if (!text) {
        resolve([]);
        return;
      }
      try {
        const data = JSON.parse(text);
        resolve(Array.isArray(data) ? data : [data]);
      } catch (parseError) {
        reject(new Error('OCR 结果解析失败'));
      }
    });
  });
}

// OCR 词 → 表格行：先按 y 中心聚类成行，再按 x 间隙切分成单元格（保留像素坐标供列对齐）
function ocrLinesToRows(lines) {
  const words = [];
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    (Array.isArray(line && line.words) ? line.words : []).forEach((word) => {
      const text = String(word.text || '').trim();
      if (!text) return;
      words.push({
        text,
        x: Number(word.x) || 0,
        y: Number(word.y) || 0,
        w: Number(word.w) || 0,
        h: Number(word.h) || 0,
      });
    });
  });
  if (!words.length) return [];
  const heights = words.map((word) => word.h).filter((height) => height > 0).sort((a, b) => a - b);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
  const sorted = [...words].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  let current = null;
  sorted.forEach((word) => {
    const center = word.y + word.h / 2;
    if (current && Math.abs(center - current.center) <= Math.max(6, medianH * 0.6)) {
      current.center = (current.center * current.words.length + center) / (current.words.length + 1);
      current.words.push(word);
    } else {
      current = { center, words: [word] };
      rows.push(current);
    }
  });
  const gapThreshold = Math.max(16, medianH * 1.4);
  const isCjk = (char) => /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(char);
  return rows.map((row) => {
    const sortedWords = [...row.words].sort((a, b) => a.x - b.x);
    const cells = [];
    let cell = null;
    let prevRight = null;
    sortedWords.forEach((word) => {
      if (prevRight !== null && word.x - prevRight > gapThreshold) {
        cells.push(cell);
        cell = null;
      }
      if (!cell) {
        cell = { text: word.text, x: word.x, w: word.w, center: 0 };
      } else {
        if (!isCjk(cell.text.slice(-1)) && !isCjk(word.text.slice(0, 1))) cell.text += ' ';
        cell.text += word.text;
        cell.w = (word.x + word.w) - cell.x;
      }
      cell.center = cell.x + cell.w / 2;
      prevRight = word.x + word.w;
    });
    if (cell) cells.push(cell);
    return cells;
  });
}

// 图片文件 → 课表结构
async function parseImageFile(imagePath) {
  const lines = await runOcr(imagePath);
  if (!lines.length) {
    throw new Error('未在图片中识别到文字，请更换更清晰的图片');
  }
  const rows = ocrLinesToRows(lines);
  const baseName = path.basename(imagePath, path.extname(imagePath));
  return parseTableRows(rows, baseName);
}

module.exports = {
  parseTableFile,
  parseImageFile,
  parseTableRows,
  ocrLinesToRows,
  minutesToText,
};