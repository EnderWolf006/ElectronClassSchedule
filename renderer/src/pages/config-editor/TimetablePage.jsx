import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@fluentui/react-components';
import { Svg, ICONS } from '../../common/icons.jsx';
import { createCardId, minutesToTimeText, sortCardsByTime, timeToMinutes } from './config-utils.js';

// 计算每张“上课”卡片保存后的节次徽标
function computeBadges(cards) {
  const badges = new Map();
  const classCards = cards
    .map((card, domIndex) => ({ id: card.id, domIndex, minutes: timeToMinutes(card.start) }))
    .filter((item, index) => cards[index].type === 'class')
    .sort((a, b) => {
      const av = a.minutes >= 0 ? a.minutes : Number.MAX_SAFE_INTEGER;
      const bv = b.minutes >= 0 ? b.minutes : Number.MAX_SAFE_INTEGER;
      return av - bv || a.domIndex - b.domIndex;
    });
  classCards.forEach((item, index) => {
    badges.set(item.id, item.minutes >= 0 ? `第 ${index + 1} 节` : '开始时间未填');
  });
  return badges;
}

function parseDurationMinutes(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function TimetableCard({
  card,
  index,
  badge,
  invalid,
  onChange,
  onRemove,
}) {
  return (
    <div
      className={`timetable-card${card.type === 'divider' ? ' divider-card' : ''}${invalid ? ' invalid' : ''}`}
      data-card-index={index}
    >
      <Select
        className="timetable-type-select"
        title="时间段类型"
        value={card.type}
        onChange={(event) => {
          const type = event.target.value;
          const patch = {
            type,
            name: type === 'break' && !String(card.name || '').trim() ? '课间' : card.name,
          };
          // 从分割线切回上课/课间且没有结束时间时，补一个默认结束时间
          if (type !== 'divider' && !card.end) {
            const startMinutes = timeToMinutes(card.start);
            if (startMinutes >= 0) {
              patch.end = minutesToTimeText(Math.min(
                startMinutes + (type === 'class' ? 40 : 10),
                23 * 60 + 59,
              ));
            }
          }
          onChange(patch);
        }}
      >
        <option value="class">上课</option>
        <option value="break">下课</option>
        <option value="divider">分割线</option>
      </Select>
      <Input
        className="timetable-time"
        type="time"
        step="60"
        title={card.type === 'divider' ? '分割线时间' : '开始时间'}
        value={card.start}
        onChange={(event) => onChange({ start: event.target.value })}
      />
      {card.type !== 'divider' && (
        <>
          <span className="range-sep">–</span>
          <Input
            className="timetable-time"
            type="time"
            step="60"
            title="结束时间"
            value={card.end}
            onChange={(event) => onChange({ end: event.target.value })}
          />
        </>
      )}
      {card.type === 'break' && (
        <Input
          className="break-name"
          placeholder="课间名称（如：大课间）"
          value={card.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      )}
      {card.type === 'class' && (
        <span className="class-badge" title={badge || ''}>{badge || ''}</span>
      )}
      {card.type === 'divider' && (
        <span className="divider-mark" title="分割线"><i /></span>
      )}
      <Button
        className="win-icon danger-outline"
        title="删除该时间段"
        aria-label="删除该时间段"
        icon={<Svg size={15} viewBox="0 0 16 16" html={ICONS.trash} strokeWidth={1.3} />}
        onClick={onRemove}
      />
    </div>
  );
}

// 图形化时间线：与卡片列表编辑同一份 cards 草稿，任何修改实时双向同步，
// 但仍需点击工具栏“保存到 scheduleConfig.js”才会写入配置文件。
// 支持：方块上下边缘拖拽改时间（5 分钟吸附）、点击方块内联编辑、纵向放缩。
const PX_PER_MINUTE_DEFAULT = 1.6;
const PX_PER_MINUTE_MIN = 0.4;
const PX_PER_MINUTE_MAX = 8;
const SNAP_MINUTES = 5;
const MIN_SLOT_MINUTES = 5;
const DAY_MAX_MINUTES = 23 * 60 + 59;

function clampZoom(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PX_PER_MINUTE_DEFAULT;
  return Math.min(PX_PER_MINUTE_MAX, Math.max(PX_PER_MINUTE_MIN, parsed));
}

function snapMinutes(value) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

// 依据当前放缩比例选择合适的刻度间隔，保证刻度间距不小于约 42px
function tickStepFor(ppm) {
  const steps = [10, 15, 30, 60, 120];
  return steps.find((step) => step * ppm >= 42) || 120;
}

function computeRange(items, dividers) {
  const validItems = items.filter((item) => item.valid);
  const validPoints = dividers.filter((item) => item.valid).map((item) => item.minutes);
  if (!validItems.length && !validPoints.length) return { rangeStart: 8 * 60, rangeEnd: 18 * 60 };
  const minCandidates = [...validItems.map((item) => item.start), ...validPoints];
  // 分割线是单点：最大侧多取 1 分钟，保证线条不会恰好贴在画布底沿
  const maxCandidates = [...validItems.map((item) => item.end), ...validPoints.map((point) => point + 1)];
  const rangeStart = Math.floor(Math.min(...minCandidates) / 60) * 60;
  let rangeEnd = Math.ceil(Math.max(...maxCandidates) / 60) * 60;
  if (rangeEnd <= rangeStart) rangeEnd = rangeStart + 60;
  return { rangeStart, rangeEnd };
}

function TimelineView({ cards, groupName, onAddClass, onAddBreak, onAddDivider, onChangeCard, onPatchCards, onRemoveCard }) {
  const scrollRef = useRef(null);
  const panelRef = useRef(null);
  const popoverRef = useRef(null);
  const blockRefs = useRef(new Map());
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const hoverRef = useRef(false);

  // 纵向放缩（像素/分钟），编辑器级偏好持久化
  const [ppm, setPpmState] = useState(() => {
    const stored = parseFloat(localStorage.getItem('timetableTimelineZoom'));
    return Number.isFinite(stored) ? clampZoom(stored) : PX_PER_MINUTE_DEFAULT;
  });
  const ppmRef = useRef(ppm);
  ppmRef.current = ppm;
  const setPpm = (value) => {
    const next = clampZoom(value);
    ppmRef.current = next;
    setPpmState(next);
    localStorage.setItem('timetableTimelineZoom', String(next));
  };
  // 放缩锚点：{ time, viewportY } —— 光标/视口中心对应的时刻放缩前后保持不动
  const anchorRef = useRef(null);

  // 边缘拖拽状态：{ id, edge: 'start'|'end'|'move', value, partner }（value 为吸附后的分钟数；
  // move 模式下 value 表示新的开始时间，时长不变；partner 为相邻边界联动时跟随移动的时间段）
  const [drag, setDrag] = useState(null);
  const dragBaseRef = useRef(null);
  const dragRafRef = useRef(0);
  const dragClientYRef = useRef(0);
  const suppressClickRef = useRef(false);
  // 整块平移：pointerdown 后先记录起点，位移超过阈值才判定为拖拽，
  // 否则按点击处理（打开内联编辑浮层）
  const movePendingRef = useRef(null);

  // 点击方块后的内联编辑器
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [editorPos, setEditorPos] = useState(null);

  // items 合并拖拽预览（拖到当前时间范围外时画布也能实时扩展）。
  // 分割线是单点时间，单独派生为 dividerItems，不参与方块的区间校验。
  const items = cards.filter((card) => card.type !== 'divider').map((card, index) => {
    let start = timeToMinutes(card.start);
    let end = timeToMinutes(card.end);
    if (drag && drag.id === card.id) {
      if (drag.edge === 'start') {
        start = drag.value;
      } else if (drag.edge === 'end') {
        end = drag.value;
      } else {
        // 整块平移：时长保持不变，value 为吸附后的新开始分钟数
        const duration = end - start;
        start = drag.value;
        end = drag.value + duration;
      }
    }
    if (drag && drag.partner && drag.partner.id === card.id) {
      // 相邻边界联动：伙伴时间段被拖动的边界跟随同一边界时间
      if (drag.partner.edge === 'start') start = drag.value;
      else end = drag.value;
    }
    return { card, index, start, end, valid: start >= 0 && end >= 0 && end > start };
  });
  const dividerItems = cards
    .filter((card) => card.type === 'divider')
    .map((card) => {
      let minutes = timeToMinutes(card.start);
      if (drag && drag.id === card.id && drag.edge === 'line') minutes = drag.value;
      return { card, minutes, valid: minutes >= 0 };
    });
  const validItems = items.filter((item) => item.valid);
  const validDividers = dividerItems.filter((item) => item.valid);
  const invalidCount = items.length - validItems.length;
  const { rangeStart, rangeEnd } = computeRange(items, dividerItems);
  const canvasHeight = (rangeEnd - rangeStart) * ppm;
  const tickStep = tickStepFor(ppm);

  // 放缩后按锚点恢复滚动位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    anchorRef.current = null;
    el.scrollTop = Math.max(0, (anchor.time - rangeStart) * ppm - anchor.viewportY);
  }, [ppm, rangeStart]);

  const zoomBy = (factor, viewportY) => {
    const el = scrollRef.current;
    if (!el) return;
    const y = viewportY ?? el.clientHeight / 2;
    const time = rangeStart + (el.scrollTop + y) / ppmRef.current;
    anchorRef.current = { time, viewportY: y };
    setPpm(ppmRef.current * factor);
  };

  // Ctrl + 滚轮（鼠标）/ 双指捏合（触控板在 Chromium 中表现为 ctrlKey 滚轮）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const norm = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(-norm * 0.0015);
      const rect = el.getBoundingClientRect();
      zoomBy(factor, event.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart]);

  // 键盘放缩（鼠标悬停在时间线上时）：+/- 放缩，0 复位
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!hoverRef.current) return;
      const tag = (event.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(1.15);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / 1.15);
      } else if (event.key === '0') {
        event.preventDefault();
        zoomBy(PX_PER_MINUTE_DEFAULT / ppmRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart]);

  // ===== 边缘拖拽改时间 / 整块平移（5 分钟吸附） =====
  const applyDragMove = () => {
    dragRafRef.current = 0;
    const base = dragBaseRef.current;
    if (!base) return;
    const raw = base.baseMinutes + (dragClientYRef.current - base.startY) / ppmRef.current;
    let value = snapMinutes(raw);
    if (base.edge === 'line') {
      // 分割线：单点时间，钳制在 00:00 ~ 23:59
      value = Math.min(Math.max(value, 0), DAY_MAX_MINUTES);
      base.latestValue = value;
      setDrag((prev) => (prev ? { ...prev, value } : prev));
      return;
    }
    const card = cardsRef.current.find((item) => item.id === base.id);
    if (!card) return;
    if (base.edge === 'move') {
      // 整块平移：钳制在 00:00 ~ 23:59 之内，时长保持不变
      value = Math.min(Math.max(value, 0), DAY_MAX_MINUTES - base.baseDuration);
    } else {
      const other = base.edge === 'start' ? timeToMinutes(card.end) : timeToMinutes(card.start);
      if (base.edge === 'start') {
        // 与上一时间段相邻时，其结束时间跟随移动，不能早于其开始时间 + 最小时长
        const lower = base.partner ? base.partner.limit + MIN_SLOT_MINUTES : 0;
        value = Math.min(Math.max(value, lower), other - MIN_SLOT_MINUTES);
      } else {
        // 与下一时间段相邻时，其开始时间跟随移动，不能晚于其结束时间 - 最小时长
        const upper = base.partner ? base.partner.limit - MIN_SLOT_MINUTES : DAY_MAX_MINUTES;
        value = Math.max(Math.min(value, upper), other + MIN_SLOT_MINUTES);
      }
    }
    base.latestValue = value;
    setDrag((prev) => (prev ? { ...prev, value } : prev));
  };

  // 相邻时间段（一个的结束时间恰好等于另一个的开始时间）共用同一条边界：
  // 拖动该边界时两侧一起移动；拖动时间段本身（整体平移）不受影响。
  const findAdjacentPartner = (item, edge) => {
    const boundary = edge === 'end' ? item.end : item.start;
    return items.find((other) => (
      other.card.id !== item.card.id
      && other.valid
      && (edge === 'end' ? other.start === boundary : other.end === boundary)
    )) || null;
  };

  const startResize = (event, item, edge) => {
    event.preventDefault();
    event.stopPropagation();
    const baseMinutes = edge === 'start' ? item.start : item.end;
    const adjacent = findAdjacentPartner(item, edge);
    const partner = adjacent
      ? {
        id: adjacent.card.id,
        edge: edge === 'end' ? 'start' : 'end',
        // 联动时的对侧极限：伙伴时间段的另一端点（保证双方都留在最小时长内）
        limit: edge === 'end' ? adjacent.end : adjacent.start,
      }
      : null;
    dragBaseRef.current = {
      id: item.card.id,
      edge,
      baseMinutes,
      startY: event.clientY,
      latestValue: baseMinutes,
      partner,
    };
    dragClientYRef.current = event.clientY;
    setDrag({
      id: item.card.id,
      edge,
      value: baseMinutes,
      partner: partner ? { id: partner.id, edge: partner.edge } : null,
    });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
  };

  const onResizeMove = (event) => {
    if (!dragBaseRef.current) return;
    event.preventDefault();
    dragClientYRef.current = event.clientY;
    if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(applyDragMove);
  };

  // 按下方块主体（边缘手柄已 stopPropagation，不会进入这里）
  const startBlockMove = (event, item) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    movePendingRef.current = {
      id: item.card.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseStart: item.start,
      duration: item.end - item.start,
      active: false,
    };
  };

  const onBlockMove = (event) => {
    const pending = movePendingRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!pending.active) {
      const MOVE_THRESHOLD = 5;
      if (Math.abs(event.clientY - pending.startY) < MOVE_THRESHOLD
        && Math.abs(event.clientX - pending.startX) < MOVE_THRESHOLD) {
        return;
      }
      pending.active = true;
      dragBaseRef.current = {
        id: pending.id,
        edge: 'move',
        baseMinutes: pending.baseStart,
        baseDuration: pending.duration,
        startY: pending.startY,
        latestValue: pending.baseStart,
      };
      dragClientYRef.current = pending.startY;
      setDrag({ id: pending.id, edge: 'move', value: pending.baseStart });
      const block = blockRefs.current.get(pending.id);
      try { block?.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
    }
    event.preventDefault();
    dragClientYRef.current = event.clientY;
    if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(applyDragMove);
  };

  const finishBlockMove = (event) => {
    const pending = movePendingRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    movePendingRef.current = null;
    if (pending.active) finishResize();
  };

  // ===== 分割线：上下拖动改时间 / 点击编辑（与方块一致的 5px 阈值） =====
  const linePendingRef = useRef(null);

  const startLineGesture = (event, item) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    linePendingRef.current = {
      id: item.card.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseMinutes: item.minutes,
      active: false,
    };
  };

  const onLineMove = (event) => {
    const pending = linePendingRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!pending.active) {
      const MOVE_THRESHOLD = 5;
      if (Math.abs(event.clientY - pending.startY) < MOVE_THRESHOLD
        && Math.abs(event.clientX - pending.startX) < MOVE_THRESHOLD) {
        return;
      }
      pending.active = true;
      dragBaseRef.current = {
        id: pending.id,
        edge: 'line',
        baseMinutes: pending.baseMinutes,
        startY: pending.startY,
        latestValue: pending.baseMinutes,
      };
      dragClientYRef.current = pending.startY;
      setDrag({ id: pending.id, edge: 'line', value: pending.baseMinutes });
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
    }
    event.preventDefault();
    dragClientYRef.current = event.clientY;
    if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(applyDragMove);
  };

  const finishLineGesture = (event) => {
    const pending = linePendingRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    linePendingRef.current = null;
    if (pending.active) finishResize();
  };

  const finishResize = () => {
    const base = dragBaseRef.current;
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    dragBaseRef.current = null;
    setDrag(null);
    if (base && Number.isFinite(base.latestValue) && base.latestValue !== base.baseMinutes) {
      if (base.edge === 'line') {
        onChangeCard(base.id, { start: minutesToTimeText(base.latestValue) });
      } else if (base.edge === 'move') {
        onChangeCard(base.id, {
          start: minutesToTimeText(base.latestValue),
          end: minutesToTimeText(base.latestValue + base.baseDuration),
        });
      } else if (base.partner) {
        // 相邻边界联动：一次性提交两个时间段的修改，避免先后更新互相覆盖
        const ownPatch = base.edge === 'start'
          ? { start: minutesToTimeText(base.latestValue) }
          : { end: minutesToTimeText(base.latestValue) };
        const partnerPatch = base.partner.edge === 'start'
          ? { start: minutesToTimeText(base.latestValue) }
          : { end: minutesToTimeText(base.latestValue) };
        onPatchCards({ [base.id]: ownPatch, [base.partner.id]: partnerPatch });
      } else {
        onChangeCard(base.id, base.edge === 'start'
          ? { start: minutesToTimeText(base.latestValue) }
          : { end: minutesToTimeText(base.latestValue) });
      }
    }
    // 拖拽松手合成的 click 不要再打开编辑浮层
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  // ===== 键盘微调（点击选中方块/分割线后） =====
  // ↑/↓：整体平移 5 分钟（时长不变）；Shift+↑/↓：仅移动上边界（开始）；
  // Ctrl+↑/↓：仅移动下边界（结束）。边界移动与拖拽一致，相邻共享边界联动伙伴；分割线仅支持 ↑/↓。
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!selectedId) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const tag = (event.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const card = cards.find((item) => item.id === selectedId);
      if (!card) return;
      const delta = event.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES;
      if (card.type === 'divider') {
        // 分割线是单点时间：Ctrl / Shift / Alt 组合键均无效
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        const current = timeToMinutes(card.start);
        if (current < 0) return;
        const next = Math.min(Math.max(current + delta, 0), DAY_MAX_MINUTES);
        if (next === current) return;
        event.preventDefault();
        onChangeCard(card.id, { start: minutesToTimeText(next) });
        setDraft((prev) => (prev ? { ...prev, start: minutesToTimeText(next) } : prev));
        return;
      }
      const item = items.find((entry) => entry.card.id === selectedId);
      if (!item || !item.valid) return;
      const shift = event.shiftKey;
      const ctrl = event.ctrlKey || event.metaKey;
      if (shift && ctrl) return;
      event.preventDefault();
      if (shift) {
        // 上边界：与上一时间段共享边界时，其结束时间跟随移动；
        // 两个方向均可移动，仅受伙伴开始时间 + 最小时长限制（与拖拽一致）
        const adjacent = findAdjacentPartner(item, 'start');
        const lower = adjacent ? timeToMinutes(adjacent.card.start) + MIN_SLOT_MINUTES : 0;
        const value = Math.min(Math.max(snapMinutes(item.start + delta), lower), item.end - MIN_SLOT_MINUTES);
        if (value === item.start) return;
        const patch = { start: minutesToTimeText(value) };
        if (adjacent) {
          onPatchCards({ [item.card.id]: patch, [adjacent.card.id]: { end: minutesToTimeText(value) } });
        } else {
          onChangeCard(item.card.id, patch);
        }
        setDraft((prev) => (prev ? { ...prev, start: minutesToTimeText(value) } : prev));
        return;
      }
      if (ctrl) {
        // 下边界：与下一时间段共享边界时，其开始时间跟随移动；
        // 两个方向均可移动，仅受伙伴结束时间 - 最小时长限制（与拖拽一致）
        const adjacent = findAdjacentPartner(item, 'end');
        const upper = adjacent ? timeToMinutes(adjacent.card.end) - MIN_SLOT_MINUTES : DAY_MAX_MINUTES;
        const value = Math.max(Math.min(snapMinutes(item.end + delta), upper), item.start + MIN_SLOT_MINUTES);
        if (value === item.end) return;
        const patch = { end: minutesToTimeText(value) };
        if (adjacent) {
          onPatchCards({ [item.card.id]: patch, [adjacent.card.id]: { start: minutesToTimeText(value) } });
        } else {
          onChangeCard(item.card.id, patch);
        }
        setDraft((prev) => (prev ? { ...prev, end: minutesToTimeText(value) } : prev));
        return;
      }
      // 整体平移：起止时间同向移动，时长不变
      const duration = item.end - item.start;
      const value = Math.min(Math.max(snapMinutes(item.start + delta), 0), DAY_MAX_MINUTES - duration);
      if (value === item.start) return;
      onChangeCard(item.card.id, {
        start: minutesToTimeText(value),
        end: minutesToTimeText(value + duration),
      });
      setDraft((prev) => (prev
        ? { ...prev, start: minutesToTimeText(value), end: minutesToTimeText(value + duration) }
        : prev));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draft, cards]);

  // ===== 点击内联编辑 =====
  const selectedCard = selectedId ? cards.find((card) => card.id === selectedId) : null;

  const openEditor = (card) => {
    if (suppressClickRef.current) return;
    setSelectedId(card.id);
    setDraft({ start: card.start, end: card.end, type: card.type, name: card.name || '' });
    setDraftError('');
  };

  const closeEditor = () => {
    setSelectedId(null);
    setDraft(null);
    setEditorPos(null);
    setDraftError('');
  };

  // 浮层跟随方块位置（滚动、放缩、数据变化时重新定位并钳制在视口内）
  useLayoutEffect(() => {
    if (!selectedId || !draft) {
      setEditorPos(null);
      return;
    }
    const position = () => {
      const block = blockRefs.current.get(selectedId);
      const popover = popoverRef.current;
      const container = scrollRef.current;
      if (!block || !popover || !container) return;
      const rect = block.getBoundingClientRect();
      const pw = popover.offsetWidth || 236;
      const ph = popover.offsetHeight || 210;
      const left = Math.min(
        Math.max(rect.right + 10, 8),
        window.innerWidth - pw - 8
      );
      const top = Math.min(
        Math.max(rect.top, 8),
        window.innerHeight - ph - 8
      );
      setEditorPos({ left, top });
    };
    position();
    const el = scrollRef.current;
    el?.addEventListener('scroll', position);
    window.addEventListener('resize', position);
    return () => {
      el?.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
    };
  }, [selectedId, draft, draftError, ppm, cards]);

  const saveDraft = () => {
    if (!selectedId || !draft) return;
    const start = timeToMinutes(draft.start);
    if (draft.type === 'divider') {
      if (start < 0) {
        setDraftError('请填写有效的分割线时间。');
        return;
      }
      onChangeCard(selectedId, { start: minutesToTimeText(start), type: 'divider' });
      closeEditor();
      return;
    }
    const end = timeToMinutes(draft.end);
    if (start < 0 || end < 0 || end <= start) {
      setDraftError('请填写有效时间，且结束时间需晚于开始时间。');
      return;
    }
    const patch = {
      start: minutesToTimeText(start),
      end: minutesToTimeText(end),
      type: draft.type,
    };
    if (draft.type === 'break') patch.name = String(draft.name || '').trim() || '课间';
    onChangeCard(selectedId, patch);
    closeEditor();
  };

  const ticks = [];
  for (let m = rangeStart; m <= rangeEnd; m += tickStep) {
    const isHour = m % 60 === 0;
    ticks.push(
      <div
        key={m}
        className={`timeline-tick${isHour ? ' hour' : ''}`}
        style={{ top: `${(m - rangeStart) * ppm}px` }}
      >
        {isHour && <span className="timeline-tick-label">{minutesToTimeText(m)}</span>}
      </div>
    );
  }

  const zoomPct = Math.round((ppm / PX_PER_MINUTE_DEFAULT) * 100);

  return (
    <div
      className="timeline-panel"
      ref={panelRef}
      onPointerEnter={() => { hoverRef.current = true; }}
      onPointerLeave={() => { hoverRef.current = false; }}
    >
      <div className="timeline-toolbar">
        <span className="timeline-title">时间线</span>
        {groupName && <span className="timeline-group">{groupName}</span>}
        <Button size="small" appearance="primary" onClick={onAddClass}>上课</Button>
        <Button size="small" onClick={onAddBreak}>课间</Button>
        <Button size="small" onClick={onAddDivider}>分割线</Button>
        <span className="timeline-zoom">
          <button type="button" className="timeline-zoom-btn" title="缩小（-）" onClick={() => zoomBy(1 / 1.15)}>−</button>
          <button
            type="button"
            className="timeline-zoom-value"
            title="恢复默认缩放（0）"
            onClick={() => zoomBy(PX_PER_MINUTE_DEFAULT / ppmRef.current)}
          >
            {zoomPct}%
          </button>
          <button type="button" className="timeline-zoom-btn" title="放大（+）" onClick={() => zoomBy(1.15)}>+</button>
        </span>
        {invalidCount > 0 && (
          <span className="timeline-hint">{invalidCount} 个时间段时间无效，未在时间线中显示</span>
        )}
      </div>
      <p className="timeline-tip">拖动方块中间可整体移动，拖动上/下边缘修改时间；两个时间段相邻时，拖动共用边界会一起移动；灰色横线为分割线，上下拖动调整时间、点击编辑；点击方块后按 ↑/↓ 整体平移 5 分钟、Shift+↑/↓ 调整开始时间、Ctrl+↑/↓ 调整结束时间（分割线仅支持 ↑/↓）；Ctrl + 滚轮（或 +/- 键）纵向放缩。</p>
      <div className={`timeline-scroll${drag ? ' dragging' : ''}`} ref={scrollRef}>
        {validItems.length === 0 && validDividers.length === 0 ? (
          <div className="empty">暂无可显示的时间段，点击上方“上课 / 课间 / 分割线”添加。</div>
        ) : (
          <div className="timeline-canvas" style={{ height: `${canvasHeight}px` }}>
            {ticks}
            {validItems.map((item) => {
              const top = (item.start - rangeStart) * ppm;
              const height = (item.end - item.start) * ppm;
              const duration = item.end - item.start;
              const compact = height < 40;
              const isDragging = drag?.id === item.card.id;
              return (
                <div
                  key={item.card.id}
                  ref={(el) => {
                    if (el) blockRefs.current.set(item.card.id, el);
                    else blockRefs.current.delete(item.card.id);
                  }}
                  className={`timeline-block ${item.card.type}${compact ? ' compact' : ''}${isDragging ? ' dragging' : ''}${selectedId === item.card.id ? ' selected' : ''}`}
                  style={{ top: `${top}px`, height: `${height}px` }}
                  title="点击编辑该时间段，拖动可整体移动"
                  onClick={() => openEditor(item.card)}
                  onPointerDown={(event) => startBlockMove(event, item)}
                  onPointerMove={onBlockMove}
                  onPointerUp={finishBlockMove}
                  onPointerCancel={finishBlockMove}
                >
                  <span
                    className="timeline-resize-handle top"
                    onPointerDown={(event) => startResize(event, item, 'start')}
                    onPointerMove={onResizeMove}
                    onPointerUp={finishResize}
                    onPointerCancel={finishResize}
                  />
                  <div className="timeline-block-inner">
                    <div className="timeline-block-time">{item.card.start} – {item.card.end}</div>
                    {!compact && (
                      <div className="timeline-block-meta">
                        {item.card.type === 'class'
                          ? `上课 · ${duration} 分钟`
                          : `${item.card.name || '课间'} · ${duration} 分钟`}
                      </div>
                    )}
                  </div>
                  <span
                    className="timeline-resize-handle bottom"
                    onPointerDown={(event) => startResize(event, item, 'end')}
                    onPointerMove={onResizeMove}
                    onPointerUp={finishResize}
                    onPointerCancel={finishResize}
                  />
                </div>
              );
            })}
            {/* 分割线层：置于方块之上，重叠位置的指针事件优先命中分割线 */}
            {validDividers.map((item) => {
              const top = (item.minutes - rangeStart) * ppm;
              const isDragging = drag?.id === item.card.id && drag.edge === 'line';
              const label = isDragging ? minutesToTimeText(drag.value) : item.card.start;
              return (
                <div
                  key={item.card.id}
                  ref={(el) => {
                    if (el) blockRefs.current.set(item.card.id, el);
                    else blockRefs.current.delete(item.card.id);
                  }}
                  className={`timeline-divider${isDragging ? ' dragging' : ''}${selectedId === item.card.id ? ' selected' : ''}`}
                  style={{ top: `${top}px` }}
                  title="点击编辑分割线时间，上下拖动调整位置"
                  onClick={() => openEditor(item.card)}
                  onPointerDown={(event) => startLineGesture(event, item)}
                  onPointerMove={onLineMove}
                  onPointerUp={finishLineGesture}
                  onPointerCancel={finishLineGesture}
                >
                  <span className="timeline-divider-label">{label}</span>
                  <span className="timeline-divider-rule" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedCard && draft && (
        <>
          <div className="timeline-editor-backdrop" onMouseDown={closeEditor} />
          <div className="timeline-editor" ref={popoverRef} style={editorPos || { opacity: 0 }}>
            <div className="timeline-editor-title">{draft.type === 'divider' ? '编辑分割线' : '编辑时间段'}</div>
            <div className="timeline-editor-row">
              <label>{draft.type === 'divider' ? '时间' : '开始'}</label>
              <Input
                type="time"
                step="300"
                value={draft.start}
                onChange={(event) => { setDraftError(''); setDraft({ ...draft, start: event.target.value }); }}
              />
            </div>
            {draft.type !== 'divider' && (
              <div className="timeline-editor-row">
                <label>结束</label>
                <Input
                  type="time"
                  step="300"
                  value={draft.end}
                  onChange={(event) => { setDraftError(''); setDraft({ ...draft, end: event.target.value }); }}
                />
              </div>
            )}
            <div className="timeline-editor-row">
              <label>类型</label>
              <Select
                value={draft.type}
                  onChange={(event) => {
                    const type = event.target.value;
                    setDraftError('');
                    setDraft({
                      ...draft,
                      type,
                      name: type === 'break' && !String(draft.name || '').trim() ? '课间' : draft.name,
                    });
                  }}
              >
                <option value="class">上课</option>
                <option value="break">课间</option>
                <option value="divider">分割线</option>
              </Select>
            </div>
            {draft.type === 'break' && (
              <div className="timeline-editor-row">
                <label>名称</label>
                <Input
                  placeholder="课间名称（如：大课间）"
                  value={draft.name}
                  onChange={(event) => { setDraftError(''); setDraft({ ...draft, name: event.target.value }); }}
                />
              </div>
            )}
            {draftError && <div className="timeline-editor-error">{draftError}</div>}
            <div className="timeline-editor-actions">
              <Button
                className="win-icon danger-outline"
                title="删除该时间段"
                onClick={() => { onRemoveCard(selectedId); closeEditor(); }}
                icon={<Svg size={15} viewBox="0 0 16 16" html={ICONS.trash} strokeWidth={1.3} />}
              />
              <span className="timeline-editor-spacer" />
              <Button size="small" onClick={closeEditor}>取消</Button>
              <Button size="small" appearance="primary" onClick={saveDraft}>完成</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function TimetablePage({
  groupNames,
  activeName,
  onSwitch,
  cards,
  onCardsChange,
  onAddGroup,
  onRenameGroup,
  invalidIndexes,
}) {
  const layoutRef = useRef(null);
  const navRef = useRef(null);
  const cardRef = useRef(null);
  const listRef = useRef(null);
  // 时间表右侧两个独立子页：时间段列表 / 图形化时间线（偏好持久化）
  const [subView, setSubViewState] = useState(() => (
    localStorage.getItem('timetableSubView') === 'timeline' ? 'timeline' : 'list'
  ));
  const setSubView = (view) => {
    setSubViewState(view);
    localStorage.setItem('timetableSubView', view);
  };
  // 默认上课/课间时长（分钟）：编辑器级偏好，持久化到 localStorage
  const [classMinutes, setClassMinutes] = useState(() => localStorage.getItem('timetableDefaultClassMinutes') || '40');
  const [breakMinutes, setBreakMinutes] = useState(() => localStorage.getItem('timetableDefaultBreakMinutes') || '10');
  const badges = computeBadges(cards);

  // 所有修改后都保持“按开始时间自动排序”的展示顺序
  const updateCard = (id, patch) => {
    onCardsChange(sortCardsByTime(cards.map((card) => (card.id === id ? { ...card, ...patch } : card))));
  };

  // 一次提交多张卡片的修改（时间线相邻边界联动拖动）
  const patchCards = (patches) => {
    onCardsChange(sortCardsByTime(cards.map((card) => (
      patches[card.id] ? { ...card, ...patches[card.id] } : card
    ))));
  };

  const removeCard = (id) => {
    onCardsChange(cards.filter((card) => card.id !== id));
  };

  // 定位并闪烁列表中对应的卡片（时间线块点击时调用）
  const focusCard = (id) => {
    const index = cards.findIndex((card) => card.id === id);
    if (index < 0) return;
    const element = listRef.current?.querySelector(`[data-card-index="${index}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.remove('flash');
    void element.offsetWidth;
    element.classList.add('flash');
  };

  // 新增上课/课间：开始时间 = 最后一个时间有效卡片的结束时间（默认 08:00），
  // 结束时间 = 开始时间 + 左侧设置的默认时长。
  // 新增分割线：单点时间，默认取最后一张卡片的结束时间（分割线取自身时间）。
  const addSlot = (type) => {
    let startMinutes = 8 * 60;
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      const reference = cards[i].type === 'divider'
        ? timeToMinutes(cards[i].start)
        : timeToMinutes(cards[i].end);
      if (reference >= 0) { startMinutes = reference; break; }
    }
    const newCard = {
      id: createCardId(),
      type,
      start: minutesToTimeText(startMinutes),
      end: '',
      name: '',
    };
    if (type === 'divider') {
      newCard.end = '';
    } else {
      const duration = type === 'class'
        ? parseDurationMinutes(classMinutes, 40)
        : parseDurationMinutes(breakMinutes, 10);
      newCard.end = minutesToTimeText(Math.min(startMinutes + duration, 23 * 60 + 59));
      newCard.name = type === 'break' ? '课间' : '';
    }
    onCardsChange(sortCardsByTime([...cards, newCard]));
    // 在列表页新增时定位到新卡片；在时间线页新增时停留当前页即可
    if (subView === 'list') {
      setTimeout(() => focusCard(newCard.id), 60);
    }
  };

  // 时间段列表已改为按开始时间自动排序，不再提供手动拖拽排序

  // 与旧版 applyTimetableLayout 相同的宽度钳制
  useLayoutEffect(() => {
    const apply = () => {
      const layout = layoutRef.current;
      const panel = cardRef.current;
      if (!layout || !panel) return;
      if (window.matchMedia('(max-width: 980px)').matches) {
        panel.style.width = '';
        panel.style.maxWidth = '';
        return;
      }
      const navWidth = navRef.current?.offsetWidth || 180;
      const finalWidth = Math.min(Math.max(320, layout.clientWidth - navWidth - 28), 900);
      panel.style.width = `${finalWidth}px`;
      panel.style.maxWidth = `${finalWidth}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  });

  return (
    <>
      <div className="page-header">
        <h2>时间表</h2>
        <p>配置不同日程下的时间段与类型。</p>
      </div>
      <div className="ce-toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onAddGroup}>新增时间表</Button>
      </div>
      <div className="timetable-layout" ref={layoutRef}>
        <aside className="timetable-nav" ref={navRef}>
          {groupNames.length === 0 && <div className="empty">暂无时间表</div>}
          {groupNames.map((name) => (
            <button
              type="button"
              key={name}
              className={`timetable-nav-item${name === activeName ? ' active' : ''}`}
              title={name}
              onClick={() => onSwitch(name)}
            >
              {name}
            </button>
          ))}
          <div className="timetable-defaults">
            <div className="defaults-heading">默认时长</div>
            <div className="defaults-row">
              <label htmlFor="ttDefaultClass">上课</label>
              <Input
                id="ttDefaultClass"
                type="number"
                min={1}
                max={240}
                value={classMinutes}
                onChange={(event) => {
                  setClassMinutes(event.target.value);
                  localStorage.setItem('timetableDefaultClassMinutes', event.target.value);
                }}
              />
              <span className="defaults-unit">分钟</span>
            </div>
            <div className="defaults-row">
              <label htmlFor="ttDefaultBreak">课间</label>
              <Input
                id="ttDefaultBreak"
                type="number"
                min={1}
                max={240}
                value={breakMinutes}
                onChange={(event) => {
                  setBreakMinutes(event.target.value);
                  localStorage.setItem('timetableDefaultBreakMinutes', event.target.value);
                }}
              />
              <span className="defaults-unit">分钟</span>
            </div>
          </div>
        </aside>
        <div className="day-editor">
          {groupNames.length === 0 && <div className="empty">暂无时间表</div>}
          {groupNames.length > 0 && (
            <>
              <div className="tt-view-tabs" role="tablist" aria-label="时间表视图切换">
                <button
                  type="button"
                  role="tab"
                  aria-selected={subView === 'list'}
                  className={`tt-view-tab${subView === 'list' ? ' active' : ''}`}
                  onClick={() => setSubView('list')}
                >
                  时间段列表
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={subView === 'timeline'}
                  className={`tt-view-tab${subView === 'timeline' ? ' active' : ''}`}
                  onClick={() => setSubView('timeline')}
                >
                  时间线
                </button>
              </div>
              {subView === 'list' && (
                <div className="group-card" ref={cardRef} data-timetable-name={activeName}>
                  <h3>{activeName}</h3>
                  <p className="field-help timetable-help">
                    时间段按开始时间自动排序；上课时间段无需填写节次，保存时按开始时间自动从第 1 节开始编号。
                  </p>
                  <div className="timetable-card-list" ref={listRef}>
                    {cards.length === 0 && (
                      <div className="empty">暂无时间段，点击下方“新增上课 / 新增课间 / 新增分割线”添加。</div>
                    )}
                    {cards.map((card, index) => (
                      <TimetableCard
                        key={card.id}
                        card={card}
                        index={index}
                        badge={badges.get(card.id)}
                        invalid={invalidIndexes.has(index)}
                        onChange={(patch) => updateCard(card.id, patch)}
                        onRemove={() => removeCard(card.id)}
                      />
                    ))}
                  </div>
                  <div className="row-actions">
                    <Button appearance="primary" onClick={() => addSlot('class')}>新增上课</Button>
                    <Button onClick={() => addSlot('break')}>新增课间</Button>
                    <Button onClick={() => addSlot('divider')}>新增分割线</Button>
                    <Button onClick={() => onRenameGroup(activeName)}>重命名</Button>
                  </div>
                </div>
              )}
              {subView === 'timeline' && (
                <TimelineView
                  cards={cards}
                  groupName={activeName}
                  onAddClass={() => addSlot('class')}
                  onAddBreak={() => addSlot('break')}
                  onAddDivider={() => addSlot('divider')}
                  onChangeCard={updateCard}
                  onPatchCards={patchCards}
                  onRemoveCard={removeCard}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
