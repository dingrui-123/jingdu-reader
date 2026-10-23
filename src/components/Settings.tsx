import type { Settings as ReaderSettings, Theme } from '../types';
import { Icon } from './Icon';
export function ReadingSettings({ settings, onChange }: { settings: ReaderSettings; onChange: (s: ReaderSettings) => void }) {
  const ranges = [
    ['fontSize', '字体大小', 14, 32, 1, 'px'], ['lineHeight', '行间距', 1.3, 2.6, .1, ''],
    ['paragraphGap', '段落间距', 0, 32, 2, 'px'], ['margin', '左右边距', 12, 48, 2, 'px'],
  ] as const;
  return <div className="reading-settings"><p className="eyebrow">阅读外观</p><div className="theme-options">{([['light', '明亮'], ['paper', '纸间'], ['dark', '夜读']] as [Theme, string][]).map(([theme, label]) => <button key={theme} className={`theme-choice ${theme} ${settings.theme === theme ? 'selected' : ''}`} onClick={() => onChange({ ...settings, theme })} aria-pressed={settings.theme === theme}><span>Aa</span><small>{label}</small>{settings.theme === theme && <Icon name="check" size={14}/>}</button>)}</div>
    {ranges.map(([key, label, min, max, step, unit]) => <label className="range-field" key={key}><span>{label}<output>{key === 'lineHeight' ? settings[key].toFixed(1) : settings[key]}{unit}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={settings[key]} onChange={e => onChange({ ...settings, [key]: Number(e.target.value) })}/></label>)}
    <div className="type-sample" style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>书页之间，自有天地。<br/>把片刻时光，留给一个好故事。</div>
  </div>;
}
