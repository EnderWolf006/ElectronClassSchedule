import { useRef, useState } from 'react';
import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { Svg, ICONS } from '../../common/icons.jsx';
import { beginPointerGesture, createDragGhost } from '../../common/pointerDnd.js';

export const COMPONENT_LABELS = {
  schedule: '课表',
  week: '星期',
  date: '日期',
  countdown: '倒计日期',
  time: '时间',
  weather: '天气',
  customText: '自定义文本',
};

const COMPONENT_DESCRIPTIONS = {
  schedule: '每日课程和课程倒计时',
  week: '当前星期和日期',
  date: '当前日期和星期',
  countdown: '目标日期倒计时',
  time: '当前时间',
  weather: '当前位置气温与天气',
  customText: '自定义显示文本',
};

const COMPONENT_ICONS = {
  schedule: ICONS.componentSchedule,
  week: ICONS.componentWeek,
  date: ICONS.componentDate,
  countdown: ICONS.componentCountdown,
  time: ICONS.componentTime,
  weather: ICONS.componentWeather,
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
  if (!component || typeof component.type !== 'string' || !component.type.trim()) return null;
  return {
    id: component.id || createComponentId(component.type),
    type: component.type.trim(),
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

function buildNewComponent(type, settings, pluginDefs) {
  const component = { id: createComponentId(type), type, options: {} };
  if (type === 'week') component.options = { display: true };
  if (type === 'countdown') component.options = { mode: 'date', target: '', start: '', showProgress: true };
  if (type === 'time') component.options = { source: 'offset' };
  if (type === 'weather') component.options = { city: '' };
  if (type === 'customText') component.options = { text: settings?.custom_text || '' };
  // 插件组件：按清单里的 options 模式填入默认值
  const definition = (Array.isArray(pluginDefs) ? pluginDefs : []).find((item) => item && item.type === type);
  if (definition) {
    const options = {};
    (Array.isArray(definition.options) ? definition.options : []).forEach((option) => {
      if (!option || !option.key) return;
      if (option.default !== undefined) options[option.key] = option.default;
      else options[option.key] = option.type === 'switch' ? false : '';
    });
    component.options = options;
  }
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
  pluginComponents,
}) {
  // 组件名称/描述/图标：内置组件 + 启用插件声明的组件
  const pluginDefs = Array.isArray(pluginComponents) ? pluginComponents : [];
  const labels = { ...COMPONENT_LABELS };
  const descriptions = { ...COMPONENT_DESCRIPTIONS };
  const icons = { ...COMPONENT_ICONS };
  const pluginSchemas = {};
  pluginDefs.forEach((definition) => {
    if (!definition || !definition.type) return;
    labels[definition.type] = definition.name || definition.type;
    descriptions[definition.type] = definition.description || '插件提供的组件';
    icons[definition.type] = ICONS.componentCustomText;
    pluginSchemas[definition.type] = Array.isArray(definition.options) ? definition.options : [];
  });
  const dragRef = useRef(null); // {kind:'chip', id} | {kind:'row', index} | {kind:'library', type}
  const [draggingId, setDraggingId] = useState(null);
  const [overOrder, setOverOrder] = useState(null);
  const [overRow, setOverRow] = useState(null);
  // 触屏手势通道（HTML5 DnD 在触屏下不触发）
  const gestureRef = useRef(null);
  const ghostRef = useRef(null);
  const suppressTapRef = useRef(false);

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

  // 将组件插入到目标行的指定位置（按指针 X 与目标 chip 中点比较）
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

  // ===== 触屏（Pointer Events）拖拽：命中检测与落点逻辑 =====
  const orderRowFromPoint = (x, y) => {
    const hitEl = document.elementFromPoint(x, y);
    const orderEl = hitEl?.closest?.('.component-order');
    if (!orderEl) return null;
    return { orderEl, rowIndex: Number(orderEl.dataset.rowIndex), hitEl };
  };

  const rowFromPoint = (x, y) => {
    const hitEl = document.elementFromPoint(x, y);
    const rowEl = hitEl?.closest?.('.component-row');
    if (!rowEl) return null;
    return { rowEl, rowIndex: Number(rowEl.dataset.rowIndex), hitEl };
  };

  const dropComponentAt = (x, y) => {
    const drag = dragRef.current;
    if (!drag || drag.kind === 'row') return;
    const hit = orderRowFromPoint(x, y);
    if (!hit) return;
    const fakeEvent = { target: hit.hitEl, clientX: x, preventDefault() {} };
    if (drag.kind === 'library') {
      insertComponent(buildNewComponent(drag.type, settingsRef.current, pluginDefs), hit.rowIndex, fakeEvent);
    } else {
      insertComponent(drag.id, hit.rowIndex, fakeEvent);
    }
  };

  const dropRowAt = (x, y) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'row') return;
    const hit = rowFromPoint(x, y);
    if (!hit || drag.index === hit.rowIndex) return;
    const rect = hit.rowEl.getBoundingClientRect();
    const insertBefore = y < rect.top + rect.height / 2;
    const nextRows = rows.map((row) => [...row]);
    const [moved] = nextRows.splice(drag.index, 1);
    let destination = hit.rowIndex;
    if (drag.index < hit.rowIndex) destination -= 1;
    destination = insertBefore ? destination : destination + 1;
    nextRows.splice(destination, 0, moved);
    commitRows(nextRows);
  };

  const finishTouchGesture = (cancelTap = true) => {
    gestureRef.current = null;
    ghostRef.current?.dispose();
    ghostRef.current = null;
    clearDragState();
    if (cancelTap) {
      // 拖拽松手后浏览器可能仍合成一次 click，需抑制，避免误打开实例编辑器
      suppressTapRef.current = true;
      setTimeout(() => { suppressTapRef.current = false; }, 0);
    }
  };

  // 已放置组件（chip）触屏拖动
  const beginChipTouchDrag = (event, component) => {
    if (event.pointerType === 'mouse') return;
    if (event.target.closest?.('.chip-remove')) return;
    const sourceEl = event.currentTarget;
    const gesture = beginPointerGesture(event, {
      onActivate: ({ x, y }) => {
        dragRef.current = { kind: 'chip', id: component.id };
        setDraggingId(component.id);
        ghostRef.current = createDragGhost(sourceEl);
        ghostRef.current.move(x, y);
        const hit = orderRowFromPoint(x, y);
        setOverOrder(hit ? hit.rowIndex : null);
      },
      onMove: ({ x, y }) => {
        ghostRef.current?.move(x, y);
        const hit = orderRowFromPoint(x, y);
        setOverOrder((prev) => (prev === (hit ? hit.rowIndex : null) ? prev : (hit ? hit.rowIndex : null)));
      },
      onEnd: ({ x, y, canceled }) => {
        if (!canceled) dropComponentAt(x, y);
        finishTouchGesture();
      },
    });
    if (gesture) gestureRef.current = gesture;
  };

  // 行标题触屏拖动（调整行顺序）
  const beginRowTouchDrag = (event, rowIndex) => {
    if (event.pointerType === 'mouse') return;
    const sourceEl = event.currentTarget;
    const gesture = beginPointerGesture(event, {
      onActivate: ({ x, y }) => {
        dragRef.current = { kind: 'row', index: rowIndex };
        ghostRef.current = createDragGhost(sourceEl);
        ghostRef.current.move(x, y);
        const hit = rowFromPoint(x, y);
        setOverRow(hit && hit.rowIndex !== rowIndex ? hit.rowIndex : null);
      },
      onMove: ({ x, y }) => {
        ghostRef.current?.move(x, y);
        const hit = rowFromPoint(x, y);
        setOverRow(hit && hit.rowIndex !== rowIndex ? hit.rowIndex : null);
      },
      onEnd: ({ x, y, canceled }) => {
        if (!canceled) dropRowAt(x, y);
        finishTouchGesture(false);
      },
    });
    if (gesture) gestureRef.current = gesture;
  };

  // 组件库卡片触屏拖动
  const beginLibraryTouchDrag = (event, type) => {
    if (event.pointerType === 'mouse') return;
    const sourceEl = event.currentTarget;
    const gesture = beginPointerGesture(event, {
      onActivate: ({ x, y }) => {
        dragRef.current = { kind: 'library', type };
        sourceEl.classList.add('dragging');
        ghostRef.current = createDragGhost(sourceEl);
        ghostRef.current.move(x, y);
        const hit = orderRowFromPoint(x, y);
        setOverOrder(hit ? hit.rowIndex : null);
      },
      onMove: ({ x, y }) => {
        ghostRef.current?.move(x, y);
        const hit = orderRowFromPoint(x, y);
        setOverOrder(hit ? hit.rowIndex : null);
      },
      onEnd: ({ x, y, canceled }) => {
        sourceEl.classList.remove('dragging');
        if (!canceled) dropComponentAt(x, y);
        finishTouchGesture();
      },
    });
    if (gesture) gestureRef.current = gesture;
  };

  // ===== 以下为鼠标（HTML5 Drag and Drop）通道，触屏不触发，保留原行为 =====
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
      insertComponent(buildNewComponent(drag.type, settingsRef.current, pluginDefs), rowIndex, event);
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
    const rect = event.currentTarget.getBoundingClientRect();
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
    // 必须生成新的 rows 引用：父页面的防抖落盘 effect 依赖 rows 变化，
    // 原地 mutate + bump() 只会重绘 UI，不会触发保存。
    const nextRows = rows.map((row) => row.map((component) => (
      component.id === selected.id
        ? { ...component, options: { ...component.options, [field]: value } }
        : component
    )));
    settingsRef.current.component_layout = nextRows;
    setRows(nextRows);
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
            data-row-index={rowIndex}
            onDragOver={(event) => handleRowDragOver(event, rowIndex)}
            onDrop={(event) => handleRowDrop(event, rowIndex)}
          >
            <span
              className="component-row-title"
              draggable
              title="拖动调整行顺序"
              onPointerDown={(event) => beginRowTouchDrag(event, rowIndex)}
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
                data-row-index={rowIndex}
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
                    onClick={() => {
                      if (suppressTapRef.current) return;
                      setSelectedId(component.id);
                    }}
                    onPointerDown={(event) => beginChipTouchDrag(event, component)}
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
                      <Svg size={16} viewBox="0 0 20 20" html={icons[component.type] || ICONS.componentCustomText} strokeWidth={1.4} />
                    </span>
                    <span className="component-option">{labels[component.type] || component.type}</span>
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
        {Object.keys(labels).map((type) => (
          <div
            key={type}
            className="component-library-card"
            draggable
            data-library-type={type}
            onPointerDown={(event) => beginLibraryTouchDrag(event, type)}
          >
            <span className="component-type-icon">
              <Svg size={20} viewBox="0 0 20 20" html={icons[type] || ICONS.componentCustomText} strokeWidth={1.4} />
            </span>
            <div className="component-library-text">
              <strong>{labels[type]}</strong>
              <span>{descriptions[type]}</span>
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
              <strong>{labels[selected.type] || selected.type}实例设置</strong>
              <span className="field-help">{selected.id}</span>
            </div>
            <div className="component-editor-fields">
              <ComponentEditorFields
                component={selected}
                onOption={updateOption}
                pluginSchema={pluginSchemas[selected.type] || null}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ComponentEditorFields({ component, onOption, pluginSchema }) {
  const options = component.options || {};
  // 取色草稿：取色过程中只更新界面不落盘，失焦（关闭取色器 / 点击其它位置）后才保存
  const [colorDraft, setColorDraft] = useState(null);
  const draftActive = colorDraft && colorDraft.id === component.id;
  // 插件组件：按清单声明的 options 模式渲染通用表单
  if (Array.isArray(pluginSchema) && pluginSchema.length) {
    return (
      <div className="field">
        {pluginSchema.map((option) => {
          if (!option || !option.key) return null;
          if (option.type === 'switch') {
            return (
              <label className="checkbox-row" key={option.key}>
                <Checkbox
                  checked={options[option.key] === true}
                  onChange={(event, data) => onOption(option.key, data.checked === true)}
                />
                <span>{option.label}</span>
              </label>
            );
          }
          return (
            <div key={option.key}>
              <label>{option.label}</label>
              <Input
                type={option.type === 'number' ? 'number' : 'text'}
                value={String(options[option.key] ?? '')}
                onChange={(event) => onOption(option.key, event.target.value)}
              />
            </div>
          );
        })}
      </div>
    );
  }
  if (component.type === 'schedule') {
    return (
      <label className="checkbox-row">
        <Checkbox
          checked={options.showProgress !== false}
          onChange={(event, data) => onOption('showProgress', data.checked === true)}
        />
        <span>显示倒计时进度条（上课/课间时间段进度）</span>
      </label>
    );
  }
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
        <label>起始日期</label>
        <Input
          type="date"
          value={normalizeDateValue(options.start || '')}
          onChange={(event) => onOption('start', event.target.value)}
        />
        <label>终止日期</label>
        <Input
          type="date"
          value={normalizeDateValue(options.target || '')}
          onChange={(event) => onOption('target', event.target.value)}
        />
        <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Checkbox
            checked={options.showProgress === true}
            onChange={(event, data) => onOption('showProgress', data.checked === true)}
          />
          <span>显示进度条（起始日 → 终止日）</span>
        </label>
        <label>倒计时文字颜色</label>
        <input
          type="color"
          className="native-color"
          title="取色过程中不会保存，关闭取色器或点击其它位置后才保存"
          value={draftActive
            ? colorDraft.value
            : (/^#[0-9a-fA-F]{6}$/i.test(options.color || '') ? options.color : '#ff3a3a')}
          onChange={(event) => setColorDraft({ id: component.id, value: event.target.value })}
          onBlur={() => {
            if (draftActive && colorDraft.value !== options.color) onOption('color', colorDraft.value);
            setColorDraft(null);
          }}
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
  if (component.type === 'weather') {
    return (
      <div className="field">
        <label>城市（留空则按网络自动定位）</label>
        <Input
          type="text"
          placeholder="如：北京 / Shanghai"
          value={String(options.city || '')}
          onChange={(event) => onOption('city', event.target.value)}
        />
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
