import { Input } from '@fluentui/react-components';

export default function DividerPage({ config, dividerTexts, onChangeText }) {
  const groups = config && config.divider ? config.divider : {};
  const groupNames = Object.keys(groups);

  return (
    <>
      <div className="page-header">
        <h2>分割线</h2>
        <p>配置不同时间表中的视觉分隔线位置。</p>
      </div>
      <div className="panel">
        <div className="card-grid">
          {groupNames.length === 0 && <div className="empty">暂无分割线配置</div>}
          {groupNames.map((name) => (
            <div className="group-card" key={name}>
              <h3>{name}</h3>
              <div className="field divider-field">
                <label htmlFor={`divider-${name}`}>分割线位置（逗号分隔）</label>
                <Input
                  id={`divider-${name}`}
                  value={dividerTexts[name] !== undefined
                    ? dividerTexts[name]
                    : (groups[name] || []).join(', ')}
                  onChange={(event) => onChangeText(name, event.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
