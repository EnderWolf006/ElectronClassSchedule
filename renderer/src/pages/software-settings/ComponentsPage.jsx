import { useRef, useState } from 'react';
import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { Svg, ICONS } from '../../common/icons.jsx';

export const COMPONENT_LABELS = {
  schedule: '课表',
  week: '星期',
  date: '日期',
  countdown: '倒计日期',
  time: '时间',
  customText: '自定义文本',
};

const COMPONENT_DESCRIPTIONS = {
  schedule: '每日课程和课程倒计时',
  week: '当前星期和日期',
  date: '当前日期和星期',
  countdown: '目标日期倒计时',
  time: '当前时间',
  customText: '自定义显示文本',
};

const COMPONENT_ICONS = {
  schedule: ICONS.componentSchedule,
  week: ICONS.componentWeek,
  date: ICONS.componentDate,
  countdown: ICONS.componentCountdown,
  time: ICONS.componentTime,
  customText: ICONS.componentCustomText,
};

export function normalizeDateValue(value) {
  if (!value || value === 'hidden') return '';
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value;
}

export function createComponentId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeComponent(component, legacyIndex = 0, config, settings) {
  if (typeof component === 'string') {
    const legacyOptions = {
      week: { display: config?.week_display !== false },
      date: {},
      countdown: { target: normalizeDateValue(config?.countdown_target || '') },
      time: { source: config?.time_source === 'system' ? 'system' : 'offset' },
      customText: { text: settings?.custom_text || '' },
    };
    return { id: `${component}-${legacyIndex + 1}`, type: component, options: legacyOptions[component] || {} };
  }
  if (!component || !COMPONENT_LABELS[component.type]) return null;
  return {
    id: component.id || createComponentId(component.type),
    type: component.type,
    options: { ...(component.options || {}) },
  };
}

export function getConfiguredComponentRows(settings, config) {
  const configured = Array.isArray(settings?.component_layout) && settings.component_layout.length
    ? settings.component_layout
    : [['schedule', 'week', 'countdown']];
  return configured
    .map((row) => (Array.isArray(row)
      ? row.map((component, index) => normalizeComponent(component, index, config, settings)).filter(Boolean)
      : []));
}

function buildNewComponent(type, settings) {
  const component = { id: createComponentId(type), type, options: {} };
  if (type === 'week') component.options = { display: true };
  if (type === 'countdown') component.options = { mode: 'date', target: '' };
  if (type === 'time') component.options = { source: 'offset' };
  if (type === 'customText') component.options = { text: settings?.custom_text || '' };
  return component;
}

export default function ComponentsPage({
  rows,
  setRows,
  selectedId,
  setSelectedId,
  settingsRef,
  bump,
  onStatus,
}) {
  const dragRef = useRef(null); // {kind:'chip', id} | {kind:'row', index} | {kind:'library', type}
  const [draggingId, setDraggingId] = useState(null);
  const [overOrder, setOverOrder] = useState(null);
  const [overRow, setOverRow] = useState(null);

  const commitRows = (nextRows) => {
    settingsRef.current.component_layout = nextRows;
    setRows(nextRows);
    setSelectedId(null);
    bump();
  };

  const findChip = (id, sourceRows) => {
    for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
      const colIndex = sourceRows[rowIndex].findIndex((item) => item.id === id);
      if (colIndex !== -1) return { rowIndex, colIndex };
    }
    return null;
  };

  // 将组件插入到目标行的指定位置（按鼠标 X 与目标 chip 中点比较）
  const insertComponent = (componentIdOrObj, targetRowIndex, event) => {
    const sourceRows = rows.map((row) => [...row]);
    let component;
    let sourcePos;
    if (typeof componentIdOrObj === 'string') {
      sourcePos = findChip(componentIdOrObj, sourceRows);
      if (!sourcePos) return;
      [component] = sourceRows[sourcePos.rowIndex].splice(sourcePos.colIndex, 1);
    } else {
      component = componentIdOrObj;
    }
    const targetRow = [...sourceRows[targetRowIndex]];
    const targetChipEl = event.target.closest?.('[data-component-id]');
    let targetIndex = -1;
    if (targetChipEl) {
      const chipId = targetChipEl.dataset.componentId;
      targetIndex = targetRow.findIndex((item) => item.id === chipId);
    }
    if (targetIndex === -1) {
      targetRow.push(component);
    } else {
      const rect = targetChipEl.getBoundingClientRect();
      const insertBefore = event.clientX < rect.left + rect.width / 2;
      targetRow.splice(insertBefore ? targetIndex : targetIndex + 1, 0, component);
    }
    sourceRows[targetRowIndex] = targetRow;
    commitRows(sourceRows);
  };

  const clearDragState = () => {
    dragRef.current = null;
    setDraggingId(null);
    setOverOrder(null);
    setOverRow(null);
  };

  const handleOrderDragOver = (event, rowIndex) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'row') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drag.kind === 'library' ? 'copy' : 'move';
    if (overOrder !== rowIndex) setOverOrder(rowIndex);
  };

  const handleRowDragOver = (event, rowIndex) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'row' || drag.index === rowIndex) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overRow !== rowIndex) setOverRow(rowIndex);
  };

  const handleOrderDrop = (event, rowIndex) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    if (drag.kind === 'library') {
      insertComponent(buildNewComponent(drag.type, settingsRef.current), rowIndex, event);
    } else if (drag.kind === 'chip') {
      insertComponent(drag.id, rowIndex, event);
    }
    clearDragState();
  };

  const handleRowDrop = (event, targetRowIndex) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'row' || drag.index === targetRowIndex) {
      clearDragState();
      return;
    }
    event.preventDefault();
    const sourceIndex = drag.index;
    const rowEl = event.currentTarget;
    const rect = rowEl.getBoundingClientRect();
    const insertBefore = event.clientY < rect.top + rect.height / 2;
    const nextRows = rows.map((row) => [...row]);
    const [moved] = nextRows.splice(sourceIndex, 1);
    let destination = targetRowIndex;
    if (sourceIndex < targetRowIndex) destination -= 1;
    destination = insertBefore ? destination : destination + 1;
    nextRows.splice(destination, 0, moved);
    commitRows(nextRows);
    clearDragState();
  };

  // 课表组件必须至少保留一个：只有存在多个课表实例时才允许删除多余的
  const scheduleCount = rows.flat().filter((component) => component.type === 'schedule').length;

  const removeChip = (event, rowIndex, component) => {
    event.stopPropagation();
    if (component.type === 'schedule' && scheduleCount <= 1) return;
    const nextRows = rows.map((row) => [...row]);
    nextRows[rowIndex] = nextRows[rowIndex].filter((item) => item.id !== component.id);
    commitRows(nextRows);
  };

  const deleteRow = (event, rowIndex) => {
    event.stopPropagation();
    if (rows.length === 1) return;
    // 不允许通过删除整行带走最后一个课表组件
    const rowScheduleCount = rows[rowIndex].filter((component) => component.type === 'schedule').length;
    if (rowScheduleCount > 0 && scheduleCount - rowScheduleCount <= 0) return;
    const nextRows = rows.map((row) => [...row]);
    nextRows.splice(rowIndex, 1);
    commitRows(nextRows);
  };

  const addRow = () => {
    commitRows([...rows.map((row) => [...row]), []]);
  };

  const selected = rows.flat().find((component) => component.id === selectedId) || null;

  const updateOption = (field, value) => {
    if (!selected) return;
    selected.options[field] = value;
    bump();
  };

  return (
    <div className="panel">
      <div className="toolbar components-toolbar" style={{ marginBottom: '14px' }}>
        <strong>布局与组件</strong>
        <Button className="win-small" onClick={addRow}>新增一行</Button>
      </div>
      <p className="field-help">从组件库拖动卡片到任意一行，可重复放置同一种组件；点击已放置的卡片可编辑当前实例。</p>

      <div className="component-rows">
        {rows.map((components, rowIndex) => (
          <div
            key={rowIndex}
            className={`component-row${overRow === rowIndex ? ' drag-over' : ''}`}
            onDragOver={(event) => handleRowDragOver(event, rowIndex)}
            onDrop={(event) => handleRowDrop(event, rowIndex)}
          >
            <span
              className="component-row-title"
              draggable
              title="拖动调整行顺序"
              onDragStart={(event) => {
                dragRef.current = { kind: 'row', index: rowIndex };
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={clearDragState}
            >
              第 {rowIndex + 1} 行
            </span>
            <div>
              <div
                className={`component-order${overOrder === rowIndex ? ' drag-over' : ''}`}
                onDragOver={(event) => handleOrderDragOver(event, rowIndex)}
                onDragLeave={(event) => {
                  if (overOrder === rowIndex && !event.currentTarget.contains(event.relatedTarget)) {
                    setOverOrder(null);
                  }
                }}
                onDrop={(event) => handleOrderDrop(event, rowIndex)}
              >
                {components.map((component) => (
                  <div
                    key={component.id}
                    className={`component-chip${draggingId === component.id ? ' dragging' : ''}`}
                    draggable
                    tabIndex={0}
                    data-component-id={component.id}
                    title="点击编辑，拖动调整组件顺序"
                    onClick={() => setSelectedId(component.id)}
                    onDragStart={(event) => {
                      dragRef.current = { kind: 'chip', id: component.id };
                      setDraggingId(component.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={clearDragState}
                  >
                    <span className="component-drag-handle" aria-hidden="true">
                      <Svg size={14} viewBox="0 0 8 16" html={ICONS.dragDotsVertical} strokeWidth={0} />
                    </span>
                    <span className="component-type-icon">
                      <Svg size={16} viewBox="0 0 20 20" html={COMPONENT_ICONS[component.type]} strokeWidth={1.4} />
                    </span>
                    <span className="component-option">{COMPONENT_LABELS[component.type]}</span>
                    <Button
                      className="chip-remove win-icon"
                      type="button"
                      disabled={component.type === 'schedule' && scheduleCount <= 1}
                      title={component.type === 'schedule' && scheduleCount <= 1 ? '至少保留一个课表组件' : '从布局中删除'}
                      aria-label="从布局中删除"
                      onClick={(event) => removeChip(event, rowIndex, component)}
                      icon={<Svg size={16} viewBox="0 0 16 16" html={ICONS.trash} strokeWidth={1.3} />}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Button
                className="win-icon"
                type="button"
                disabled={rows.length === 1 || (components.some((component) => component.type === 'schedule') && scheduleCount <= 1)}
                title={components.some((component) => component.type === 'schedule') && scheduleCount <= 1 ? '该行包含最后一个课表组件，不能删除' : '删除该行'}
                aria-label="删除该行"
                onClick={(event) => deleteRow(event, rowIndex)}
                icon={<Svg size={14} viewBox="0 0 16 16" html={ICONS.trash} strokeWidth={1.3} />}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        className="component-library"
        onDragStart={(event) => {
          const card = event.target.closest?.('[data-library-type]');
          if (!card) return;
          dragRef.current = { kind: 'library', type: card.dataset.libraryType };
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onDragEnd={clearDragState}
      >
        {Object.keys(COMPONENT_LABELS).map((type) => (
          <div key={type} className="component-library-card" draggable data-library-type={type}>
            <span className="component-type-icon">
              <Svg size={20} viewBox="0 0 20 20" html={COMPONENT_ICONS[type]} strokeWidth={1.4} />
            </span>
            <div className="component-library-text">
              <strong>{COMPONENT_LABELS[type]}</strong>
              <span>{COMPONENT_DESCRIPTIONS[type]}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={`component-editor${selected ? ' active' : ''}`}>
        {!selected ? (
          <div className="component-editor-empty">点击已放置的组件卡片编辑该实例的设置。</div>
        ) : (
          <>
            <div className="component-editor-title">
              <strong>{COMPONENT_LABELS[selected.type]}实例设置</strong>
              <span className="field-help">{selected.id}</span>
            </div>
            <div className="component-editor-fields">
              <ComponentEditorFields component={selected} onOption={updateOption} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ComponentEditorFields({ component, onOption }) {
  const options = component.options || {};
  if (component.type === 'week') {
    return (
      <label className="checkbox-row">
        <Checkbox
          checked={options.display !== false}
          onChange={(event, data) => onOption('display', data.checked === true)}
        />
        <span>显示星期组件</span>
      </label>
    );
  }
  if (component.type === 'countdown') {
    return (
      <div className="field">
        <label>目标日期</label>
        <Input
          type="date"
          value={normalizeDateValue(options.target || '')}
          onChange={(event) => onOption('target', event.target.value)}
        />
        <label>倒计时文字颜色</label>
        <input
          type="color"
          className="native-color"
          value={/^#[0-9a-fA-F]{6}$/i.test(options.color || '') ? options.color : '#ff3a3a'}
          onChange={(event) => onOption('color', event.target.value)}
        />
      </div>
    );
  }
  if (component.type === 'time') {
    return (
      <div className="field">
        <label>时间来源</label>
        <Select
          value={options.source === 'system' ? 'system' : 'offset'}
          onChange={(event) => onOption('source', event.target.value)}
        >
          <option value="offset">偏移时间</option>
          <option value="system">系统时间</option>
        </Select>
      </div>
    );
  }
  if (component.type === 'customText') {
    return (
      <div className="field">
        <label>显示文本</label>
        <Input
          type="text"
          value={String(options.text || '')}
          onChange={(event) => onOption('text', event.target.value)}
        />
      </div>
    );
  }
  return <div className="component-editor-empty">该组件暂无特定设置。</div>;
}
