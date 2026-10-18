import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, Switch } from '@fluentui/react-components';
import { ipcRenderer } from '../../common/electron.js';

// “天气设置”页（参考 ClassIsland 的天气页）：
// 天气预览 + 位置设置（选择城市 / 坐标定位 / 坐标显示 / 启动自动定位）
// + 外观与高级设置（图标包 / 排除的气象预警 / 不使用 TLS）。
// 城市与坐标保存在 settings.weather；组件与提醒共用这里的城市（组件自身的城市优先）。
export default function WeatherPage({ onStatus }) {
  const [settingsData, setSettingsData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCoords, setShowCoords] = useState(true);
  const [cityKeyword, setCityKeyword] = useState('');
  const [cityResults, setCityResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [alertsDraft, setAlertsDraft] = useState('');
  const [error, setError] = useState('');

  const loadSettings = useCallback(() => {
    ipcRenderer.invoke('weather-settings-get').then((data) => {
      setSettingsData(data || null);
      setAlertsDraft(Array.isArray(data?.excludedAlerts) ? data.excludedAlerts.join('\n') : '');
      setCityKeyword(data?.city || '');
    }).catch(() => setError('读取天气设置失败'));
  }, []);

  const loadPreview = useCallback(() => {
    setRefreshing(true);
    ipcRenderer.invoke('get-weather', '').then((data) => {
      setPreview(data || null);
      setRefreshing(false);
    }).catch(() => { setRefreshing(false); });
  }, []);

  useEffect(() => { loadSettings(); loadPreview(); }, [loadSettings, loadPreview]);

  const save = (patch, message) => {
    ipcRenderer.invoke('weather-settings-save', patch).then((result) => {
      if (result && result.ok) {
        setSettingsData(result.settings);
        onStatus?.(message || '天气设置已保存并生效');
        loadPreview();
      } else {
        setError('保存失败');
      }
    }).catch(() => setError('保存失败'));
  };

  const searchCity = () => {
    const keyword = cityKeyword.trim();
    if (!keyword) return;
    setSearching(true);
    setError('');
    ipcRenderer.invoke('weather-search-city', keyword).then((result) => {
      setSearching(false);
      if (result && result.error) { setError(result.error); return; }
      setCityResults(Array.isArray(result?.results) ? result.results : []);
      if (!result?.results?.length) setError('没有找到匹配的城市，试试更完整的名称');
    }).catch(() => { setSearching(false); setError('搜索失败'); });
  };

  const pickCity = (place) => {
    setCityResults([]);
    setCityKeyword(place.name);
    save({ city: place.name, city_name: place.name, latitude: place.latitude, longitude: place.longitude }, `已切换到 ${place.name}`);
  };

  const locateNow = () => {
    setError('');
    onStatus?.('正在定位…');
    ipcRenderer.invoke('weather-locate').then((result) => {
      if (!result || !result.ok) { setError((result && result.error) || '定位失败'); return; }
      setCityResults([]);
      loadSettings();
      loadPreview();
      onStatus?.(`定位成功${result.cityName ? '：' + result.cityName : ''}`);
    }).catch(() => setError('定位失败'));
  };

  const useAutoLocate = () => {
    setCityResults([]);
    setCityKeyword('');
    save({ city: '', city_name: '' }, '已改为自动定位（IP 定位）');
  };

  const iconTextOnly = settingsData?.iconPack === 'text';
  const cityLabel = settingsData?.city || settingsData?.cityName || '自动定位（按 IP）';
  const coordsLabel = settingsData && settingsData.latitude !== null && settingsData.longitude !== null
    ? (showCoords ? `${settingsData.latitude.toFixed(3)}, ${settingsData.longitude.toFixed(3)}` : '•••••, •••••')
    : '尚未获取坐标';

  const previewTemp = preview && !preview.error && preview.temp !== null ? `${preview.temp}°C` : '--°C';
  const previewText = preview && !preview.error ? (preview.text || '未知') : '天气不可用';
  const updatedText = preview && preview.updatedAt
    ? `更新于 ${new Date(preview.updatedAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`
    : '尚未更新';

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">天气</h1>
        <p className="page-intro">
          设置查询天气的位置与获取方式；主界面上的天气信息请在【组件设置】中配置天气组件，
          天气提醒请转到【提醒】页面。
        </p>
      </div>

      <div className="panel weather-preview">
        <div className="weather-preview-main">
          <div className="weather-preview-line">
            {!iconTextOnly && <span className="weather-preview-emoji">{preview?.emoji || '🌡️'}</span>}
            <span className="weather-preview-text">{previewText}</span>
            <span className="weather-preview-temp">{previewTemp}</span>
          </div>
          <div className="weather-preview-city">{preview?.city || cityLabel} · {updatedText}{preview?.stale ? '（离线缓存）' : ''}</div>
        </div>
        <div className="weather-preview-meta">
          <div><span>湿度</span><b>{preview?.humidity ?? '--'} %</b></div>
          <div><span>空气质量</span><b>{preview?.aqi ?? '--'}</b></div>
          <div><span>风力</span><b>{preview?.wind ?? '--'} km/h</b></div>
        </div>
        <Button
          className="win-icon"
          title="刷新天气"
          aria-label="刷新天气"
          disabled={refreshing}
          onClick={loadPreview}
        >
          ⟳
        </Button>
      </div>

      <div className="panel">
        <h3>位置设置</h3>
        <div className="weather-row">
          <div className="weather-row-text">
            <strong>天气位置</strong>
            <span>设置用于查询天气的位置信息及获取方式，当前：{cityLabel}</span>
          </div>
          <div className="weather-row-actions">
            <Input
              placeholder="输入城市名，如：北京 / Shanghai"
              value={cityKeyword}
              onChange={(event) => { setError(''); setCityKeyword(event.target.value); }}
              onKeyDown={(event) => { if (event.key === 'Enter') searchCity(); }}
            />
            <Button className="win-small" disabled={searching} onClick={searchCity}>选择城市</Button>
            <Button className="win-small" onClick={locateNow}>坐标定位</Button>
            {settingsData?.city ? (
              <Button className="win-small" onClick={useAutoLocate}>改为自动定位</Button>
            ) : null}
          </div>
        </div>
        {cityResults.length > 0 && (
          <div className="weather-city-results">
            {cityResults.map((place) => (
              <button
                type="button"
                key={`${place.name}-${place.latitude}-${place.longitude}`}
                className="weather-city-option"
                onClick={() => pickCity(place)}
              >
                <strong>{place.name}</strong>
                <span>{[place.admin1, place.country].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
        <div className="weather-row">
          <div className="weather-row-text">
            <strong>位置坐标</strong>
            <span>用于获取天气信息的经纬度：{coordsLabel}</span>
          </div>
          <div className="weather-row-actions">
            <Button className="win-small" onClick={() => setShowCoords((value) => !value)}>
              {showCoords ? '隐藏坐标' : '显示坐标'}
            </Button>
            <Button className="win-icon" title="重新定位" aria-label="重新定位" onClick={locateNow}>◎</Button>
          </div>
        </div>
        <div className="weather-row">
          <div className="weather-row-text">
            <strong>自动获取位置</strong>
            <span>启用后，将在应用每次启动时自动更新位置信息（未指定城市时生效）。</span>
          </div>
          <Switch
            checked={settingsData?.autoLocate !== false}
            aria-label="自动获取位置"
            onChange={(_event, data) => save({ auto_locate: data.checked === true }, data.checked ? '已开启启动自动定位' : '已关闭启动自动定位')}
          />
        </div>
      </div>

      <div className="panel">
        <h3>外观与高级设置</h3>
        <div className="weather-row">
          <div className="weather-row-text">
            <strong>天气图标包</strong>
            <span>调整显示天气类型时使用的图标外观：Emoji 图标或纯文本。</span>
          </div>
          <Select
            className="weather-row-select"
            value={settingsData?.iconPack === 'text' ? 'text' : 'emoji'}
            onChange={(event) => save({ icon_pack: event.target.value }, event.target.value === 'text' ? '已切换为纯文本' : '已切换为 Emoji 图标')}
          >
            <option value="emoji">Emoji 图标</option>
            <option value="text">纯文本</option>
          </Select>
        </div>
        <div className="weather-row weather-row-stack">
          <div className="weather-row-text">
            <strong>排除的气象预警</strong>
            <span>包含以下字符串的天气将不会发出“极端天气预警”，一行一个排除项。</span>
          </div>
          <textarea
            className="weather-exclude-input"
            placeholder={'例如：\n小雨\n雾'}
            value={alertsDraft}
            onChange={(event) => setAlertsDraft(event.target.value)}
            onBlur={() => save({
              excluded_alerts: alertsDraft.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            }, '排除的气象预警已保存')}
          />
        </div>
        <div className="weather-row">
          <div className="weather-row-text">
            <strong>不使用 TLS 协议获取天气</strong>
            <span>不建议启用。启用后，应用将通过不安全的 HTTP 协议获取定位信息（仅作为无法访问 HTTPS 时的兜底）。</span>
          </div>
          <Switch
            checked={settingsData?.allowInsecureHttp === true}
            aria-label="不使用 TLS 协议获取天气"
            onChange={(_event, data) => save({ allow_insecure_http: data.checked === true }, data.checked ? '已允许明文 HTTP 兜底' : '已恢复仅使用 TLS')}
          />
        </div>
      </div>

      <div className="ce-modal-error" aria-live="polite">{error}</div>
      <p className="field-help">
        要调整天气提醒（播报时间、极端天气预警、地震预警），请转到【提醒】页面；
        要在主界面显示天气，请在【组件设置】中添加并配置“天气”组件。
      </p>
    </>
  );
}