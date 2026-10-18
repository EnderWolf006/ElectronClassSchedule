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
  merge: '合并',
  carousel: '轮播',
};

const COMPONENT_DESCRIPTIONS = {
  schedule: '每日课程和课程倒计时',
  week: '当前星期和日期',
  date: '当前日期和星期',
  countdown: '目标日期倒计时',
  time: '当前时间',
  weather: '当前位置气温与天气',
  customText: '自定义显示文本',
  merge: '多个组件合为一个大背景块',
  carousel: '按间隔轮播多个子组件',
};

const COMPONENT_ICONS = {
  schedule: ICONS.componentSchedule,
  week: ICONS.componentWeek,
  date: ICONS.componentDate,
  countdown: ICONS.componentCountdown,
  time: ICONS.componentTime,
  weather: ICONS.componentWeather,
  customText: ICONS.componentCustomText,
  merge: ICONS.components,
  carousel: '<path d="M4.2 10a5.8 5.8 0 0 1 10-4M15.8 10a5.8 5.8 0 0 1-10 4"/><path d="M14.6 2.6v3.4h-3.4M5.4 17.4V14h3.4"/>',
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
  const options = { ...(component.options || {}) };
  // 容器组件（merge/carousel）：子组件递归归一化，支持套娃嵌套
  if (Array.isArray(options.children)) {
    options.children = options.children
      .map((child, index) => normalizeComponent(child, index, config, settings))
      .filter(Boolean);
  }
  return {
    id: component.id || createComponentId(component.type),
    type: component.type.trim(),
    options,
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

// ===== 布局树递归工具（容器组件的 options.children 也参与遍历） =====

// 递归拍平全部组件（含 merge/carousel 的子级）
export function flattenComponentRows(rows) {
  const out = [];
  const walk = (list) => (Array.isArray(list) ? list : []).forEach((component) => {
    if (!component) return;
    out.push(component);
    walk(component.options?.children);
  });
  (Array.isArray(rows) ? rows : []).forEach((row) => walk(row));
  return out;
}

export function findComponentInRows(rows, id) {
  return flattenComponentRows(rows).find((component) => component.id === id) || null;
}

export function countComponentType(rows, type) {
  return flattenComponentRows(rows).filter((component) => component.type === type).length;
}

// 深映射：对 id 匹配的组件应用 updater（容器子级递归），返回新 rows 引用
export function mapComponentInRows(rows, id, updater) {
  return rows.map((row) => row.map((component) => {
    if (component.id === id) return updater(component);
    const children = component.options?.children;
    if (Array.isArray(children) && children.length) {
      return { ...component, options: { ...component.options, children: mapComponentInRows([children], id, updater)[0] } };
    }
    return component;
  }));
}

function buildNewComponent(type, settings, pluginDefs) {
  const component = { id: createComponentId(type), type, options: {} };
  if (type === 'week') component.options = { display: true };
  if (type === 'countdown') component.options = { mode: 'date', target: '', start: '', showProgress: true };
  if (type === 'time') component.options = { source: 'offset' };
  if (type === 'weather') component.options = { city: '' };
  if (type === 'customText') component.options = { text: settings?.custom_text || '' };
  // 容器组件：子组件列表初始为空，由编辑器按钮逐个添加
  if (type === 'merge') component.options = { children: [] };
  if (type === 'carousel') component.options = { children: [], interval: 5 };
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

  // 课表组件必须至少保留一个：统计含容器子级在内的全部课表实例
  const scheduleCount = countComponentType(rows, 'schedule');

  const removeChip = (event, rowIndex, component) => {
    event.stopPropagation();
    // 组件子树内含课表时，删除后不得让课表总数归零（容器可能包着最后一个课表）
    const subtreeSchedules = countComponentType([[component]], 'schedule');
    if (subtreeSchedules > 0 && scheduleCount - subtreeSchedules <= 0) return;
    const nextRows = rows.map((row) => [...row]);
    nextRows[rowIndex] = nextRows[rowIndex].filter((item) => item.id !== component.id);
    commitRows(nextRows);
  };

  const deleteRow = (event, rowIndex) => {
    event.stopPropagation();
    if (rows.length === 1) return;
    // 不允许通过删除整行带走最后一个课表组件（含行内容器子级里的课表）
    const rowScheduleCount = countComponentType([rows[rowIndex]], 'schedule');
    if (rowScheduleCount > 0 && scheduleCount - rowScheduleCount <= 0) return;
    const nextRows = rows.map((row) => [...row]);
    nextRows.splice(rowIndex, 1);
    commitRows(nextRows);
  };

  const addRow = () => {
    commitRows([...rows.map((row) => [...row]), []]);
  };

  const selected = (selectedId ? findComponentInRows(rows, selectedId) : null) || null;

  // 按 id 深更新任意组件（含容器子级）：产出新 rows 引用触发父页防抖落盘
  const updateComponent = (id, updater) => {
    const nextRows = mapComponentInRows(rows, id, updater);
    settingsRef.current.component_layout = nextRows;
    setRows(nextRows);
    bump();
  };

  const updateOption = (field, value) => {
    if (!selected) return;
    // 必须生成新的 rows 引用：父页面的防抖落盘 effect 依赖 rows 变化，
    // 原地 mutate + bump() 只会重绘 UI，不会触发保存。
    updateComponent(selected.id, (component) => ({
      ...component,
      options: { ...component.options, [field]: value },
    }));
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
                {components.map((component) => {
                  // 子树内含课表的组件（含课表本体与包着课表的容器）：删除后课表总数不得归零
                  const chipSchedules = countComponentType([[component]], 'schedule');
                  const removeDisabled = chipSchedules > 0 && scheduleCount - chipSchedules <= 0;
                  return (
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
                      disabled={removeDisabled}
                      title={removeDisabled ? '至少保留一个课表组件' : '从布局中删除'}
                      aria-label="从布局中删除"
                      onClick={(event) => removeChip(event, rowIndex, component)}
                      icon={<Svg size={16} viewBox="0 0 16 16" html={ICONS.trash} strokeWidth={1.3} />}
                    />
                  </div>
                  );
                })}
              </div>
            </div>
            <div>
              <Button
                className="win-icon"
                type="button"
                disabled={rows.length === 1 || (countComponentType([components], 'schedule') > 0 && scheduleCount - countComponentType([components], 'schedule') <= 0)}
                title={countComponentType([components], 'schedule') > 0 && scheduleCount - countComponentType([components], 'schedule') <= 0 ? '该行包含最后一个课表组件，不能删除' : '删除该行'}
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
                containerContext={{
                  labels,
                  icons,
                  allTypes: Object.keys(labels),
                  scheduleCount,
                  updateComponent,
                  selectComponent: (id) => setSelectedId(id),
                  createChild: (type) => buildNewComponent(type, settingsRef.current, pluginDefs),
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ComponentEditorFields({ component, onOption, pluginSchema, containerContext }) {
  const options = component.options || {};
  // 取色草稿：取色过程中只更新界面不落盘，失焦（关闭取色器 / 点击其它位置）后才保存
  const [colorDraft, setColorDraft] = useState(null);
  const draftActive = colorDraft && colorDraft.id === component.id;
  // 容器组件（合并/轮播）：子组件管理与轮播间隔
  if (component.type === 'merge' || component.type === 'carousel') {
    return (
      <ContainerEditor
        component={component}
        onOption={onOption}
        {...containerContext}
      />
    );
  }
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

// ===== 容器组件（合并/轮播）编辑器：按钮式管理子组件，支持套娃嵌套 =====
function ContainerEditor({
  component,
  onOption,
  labels,
  icons,
  allTypes,
  scheduleCount,
  updateComponent,
  selectComponent,
  createChild,
}) {
  const options = component.options || {};
  const children = Array.isArray(options.children) ? options.children : [];
  const [addType, setAddType] = useState('week');

  // 子级列表整体替换（增/删/排序）：经深映射产出新 rows 引用触发落盘
  const setChildren = (nextChildren) => {
    updateComponent(component.id, (current) => ({
      ...current,
      options: { ...current.options, children: nextChildren },
    }));
  };

  const moveChild = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= children.length) return;
    const next = [...children];
    [next[index], next[target]] = [next[target], next[index]];
    setChildren(next);
  };

  const removeChild = (child) => {
    const subtreeSchedules = countComponentType([[child]], 'schedule');
    if (subtreeSchedules > 0 && scheduleCount - subtreeSchedules <= 0) return;
    setChildren(children.filter((item) => item.id !== child.id));
  };

  return (
    <div className="field container-editor">
      {component.type === 'carousel' && (
        <>
          <label>切换间隔（秒）</label>
          <Input
            type="number"
            min={1}
            step={1}
            value={String(options.interval ?? 5)}
            onChange={(event) => onOption('interval', Math.max(1, Math.round(Number(event.target.value) || 5)))}
          />
        </>
      )}
      <label>子组件（{children.length}）</label>
      <div className="container-children">
        {children.length === 0 && (
          <div className="component-editor-empty">暂无子组件，请在下方选择类型后添加。</div>
        )}
        {children.map((child, index) => {
          const childSchedules = countComponentType([[child]], 'schedule');
          const removeDisabled = childSchedules > 0 && scheduleCount - childSchedules <= 0;
          return (
            <div className="container-child" key={child.id}>
              <span className="component-type-icon">
                <Svg size={16} viewBox="0 0 20 20" html={icons[child.type] || ICONS.componentCustomText} strokeWidth={1.4} />
              </span>
              <span className="container-child-label">{labels[child.type] || child.type}</span>
              <div className="container-child-actions">
                <Button className="win-small" type="button" disabled={index === 0} onClick={() => moveChild(index, -1)}>上移</Button>
                <Button className="win-small" type="button" disabled={index === children.length - 1} onClick={() => moveChild(index, 1)}>下移</Button>
                <Button className="win-small" type="button" onClick={() => selectComponent(child.id)}>编辑</Button>
                <Button
                  className="win-small"
                  type="button"
                  disabled={removeDisabled}
                  title={removeDisabled ? '至少保留一个课表组件' : '从容器中删除'}
                  onClick={() => removeChild(child)}
                >
                  删除
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="container-add">
        <Select value={addType} onChange={(event) => setAddType(event.target.value)}>
          {allTypes.map((type) => (
            <option key={type} value={type}>{labels[type] || type}</option>
          ))}
        </Select>
        <Button className="win-small" type="button" onClick={() => setChildren([...children, createChild(addType)])}>
          添加子组件
        </Button>
      </div>
      <p className="field-help">子组件可继续选择“合并”“轮播”实现套娃堆叠；点击“编辑”可进入该子组件的设置。</p>
    </div>
  );
}
