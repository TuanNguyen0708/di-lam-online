import { useEffect, useState, type ReactNode } from 'react';
import { Megaphone, Mic, Save, Volume2 } from 'lucide-react';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@di-lam/shared';
import type { RoomSettings } from '@di-lam/shared';

type Toggle = 'npcs' | 'voice' | 'greetJoiners' | 'thankGifts' | 'thankFollows';
const TOGGLES: { key: Toggle; label: string; hint: string }[] = [
  { key: 'npcs', label: 'Nhân viên ảo (NPC)', hint: '5 đồng nghiệp ảo giữ văn phòng sống động. Sếp và Trưởng phòng luôn có mặt.' },
  { key: 'voice', label: 'Tự đọc trên sân khấu', hint: 'Giọng đọc phát ở trang sân khấu (OBS / LIVE Studio), không phát ở tab này.' },
  { key: 'greetJoiners', label: 'Chào người mới', hint: 'Mỗi người được chào một lần mỗi phiên, gộp tối đa 3 tên mỗi câu.' },
  { key: 'thankGifts', label: 'Cảm ơn quà', hint: 'Đọc ngay sau câu đang phát; mỗi người tối đa 1 lần / 30 giây.' },
  { key: 'thankFollows', label: 'Cảm ơn follow', hint: 'Mỗi người một lần mỗi phiên.' },
];
/** Toggles that only matter while the voice is on. */
const VOICE_TOGGLES: ReadonlySet<Toggle> = new Set(['greetJoiners', 'thankGifts', 'thankFollows']);
const SHARE_OPTIONS = [0, 5, 10, 15, 30] as const;
const SAMPLES: { sample: 'greet' | 'gift' | 'follow' | 'share'; label: string }[] = [
  { sample: 'greet', label: 'Chào' }, { sample: 'gift', label: 'Cảm ơn quà' }, { sample: 'follow', label: 'Cảm ơn follow' }, { sample: 'share', label: 'Nhắc chia sẻ' },
];

/**
 * Company name: shown in the stage header and in every spoken line ({company} in the greeting).
 * Server-validated (max 40 characters, no links or markup).
 */
export function CompanyPanel({ settings, disabled, save, panel }: {
  settings: RoomSettings | undefined;
  disabled: boolean;
  save: (patch: Partial<RoomSettings>) => Promise<unknown>;
  panel: (children: ReactNode) => ReactNode;
}) {
  const saved = (settings ?? DEFAULT_SETTINGS).companyName;
  const [company, setCompany] = useState(saved);
  useEffect(() => setCompany(saved), [saved]);
  const changed = company.trim() !== '' && company.trim() !== saved;
  return panel(<form className="panel-body automation" onSubmit={event => { event.preventDefault(); if (changed) void save({ companyName: company }); }}>
    <label htmlFor="company-name">Tên công ty</label>
    <div className="inline-save">
      <input id="company-name" value={company} maxLength={SETTINGS_LIMITS.companyName} disabled={disabled} placeholder={DEFAULT_SETTINGS.companyName} onChange={event => setCompany(event.target.value)}/>
      <button className="button button-dark" disabled={disabled || !changed} aria-label="Lưu tên công ty"><Save size={14}/> Lưu</button>
    </div>
    <small className="fine-print">Hiện trên đầu sân khấu và trong lời chào ({'{company}'}). Mặc định: {DEFAULT_SETTINGS.companyName}. Tối đa {SETTINGS_LIMITS.companyName} ký tự.</small>
  </form>);
}

/**
 * Operator settings for automation and the stage voice (modelled on di-chua-online's control deck).
 * The server owns and validates every value; this panel only edits drafts and sends patches.
 */
export function AutomationPanel({ settings, disabled, save, speak, panel }: {
  settings: RoomSettings | undefined;
  disabled: boolean;
  save: (patch: Partial<RoomSettings>) => Promise<unknown>;
  speak: (body: { text: string } | { sample: string }) => Promise<unknown>;
  panel: (children: ReactNode) => ReactNode;
}) {
  const current = settings ?? DEFAULT_SETTINGS;
  const [template, setTemplate] = useState(current.greetTemplate);
  const [line, setLine] = useState('');
  // the draft follows the server value whenever it changes (e.g. saved from another tab)
  useEffect(() => setTemplate(current.greetTemplate), [current.greetTemplate]);
  const voiceOff = disabled || !current.voice;
  return panel(<div className="panel-body automation">
    <div className="toggle-list first">
      {TOGGLES.map(({ key, label, hint }) => <label key={key} className="checkbox-row" title={hint}>
        <input type="checkbox" checked={current[key]} disabled={disabled || (VOICE_TOGGLES.has(key) && !current.voice)} onChange={event => void save({ [key]: event.target.checked })}/>
        <span><b>{label}</b><small>{hint}</small></span>
      </label>)}
    </div>
    <div className="form-row">
      <div><label htmlFor="voice-gender">Giọng</label>
        <select id="voice-gender" value={current.voiceGender} disabled={voiceOff} onChange={event => void save({ voiceGender: event.target.value as RoomSettings['voiceGender'] })}>
          <option value="female">Nữ · Hoài My</option><option value="male">Nam · Nam Minh</option>
        </select></div>
      <div><label htmlFor="share-every">Nhắc chia sẻ</label>
        <select id="share-every" value={current.shareReminderMinutes} disabled={voiceOff} onChange={event => void save({ shareReminderMinutes: Number(event.target.value) })}>
          {SHARE_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{minutes ? `Mỗi ${minutes} phút` : 'Tắt'}</option>)}
        </select></div>
    </div>
    <label htmlFor="voice-rate">Tốc độ đọc · <b>{current.voiceRate.toFixed(2)}x</b></label>
    <input id="voice-rate" type="range" min={SETTINGS_LIMITS.voiceRate[0]} max={SETTINGS_LIMITS.voiceRate[1]} step={0.05} value={current.voiceRate} disabled={voiceOff} onChange={event => void save({ voiceRate: Number(event.target.value) })}/>
    <label htmlFor="greet-template">Mẫu câu chào <small>({'{names}'} = tên người mới, {'{company}'} = tên công ty)</small></label>
    <textarea id="greet-template" rows={2} value={template} maxLength={SETTINGS_LIMITS.greetTemplate} disabled={voiceOff} onChange={event => setTemplate(event.target.value)}/>
    <button className="button button-outline full" disabled={voiceOff || template.trim() === current.greetTemplate || !template.includes('{names}')} onClick={() => void save({ greetTemplate: template })}><Save size={14}/> Lưu mẫu câu chào</button>
    <label htmlFor="speak-now">Đọc ngay trên sân khấu</label>
    <div className="inline-save">
      <input id="speak-now" value={line} maxLength={SETTINGS_LIMITS.speech} placeholder="Cảm ơn cả phòng đã ghé xem live tối nay!" disabled={voiceOff} onChange={event => setLine(event.target.value)}/>
      <button className="button button-dark" disabled={voiceOff || !line.trim()} onClick={() => void speak({ text: line }).then(() => setLine(''))} aria-label="Đọc ngay"><Mic size={14}/></button>
    </div>
    <div className="sample-row"><span><Volume2 size={13}/> Nghe thử</span>{SAMPLES.map(({ sample, label }) => <button key={sample} disabled={voiceOff} onClick={() => void speak({ sample })}>{label}</button>)}</div>
    <p className="fine-print"><Megaphone size={12}/> Giọng Edge TTS cần internet: câu đọc (gồm tên người xem) được gửi tới dịch vụ đọc của Microsoft, dự phòng Google. Chỉ trang sân khấu phát tiếng; thêm <code>&amp;voice=0</code> vào link để tắt ở một nguồn.</p>
  </div>);
}
