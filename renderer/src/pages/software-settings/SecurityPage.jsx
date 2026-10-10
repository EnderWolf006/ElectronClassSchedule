import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Switch } from '@fluentui/react-components';
import { ipcRenderer } from '../../common/electron.js';

// “安全设置”页：独立密码保护 + 逐模块保护开关。
// 密码不写入 settings.js：主进程用「加盐 scrypt 哈希 + safeStorage（Windows 下为
// DPAPI，绑定当前系统用户）整体加密」保存到用户数据目录下的密钥文件，
// 页面上会展示该文件路径——删除它即可重置为无密码状态。
export default function SecurityPage({ onStatus }) {
  const [status, setStatus] = useState(null);
  const [modules, setModules] = useState([]);
  const [moduleValues, setModuleValues] = useState({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    ipcRenderer.invoke('security-status')
      .then((result) => setStatus(result || null))
      .catch(() => setStatus(null));
    ipcRenderer.invoke('security-modules-get')
      .then((result) => {
        setModules(Array.isArray(result?.modules) ? result.modules : []);
        setModuleValues(result?.values || {});
      })
      .catch(() => { /* 读取失败时保持空列表 */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleModule = (moduleId, enabled) => {
    setModuleValues((values) => ({ ...values, [moduleId]: enabled }));
    ipcRenderer.invoke('security-modules-set', { module: moduleId, enabled })
      .then((result) => {
        if (result && result.ok) {
          setModuleValues(result.values || {});
          onStatus?.(enabled ? '该模块已启用密码保护' : '该模块已取消密码保护');
        } else {
          setError((result && result.error) || '保存失败');
          refresh();
        }
      })
      .catch(() => { setError('保存失败'); refresh(); });
  };

  const submit = (action) => {
    if (busy) return;
    setError('');
    if (action === 'set') {
      if (newPassword.length < 4) { setError('密码至少 4 位'); return; }
      if (newPassword !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    }
    if (status && status.enabled && !currentPassword) { setError('请输入当前密码'); return; }
    setBusy(true);
    const request = action === 'set'
      ? ipcRenderer.invoke('security-set-password', { currentPassword, password: newPassword })
      : ipcRenderer.invoke('security-remove-password', { currentPassword });
    request.then((result) => {
      setBusy(false);
      if (!result || !result.ok) {
        setError((result && result.error) || '操作失败');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      refresh();
      onStatus?.(action === 'set' ? '密码保护已启用（打开设置/编辑器与部分托盘开关需验证）' : '已关闭密码保护');
    }).catch((err) => {
      setBusy(false);
      setError(String((err && err.message) || err));
    });
  };

  const enabled = !!(status && status.enabled);
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">安全设置</h1>
        <p className="page-intro">
          为课表加一把锁：启用后可以逐项选择需要密码的操作——打开“软件设置 / 课表配置编辑器”，
          以及托盘菜单中的退出、重启、上课隐藏、窗口置顶、课上计时、显示次日课程。
        </p>
      </div>

      <div className="panel">
        <div className="theme-packs-toolbar">
          <h3>密码保护</h3>
          <span className={`security-badge${enabled ? ' on' : ''}`}>{enabled ? '已启用' : '未启用'}</span>
        </div>
        <p className="field-help">
          密码不会写入 scheduleConfig.js / settings.js，也不会以明文保存：
          主进程先做加盐哈希，再用系统级加密（Windows 的 DPAPI，绑定当前系统账户）
          写入用户数据目录下的密钥文件。删除该文件即可重置为无密码状态（忘记密码时的兜底）。
        </p>
        <div className="field">
          <label>密钥文件位置</label>
          <Input readOnly value={status?.file || '读取中…'} />
        </div>
        {status && status.encryptionAvailable === false && (
          <p className="field-help security-warning">当前系统不支持安全存储（safeStorage 不可用），无法启用密码保护。</p>
        )}
      </div>

      <div className="panel">
        <div className="theme-packs-toolbar">
          <h3>密码保护范围</h3>
          <span className="field-help">{enabled ? '逐项开关，立即生效' : '启用密码保护后可逐项设置'}</span>
        </div>
        {['page', 'tray'].map((group) => (
          <div className="security-module-group" key={group}>
            <div className="security-module-group-title">{group === 'page' ? '页面' : '托盘菜单控制项'}</div>
            {modules.filter((item) => item.group === group).map((item) => (
              <div className="security-module-row" key={item.id}>
                <span className="security-module-label">{item.label}</span>
                <Switch
                  checked={enabled && moduleValues[item.id] !== false}
                  disabled={!enabled}
                  aria-label={`密码保护：${item.label}`}
                  onChange={(_event, data) => toggleModule(item.id, data.checked === true)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>{enabled ? '修改 / 关闭密码' : '设置密码'}</h3>
        {enabled && (
          <div className="field">
            <label htmlFor="secCurrent">当前密码</label>
            <Input
              id="secCurrent"
              type="password"
              autoComplete="off"
              value={currentPassword}
              onChange={(event) => { setError(''); setCurrentPassword(event.target.value); }}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="secNew">{enabled ? '新密码' : '密码'}</label>
          <Input
            id="secNew"
            type="password"
            autoComplete="off"
            placeholder="至少 4 位"
            value={newPassword}
            onChange={(event) => { setError(''); setNewPassword(event.target.value); }}
          />
        </div>
        <div className="field">
          <label htmlFor="secConfirm">确认{enabled ? '新密码' : '密码'}</label>
          <Input
            id="secConfirm"
            type="password"
            autoComplete="off"
            value={confirmPassword}
            onChange={(event) => { setError(''); setConfirmPassword(event.target.value); }}
          />
        </div>
        <div className="ce-modal-error" aria-live="polite">{error}</div>
        <div className="row-actions">
          <Button
            className="win-primary"
            appearance="primary"
            disabled={busy || !status || status.encryptionAvailable === false}
            onClick={() => submit('set')}
          >
            {enabled ? '保存新密码' : '启用密码保护'}
          </Button>
          {enabled && (
            <Button
              className="danger-outline"
              disabled={busy}
              onClick={() => submit('remove')}
            >
              关闭密码保护
            </Button>
          )}
        </div>
      </div>
    </>
  );
}