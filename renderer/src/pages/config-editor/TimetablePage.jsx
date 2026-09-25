import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@fluentui/react-components';
import { Svg, ICONS } from '../../common/icons.jsx';
import { createCardId, timeToMinutes } from './config-utils.js';

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
    badges.set(item.id, item.minutes >= 0 ? `保存后为第 ${index + 1} 节` : '开始时间未填');
  });
  return badges;
}

function TimetableCard({
  card,
  index,
  badge,
  invalid,
  draggableEnabled,
  onPointerDownHandle,
  onDragStart,
  onDragEnd,
  onChange,
  onRemove,
}) {
  return (
    <div
      className={`timetable-card${invalid ? ' invalid' : ''}`}
      data-card-index={index}
      draggable={draggableEnabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span
        className="drag-handle"
        title="拖动调整顺序"
        onPointerDown={onPointerDownHandle}
      >
        <Svg size={10} viewBox="0 0 10 16" html={ICONS.dragDots} strokeWidth={0} />
      </span>
      <Select
        className="timetable-type-select"
        title="时间段类型"
        value={card.type}
        onChange={(event) => {
          const type = event.target.value;
          onChange({
            type,
            name: type === 'break' && !String(card.name || '').trim() ? '课间' : card.name,
          });
        }}
      >
        <option value="class">上课</option>
        <option value="break">下课</option>
      </Select>
      <Input
        className="timetable-time"
        type="time"
        step="60"
        title="开始时间"
        value={card.start}
        onChange={(event) => onChange({ start: event.target.value })}
      />
      <span className="range-sep">–</span>
      <Input
        className="timetable-time"
        type="time"
        step="60"
        title="结束时间"
        value={card.end}
        onChange={(event) => onChange({ end: event.target.value })}
      />
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
  const [dragId, setDragId] = useState(null);
  const badges = computeBadges(cards);

  const updateCard = (id, patch) => {
    onCardsChange(cards.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  };

  const removeCard = (id) => {
    onCardsChange(cards.filter((card) => card.id !== id));
  };

  const addRow = () => {
    onCardsChange([...cards, { id: createCardId(), type: 'class', start: '08:00', end: '08:45', name: '' }]);
  };

  const moveBefore = (targetIndex) => {
    if (dragId === null) return;
    const from = cards.findIndex((card) => card.id === dragId);
    if (from < 0 || from === targetIndex) return;
    const next = [...cards];
    const [moved] = next.splice(from, 1);
    const insertAt = from < targetIndex ? targetIndex - 1 : targetIndex;
    next.splice(insertAt, 0, moved);
    onCardsChange(next);
  };

  const onListDragOver = (event) => {
    if (dragId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const targetCard = event.target.closest?.('[data-card-index]');
    if (!targetCard || !listRef.current?.contains(targetCard)) {
      // 拖到列表末尾空白处：追加到最后
      if (listRef.current?.contains(event.target)) moveBefore(cards.length);
      return;
    }
    const rect = targetCard.getBoundingClientRect();
    const targetIndex = Number(targetCard.dataset.cardIndex);
    if (event.clientY < rect.top + rect.height / 2) {
      moveBefore(targetIndex);
    } else {
      moveBefore(targetIndex + 1);
    }
  };

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
        </aside>
        <div className="day-editor">
          {groupNames.length === 0 && <div className="empty">暂无时间表</div>}
          {groupNames.length > 0 && (
            <div className="group-card" ref={cardRef} data-timetable-name={activeName}>
              <h3>{activeName}</h3>
              <p className="field-help timetable-help">
                上课时间段无需填写节次，保存时按开始时间自动从第 1 节开始编号；拖动卡片左侧手柄可调整时间段的显示顺序。
              </p>
              <div
                className="timetable-card-list"
                ref={listRef}
                onDragOver={onListDragOver}
                onDrop={(event) => { if (dragId !== null) event.preventDefault(); }}
              >
                {cards.length === 0 && (
                  <div className="empty">暂无时间段，点击下方“新增时间段”添加。</div>
                )}
                {cards.map((card, index) => (
                  <TimetableCard
                    key={card.id}
                    card={card}
                    index={index}
                    badge={badges.get(card.id)}
                    invalid={invalidIndexes.has(index)}
                    draggableEnabled={dragId === card.id}
                    onPointerDownHandle={() => setDragId(card.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      try { event.dataTransfer.setData('text/plain', ''); } catch (error) { /* 忽略 */ }
                    }}
                    onDragEnd={() => setDragId(null)}
                    onChange={(patch) => updateCard(card.id, patch)}
                    onRemove={() => removeCard(card.id)}
                  />
                ))}
              </div>
              <div className="row-actions">
                <Button onClick={addRow}>新增时间段</Button>
                <Button onClick={() => onRenameGroup(activeName)}>重命名</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
