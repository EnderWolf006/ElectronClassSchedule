import { useCallback, useEffect, useState } from 'react';
import { Button, Switch, Input, Select } from '@fluentui/react-components';
import { Svg, ICONS } from '../../common/icons.jsx';

// 自动化规则：条件集全部满足时执行动作集。
// 事件条件：class_start_offset(上课) / class_end_offset(下课) / dismissal_offset(放学) /
//           state_change_offset(时间状态改变) / app_launch(运行指定应用)
//           ——前四者配合 前/时/后 + 秒数 构成触发时刻，app_launch 在指定进程出现时触发
// 状态条件：time(到达时间) / class_start(某节课开始) / class_end(某节课结束) /
//           day_of_week(星期几) / current_class_is(当前课程是) / next_class_is(下节课是) /
//           prev_class_is(上节课是) / time_state_is(当前时间状态是)
// 动作类型：switch_theme / switch_position / show_reminder / switch_schedule /
//           set_countdown_style / open_app / exec_command / shutdown
const CONDITION_TYPES = [
  { value: 'time', label: '到达时间' },
  { value: 'class_start', label: '某节课开始' },
  { value: 'class_end', label: '某节课结束' },
  { value: 'day_of_week', label: '星期几' },
  { value: 'class_start_offset', label: '上课' },
  { value: 'class_end_offset', label: '下课' },
  { value: 'dismissal_offset', label: '放学' },
  { value: 'state_change_offset', label: '时间状态改变' },
  { value: 'app_launch', label: '运行指定应用' },
  { value: 'current_class_is', label: '当前课程是' },
  { value: 'next_class_is', label: '下节课是' },
  { value: 'prev_class_is', label: '上节课是' },
  { value: 'time_state_is', label: '当前时间状态是' },
];
const EVENT_OFFSET_TYPES = new Set(['class_start_offset', 'class_end_offset', 'dismissal_offset', 'state_change_offset']);
const OFFSET_KINDS = [
  { value: 'before', label: '前' },
  { value: 'at', label: '时' },
  { value: 'after', label: '后' },
];
const TIME_STATES = [
  { value: 'class', label: '上课' },
  { value: 'break', label: '下课' },
  { value: 'upcoming', label: '准备上课' },
];
const ACTION_TYPES = [
  { value: 'switch_theme', label: '切换主题' },
  { value: 'switch_position', label: '切换窗口位置' },
  { value: 'show_reminder', label: '提醒' },
  { value: 'switch_schedule', label: '切换课表' },
  { value: 'set_countdown_style', label: '切换倒计时样式' },
  { value: 'open_app', label: '打开应用' },
  { value: 'exec_command', label: '执行命令' },
  { value: 'shutdown', label: '自动关机' },
];
const POSITION_OPTIONS = [
  { value: 'top', label: '顶部居中' },
  { value: 'top-right', label: '顶部靠右' },
  { value: 'right', label: '右侧竖排' },
];
const COUNTDOWN_STYLES = [
  { value: 'floating', label: '悬浮' },
  { value: 'inline', label: '内嵌' },
];
// 切换条件类型时补充该类型所需的默认字段
const CONDITION_DEFAULTS = {
  time: { value: '08:00' },
  class_start: { value: '0' },
  class_end: { value: '0' },
  day_of_week: { value: '1' },
  class_start_offset: { offset_kind: 'before', seconds: 30 },
  class_end_offset: { offset_kind: 'at', seconds: 0 },
  dismissal_offset: { offset_kind: 'after', seconds: 60 },
  state_change_offset: { offset_kind: 'at', seconds: 0 },
  app_launch: { value: '' },
  current_class_is: { value: '' },
  next_class_is: { value: '' },
  prev_class_is: { value: '' },
  time_state_is: { value: 'class' },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function AutomationPage({ automationRules, onChange }) {
  const [rules, setRules] = useState(Array.isArray(automationRules) ? automationRules : []);

  // 设置窗口打开时配置异步加载：加载完成后 prop 才从 [] 变为实际规则，
  // useState 初值只在首挂载生效，必须用 effect 跟随 prop 同步，否则已保存的规则不显示
  useEffect(() => {
    setRules(Array.isArray(automationRules) ? automationRules : []);
  }, [automationRules]);

  const persist = useCallback((next) => {
    setRules(next);
    onChange(next);
  }, [onChange]);

  const addRule = () => {
    const next = [...rules, { id: uid(), name: '新规则', enabled: true, matchMode: 'all', conditions: [], actions: [] }];
    persist(next);
  };

  const updateRule = (id, patch) => {
    persist(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRule = (id) => {
    persist(rules.filter((r) => r.id !== id));
  };

  const addCondition = (ruleId) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, conditions: [...r.conditions, { id: uid(), type: 'time', value: '08:00' }] }
      : r)));
  };

  const updateCondition = (ruleId, condId, patch) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, conditions: r.conditions.map((c) => (c.id === condId ? { ...c, ...patch } : c)) }
      : r)));
  };

  // 类型切换时合并新类型的默认字段（保留 id）
  const changeConditionType = (ruleId, condId, type) => {
    const defaults = CONDITION_DEFAULTS[type] || {};
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, conditions: r.conditions.map((c) => (c.id === condId ? { ...c, ...defaults, type } : c)) }
      : r)));
  };

  const removeCondition = (ruleId, condId) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, conditions: r.conditions.filter((c) => c.id !== condId) }
      : r)));
  };

  const addAction = (ruleId) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, actions: [...r.actions, { id: uid(), type: 'show_reminder', value: '提醒内容' }] }
      : r)));
  };

  const updateAction = (ruleId, actId, patch) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, actions: r.actions.map((a) => (a.id === actId ? { ...a, ...patch } : a)) }
      : r)));
  };

  // 类型切换时补充该类型所需的默认字段（保留 id）
  const ACTION_DEFAULTS = {
    switch_theme: { value: '' },
    switch_position: { value: 'top' },
    show_reminder: { value: '提醒内容' },
    switch_schedule: { value: '' },
    set_countdown_style: { value: 'floating' },
    open_app: { value: '' },
    exec_command: { value: '' },
    shutdown: { value: 60 },
  };
  const changeActionType = (ruleId, actId, type) => {
    const defaults = ACTION_DEFAULTS[type] || {};
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, actions: r.actions.map((a) => (a.id === actId ? { ...a, ...defaults, type } : a)) }
      : r)));
  };

  const removeAction = (ruleId, actId) => {
    persist(rules.map((r) => (r.id === ruleId
      ? { ...r, actions: r.actions.filter((a) => a.id !== actId) }
      : r)));
  };

  const renderConditionFields = (rule, cond) => {
    if (EVENT_OFFSET_TYPES.has(cond.type)) {
      return (
        <>
          <Select
            value={cond.offset_kind || 'at'}
            onChange={(e) => updateCondition(rule.id, cond.id, { offset_kind: e.target.value })}
            style={{ minWidth: 84 }}
          >
            {OFFSET_KINDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input
            type="number"
            min="0"
            step="1"
            value={String(cond.seconds ?? 0)}
            onChange={(e) => updateCondition(rule.id, cond.id, { seconds: Number(e.target.value) || 0 })}
            placeholder="秒"
            style={{ width: 90 }}
          />
        </>
      );
    }
    if (cond.type === 'app_launch') {
      return (
        <Input
          value={cond.value || ''}
          onChange={(e) => updateCondition(rule.id, cond.id, { value: e.target.value })}
          placeholder="进程名，如 notepad.exe"
          style={{ flex: 1 }}
        />
      );
    }
    if (cond.type === 'time_state_is') {
      return (
        <Select
          value={cond.value || 'class'}
          onChange={(e) => updateCondition(rule.id, cond.id, { value: e.target.value })}
          style={{ flex: 1 }}
        >
          {TIME_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      );
    }
    return (
      <Input
        value={cond.value || ''}
        onChange={(e) => updateCondition(rule.id, cond.id, { value: e.target.value })}
        placeholder={cond.type === 'time' ? 'HH:MM'
          : cond.type === 'day_of_week' ? '1-7 (周一=1)'
            : cond.type === 'class_start' || cond.type === 'class_end' ? '节次索引'
              : '课程名（支持包含匹配）'}
        style={{ flex: 1 }}
      />
    );
  };

  const renderActionFields = (rule, act) => {
    if (act.type === 'switch_position') {
      return (
        <Select
          value={act.value}
          onChange={(e) => updateAction(rule.id, act.id, { value: e.target.value })}
          style={{ flex: 1 }}
        >
          {POSITION_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      );
    }
    if (act.type === 'set_countdown_style') {
      return (
        <Select
          value={act.value}
          onChange={(e) => updateAction(rule.id, act.id, { value: e.target.value })}
          style={{ flex: 1 }}
        >
          {COUNTDOWN_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      );
    }
    if (act.type === 'shutdown') {
      return (
        <>
          <Input
            type="number"
            min="0"
            step="1"
            value={String(act.value ?? 60)}
            onChange={(e) => updateAction(rule.id, act.id, { value: Number(e.target.value) || 0 })}
            placeholder="延时秒数"
            style={{ width: 110 }}
          />
          <span className="field-help" style={{ whiteSpace: 'nowrap' }}>秒后关机</span>
        </>
      );
    }
    return (
      <Input
        value={act.value || ''}
        onChange={(e) => updateAction(rule.id, act.id, { value: e.target.value })}
        placeholder={act.type === 'show_reminder' ? '提醒文字'
          : act.type === 'switch_theme' ? '主题包ID'
            : act.type === 'open_app' ? '应用路径，如 C:\\Program Files\\app.exe'
              : act.type === 'exec_command' ? '命令行，如 shutdown /a'
                : '课表名'}
        style={{ flex: 1 }}
      />
    );
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">自动化</h1>
        <p className="page-intro">
          设置规则集，满足条件时自动执行对应动作（可选"全部满足"或"满足任意"），动作按顺序执行。
          上课/下课/放学/时间状态改变可配合 前/时/后 与秒数偏移；运行指定应用在所选进程出现时触发。
        </p>
      </div>
      <div className="panel">
        <div className="theme-packs-toolbar">
          <h3>规则列表</h3>
          <Button className="win-small" onClick={addRule}>
            <Svg size={16} viewBox="0 0 24 24" html={ICONS.basicSettings} /> 新增规则
          </Button>
        </div>
        {rules.length === 0 ? (
          <div className="empty">暂无自动化规则，点击"新增规则"创建。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.map((rule) => (
              <div key={rule.id} className="theme-pack-card" style={{ display: 'block', cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Input
                    value={rule.name}
                    onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <Switch
                    checked={rule.enabled}
                    onChange={(_e, d) => updateRule(rule.id, { enabled: d.checked })}
                  />
                  <Button className="win-small" onClick={() => removeRule(rule.id)}>删除</Button>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                    <span className="field-help">条件</span>
                    <Select
                      value={rule.matchMode || 'all'}
                      onChange={(e) => updateRule(rule.id, { matchMode: e.target.value })}
                      style={{ minWidth: 120 }}
                    >
                      <option value="all">全部满足</option>
                      <option value="any">满足任意</option>
                    </Select>
                  </div>
                  {rule.conditions.map((cond) => (
                    <div key={cond.id} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                      <Select
                        value={cond.type}
                        onChange={(e) => changeConditionType(rule.id, cond.id, e.target.value)}
                        style={{ minWidth: 120 }}
                      >
                        {CONDITION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                      {renderConditionFields(rule, cond)}
                      <Button className="win-small" onClick={() => removeCondition(rule.id, cond.id)}>×</Button>
                    </div>
                  ))}
                  <Button className="win-small" onClick={() => addCondition(rule.id)}>+ 条件</Button>
                </div>

                <div>
                  <div className="field-help" style={{ margin: '4px 0' }}>动作</div>
                  {rule.actions.map((act) => (
                    <div key={act.id} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                      <Select
                        value={act.type}
                        onChange={(e) => changeActionType(rule.id, act.id, e.target.value)}
                        style={{ minWidth: 120 }}
                      >
                        {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                      {renderActionFields(rule, act)}
                      <Button className="win-small" onClick={() => removeAction(rule.id, act.id)}>×</Button>
                    </div>
                  ))}
                  <Button className="win-small" onClick={() => addAction(rule.id)}>+ 动作</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
