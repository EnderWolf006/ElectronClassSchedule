import { Button, Input } from '@fluentui/react-components';

// 科目名称页：rows 为 [{ key, value }]，保存时在 App 中收敛为对象
export default function SubjectPage({ rows, onChange }) {
  const updateRow = (index, patch) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeRow = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...rows, { key: '', value: '' }]);
  };

  return (
    <>
      <div className="page-header">
        <h2>科目名称</h2>
        <p>设置每个课程简称对应的完整名称。</p>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>简称</th>
              <th style={{ width: '50%' }}>全称</th>
              <th style={{ width: '20%' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="empty">暂无科目配置</td></tr>
            )}
            {rows.map((row, index) => (
              <tr className="subject-row" key={index}>
                <td>
                  <span className="subject-cell">
                    <Input
                      value={row.key}
                      placeholder="例如：自@语"
                      onChange={(event) => updateRow(index, { key: event.target.value })}
                    />
                  </span>
                </td>
                <td>
                  <span className="subject-cell">
                    <Input
                      value={row.value}
                      placeholder="例如：语文周测"
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                    />
                  </span>
                </td>
                <td>
                  <Button
                    className="win-small danger-outline"
                    onClick={() => removeRow(index)}
                  >
                    删除
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="subject-actions">
          <Button onClick={addRow}>新增科目</Button>
        </div>
      </div>
    </>
  );
}
