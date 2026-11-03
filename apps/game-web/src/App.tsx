import { memo, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, BriefcaseBusiness, Building2, Camera, Check, ChevronRight, Clock, Coffee, Copy, Crown, ExternalLink, Flame, Gift, Heart, LockKeyhole, LogIn, MessageSquare, Mic, Monitor, Pause, Play, Radio, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Swords, Trophy, UserPlus, Users, Volume2, VolumeX } from 'lucide-react';
import { COMMANDS, DEFAULT_SETTINGS, DRAMA_LABELS, PHASE_LABELS, ROLES } from '@di-lam/shared';
import type { ActionResult, AdminCommand, GameState, Player, RoomSettings } from '@di-lam/shared';
import { AutomationPanel, CompanyPanel } from './AutomationPanel';
import { Office } from './game/Office';
import { useVoice } from './game/voice';
import { kpiPercent, spinePercent, topBosses, topSlaves, workClock } from './game/hud-metrics';
import { updateSceneSettings, useSceneSettings, type SceneQuality } from './game/settings';

export { workClock };

function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket = io({ transports: ['websocket'], reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('game:state', (snapshot: GameState) => setState(snapshot));
    return () => { socket.disconnect(); };
  }, []);
  return { state, connected };
}
function Panel({ title, icon, tag, children }: { title: string; icon: ReactNode; tag?: string; children: ReactNode }) {
  return <section className="panel"><header className="panel-head"><h2>{icon}{title}</h2>{tag && <span className="micro-tag">{tag}</span>}</header>{children}</section>;
}
/** Static command board: memoized so 5 Hz snapshots do not re-render 16 command tiles. Labels live in `title`. */
const StageCommands = memo(function StageCommands() {
  return <div className="stage-commands" role="list" aria-label="Tất cả lệnh comment">
    {Object.entries(COMMANDS).filter(([command]) => command !== 'vote').map(([command, { label }]) => <span className="stage-command" role="listitem" data-command={command} key={command} title={label}>{command}</span>)}
    <span className="stage-command stage-vote-command" role="listitem" data-command="vote" title={COMMANDS['vote'].label}>vote dinhcong<i> / </i>vote lamviec</span>
  </div>;
});
/** Big, phone-readable gauge for the top band. `value` null renders as a dash (nobody clocked in). */
function Meter({ label, value, kind, hint }: { label: string; value: number | null; kind: 'kpi' | 'spine' | 'drama'; hint?: string }) {
  const percent = value ?? 0;
  const level = kind === 'spine' ? (percent < 30 ? 'low' : percent < 60 ? 'mid' : 'ok') : percent >= 75 ? 'hot' : percent >= 50 ? 'warm' : 'ok';
  return <div className={`stage-meter ${kind}`} data-level={level} title={hint}>
    <div className="stage-meter-head"><span>{label}</span><strong>{value === null ? '—' : `${percent}%`}</strong></div>
    <div className="stage-meter-track"><i style={{ width: `${percent}%` }}/></div>
  </div>;
}
/** Top-3 card: label + #1's stat on one line, #1's name big, #2–#3 small underneath. */
function Board({ title, icon, players, value, empty, tone }: { title: string; icon: ReactNode; players: Player[]; value: (player: Player) => string; empty: string; tone: 'gold' | 'coral' }) {
  const [first, ...rest] = players;
  return <section className={`stage-board ${tone}`}>
    <header>{icon}<span>{title}</span>{first && <small>{value(first)}</small>}</header>
    {first ? <>
      <b className="stage-board-name" title={first.name}>{first.name}</b>
      <div className="stage-board-rest">{rest.map((player, index) => <span key={player.id}><em>{index + 2}</em><span title={player.name}>{player.name}</span></span>)}</div>
    </> : <div className="stage-board-empty">{empty}</div>}
  </section>;
}
export function Stage({ state, connected, voiceBlocked = false, onUnlockVoice }: { state: GameState | null; connected: boolean; voiceBlocked?: boolean; onUnlockVoice?: () => void }) {
  const hp = state?.bossHp ?? 10000;
  const votes = state?.votes ?? { strike: 0, work: 0 };
  const strikeWidth = votes.strike + votes.work ? votes.strike / (votes.strike + votes.work) * 100 : 50;
  const live = state?.live.status === 'connected';
  const clock = workClock(state);
  const players = state?.players ?? [];
  const dramaStage = state?.dramaStage ?? 0;
  return <div className="stage" aria-label="Sân khấu livestream 9:16">
    {voiceBlocked && <button className="stage-voice-unlock" onClick={onUnlockVoice}><Volume2/> Trình duyệt chặn tự phát tiếng · Bấm để bật giọng đọc</button>}
    {/* top band (25%): one dark surface, one card style, label-small / value-big everywhere */}
    <header className="stage-header hud-header">
      <div className="hud-brand">
        <div className="hud-logo" aria-hidden="true"><BriefcaseBusiness/></div>
        <div className="hud-title"><h2>ĐI LÀM <span>ONLINE</span></h2><span className="stage-company">{state?.settings?.companyName ?? DEFAULT_SETTINGS.companyName}</span></div>
        <div className="hud-chips">
          <span className="hud-chip"><small>NGÀY</small><b>{String(state?.day ?? 1).padStart(2, '0')}</b></span>
          <span className="hud-chip" title={PHASE_LABELS[state?.phase ?? 'work']}><Clock/><b>{clock.label}</b></span>
          <span className={`stage-live ${!connected ? 'disconnected' : live ? 'real-live' : ''}`}><i />{!connected ? 'MẤT KẾT NỐI' : live ? 'LIVE' : 'DEMO'}</span>
        </div>
      </div>
      <div className="hud-boss" title="Máu Sếp Tổng">
        <span className="hud-boss-label"><Swords/> SẾP</span>
        <div className="hud-boss-bar"><i style={{ width: `${hp / (state?.bossMaxHp ?? 10000) * 100}%` }}/><b>{hp.toLocaleString('vi-VN')} / {(state?.bossMaxHp ?? 10000).toLocaleString('vi-VN')} HP</b></div>
      </div>
    </header>
    <Office state={state}/>
    <div className="stage-room-meta hud-meters">
      <Meter label="KPI" kind="kpi" value={kpiPercent(state)} hint="Tiến độ ngày làm việc + combo cả phòng"/>
      <Meter label="CỘT SỐNG" kind="spine" value={spinePercent(players)} hint="Năng lượng trung bình của nhân viên đang có mặt"/>
      <Meter label="DRAMA" kind="drama" value={state?.dramaMeter ?? 0} hint={DRAMA_LABELS[dramaStage]}/>
    </div>
    <div className="drama-card" data-phase={state?.phase ?? 'work'}>
      <div className="hud-scene-head">
        <span className="hud-tag"><Flame/> {PHASE_LABELS[state?.phase ?? 'work']}</span>
        <h3 title={state?.scenario.detail}>{state?.scenario.title ?? 'CHÀO MỪNG ĐẾN CÔNG TY!'}</h3>
        <b className="hud-timer">{state?.remaining ?? 60}s</b>
      </div>
      {state?.phase === 'vote' && <div className="drama-voting"><span><b>{votes.strike}</b> ĐÌNH CÔNG</span><div className="vote-track"><i style={{ width: `${strikeWidth}%` }}/></div><span>LÀM TIẾP <b>{votes.work}</b></span></div>}
    </div>
    <div className="stage-boards">
      <Board tone="gold" title="TOP SẾP" icon={<Crown/>} players={topBosses(players)} value={player => ROLES[player.role] ?? ''} empty="Chưa ai lên chức"/>
      <Board tone="coral" title="TOP NÔ LỆ TƯ BẢN" icon={<BriefcaseBusiness/>} players={topSlaves(players)} value={player => `${player.salary.toLocaleString('vi-VN')} lương`} empty="Chưa ai cày cuốc"/>
    </div>
    <footer className="stage-footer hud-commands">
      <div className="hud-commands-head"><span>GÕ LỆNH ĐỂ CHƠI</span><span>Tiền ảo · không quy đổi</span></div>
      <StageCommands/>
    </footer>
  </div>;
}
export function App() {
  const { state, connected } = useGame();
  const params = new URLSearchParams(location.search);
  const stageOnly = params.get('view') === 'stage';
  // only the live stage page speaks (OBS / LIVE Studio source); `&voice=0` mutes an extra copy
  const voice = useVoice(state, stageOnly && params.get('voice') !== '0');
  const [token, setToken] = useState(() => stageOnly ? '' : sessionStorage.getItem('office-admin') ?? '');
  const [tokenDraft, setTokenDraft] = useState(token);
  const [username, setUsername] = useState('');
  const [playerName, setPlayerName] = useState('Mèo Mun');
  const [playerId, setPlayerId] = useState('demo-0');
  const [comment, setComment] = useState('damsep');
  const [notice, setNotice] = useState('Sẵn sàng. Thêm token từ .env để mở quyền điều khiển.');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoDemo, setAutoDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const sceneSettings = useSceneSettings();
  useEffect(() => { document.body.classList.toggle('stage-only', stageOnly); return () => document.body.classList.remove('stage-only'); }, [stageOnly]);
  const request = async (path: string, body: unknown): Promise<ActionResult> => {
    if (!token) throw new Error('Thêm ADMIN_TOKEN từ file .env trước nhé.');
    const response = await fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const result = await response.json() as ActionResult;
    if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : `HTTP ${response.status}`);
    return result;
  };
  const action = async (work: () => Promise<ActionResult>) => {
    setBusy(true);
    try { const result = await work(); setNotice(result.message); setError(!result.ok); return result; }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Không kết nối được server.'); setError(true); }
    finally { setBusy(false); }
  };
  const control = (command: AdminCommand) => action(() => request('command', { command }));
  const simulate = (text = comment, type = 'comment', count = 1) => action(() => request('simulate', { eventId: crypto.randomUUID(), type, user: { platformUserId: playerId, displayName: playerName }, payload: { text, count, ...(type === 'gift' ? { giftId: 'demo-confetti' } : {}) } }));
  useEffect(() => {
    if (!autoDemo || !token || stageOnly) return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      const index = Math.floor(Math.random() * 10);
      const choices = ['damsep', 'dapban', 'lamviec', 'cafe', 'bocphot', 'cuu', 'vote dinhcong', 'tat', 'nem', 'cai', 'ngu', 'nhay', 'tanghoa', 'trưa nay ăn gì?'];
      void request('simulate', { eventId: crypto.randomUUID(), type: 'comment', user: { platformUserId: `demo-${index}`, displayName: `Đồng nghiệp ${index + 1}` }, payload: { text: choices[Math.floor(Math.random() * choices.length)] } })
        .catch(failure => { setAutoDemo(false); setNotice(String(failure)); setError(true); }).finally(() => { pending = false; });
    }, 1400);
    return () => clearInterval(timer);
  }, [autoDemo, token, stageOnly]);
  const saveSettings = (patch: Partial<RoomSettings>) => action(() => request('settings', patch));
  const speak = (body: { text: string } | { sample: string }) => action(() => request('speak', body));
  if (stageOnly) return <Stage state={state} connected={connected} voiceBlocked={voice.blocked} onUnlockVoice={voice.unlock}/>;
  const disabled = busy || !token || !connected;
  const live = state?.live.status === 'connected';
  return <div className="dashboard">
    <header className="topbar"><a href="/" className="brand"><span className="brand-mark"><BriefcaseBusiness size={22}/></span><span>đi làm<span className="brand-online">online<span className="brand-dot">.</span></span></span><b>GAME MASTER</b></a><nav aria-label="Điều hướng"><a className="active" href="#office"><Monitor size={15}/> Phòng điều khiển</a><a href="#guide"><MessageSquare size={15}/> Sổ tay nhân viên</a></nav><div className="server-status"><i className={connected ? 'status-dot' : 'status-dot offline'}/>{connected ? 'Game server online' : 'Đang kết nối lại…'}<span className="avatar">GM</span></div></header>
    <main id="office"><div className="page-heading"><div><div className="eyebrow">VĂN PHÒNG CỦA BẠN / CA LÀM SỐ {String(state?.day ?? 1).padStart(3, '0')}</div><h1>Hôm nay, ai làm loạn?</h1><p>Sếp có thể khó tính. Nhưng nút điều khiển nằm trong tay bạn.</p></div><a className="button button-dark" href="/?view=stage" target="_blank" rel="noreferrer"><ExternalLink size={15}/> Mở sân khấu LIVE <ArrowUpRight size={15}/></a></div>
    <div className="stats-grid"><div className="stat mint"><span>NHÂN SỰ ĐANG CÓ MẶT <Users size={16}/></span><div><strong>{String(state?.employeeCount ?? 0).padStart(2, '0')}</strong><small>người chưa được tan ca</small></div><p><i className="status-dot"/> 12 bàn · tối đa 50 nhân viên cùng lúc</p></div><div className="stat peach"><span>ĐỘ BẤT ỔN CỦA VĂN PHÒNG <Flame size={16}/></span><div><strong>{state?.combo ?? 0}<em> combo</em></strong></div><p><ArrowUpRight size={13}/> Đập bàn hôm nay, kể chuyện ngày mai</p></div><div className="stat paper"><span>TÌNH TRẠNG SẾP TỔNG <Swords size={16}/></span><div><strong>{Math.round((state?.bossHp ?? 10000) / 100)}<em>% HP</em></strong></div><p>{state?.bossHp === 0 ? 'Sếp đang viết email xin lỗi cả phòng' : 'Vẫn nói “công ty là một gia đình”'}</p></div><div className="stat dark"><span>GIAI ĐOẠN HIỆN TẠI <Activity size={16}/></span><div><strong className="phase-stat">{PHASE_LABELS[state?.phase ?? 'work']}</strong><b>{String(state?.remaining ?? 60).padStart(2, '0')}s</b></div><p><i className="status-dot"/> {state?.paused ? 'Đang tạm nghỉ' : 'Vòng 5 phút · tự động tiếp diễn'}</p></div></div>
    <div className="workbench"><aside className="left-rail">
      <CompanyPanel settings={state?.settings} disabled={disabled} save={saveSettings} panel={children => <Panel title="Thông tin công ty" icon={<Building2 size={16}/>} tag={state?.settings?.companyName ?? undefined}>{children}</Panel>}/>
      <Panel title="Kết nối livestream" icon={<Radio size={17}/>} tag={live ? 'ĐÃ KẾT NỐI' : 'CHƯA LIVE'}><div className="panel-body"><div className="connection-label"><span className={`connection-orb ${live ? 'on' : ''}`}><Radio size={23}/></span><div><strong>{live ? `@${state.live.username}` : 'Đưa công ty lên TikTok'}</strong><p>{live ? 'Đang nhận sự kiện trực tiếp' : 'Comment thật. Drama cũng thật.'}</p></div></div><form onSubmit={event => { event.preventDefault(); void action(() => request('tiktok/connect', { username })); }}><label htmlFor="username">Tài khoản đang LIVE</label><div className="input-prefix"><span>@</span><input id="username" placeholder="ten_tiktok_cua_ban" value={username} onChange={event => setUsername(event.target.value)} maxLength={24} required/></div><button className="button button-dark full" disabled={disabled || !username || state?.live.status === 'connecting'}><Radio size={15}/>{state?.live.status === 'connecting' ? 'Đang kết nối…' : 'Kết nối TikTok LIVE'}<ChevronRight size={15}/></button></form>{live && <button className="text-button" disabled={busy} onClick={() => void action(() => request('tiktok/disconnect', {}))}>Ngắt kết nối</button>}<p className="fine-print">Adapter thử nghiệm giống repo Đi Chùa Online. Tài khoản cần đang LIVE; không yêu cầu mật khẩu TikTok.</p>{state?.live.error && <p className="inline-error">{state.live.error}</p>}</div></Panel>
      <Panel title="Bàn điều khiển" icon={<Settings2 size={17}/>}><div className="panel-body"><div className="controls-grid"><button disabled={disabled} onClick={() => void control(state?.paused ? 'resume' : 'pause')} className="control-tile">{state?.paused ? <Play/> : <Pause/>}<span>{state?.paused ? 'Tiếp tục' : 'Tạm nghỉ'}</span></button><button disabled={disabled} onClick={() => void control('drama')} className="control-tile coral"><Flame/><span>Tung drama</span></button></div><button disabled={disabled} className="button button-mint full demo-button" onClick={() => void action(async () => { const result = await request('command', { command: 'seed' }); if (result.ok) setAutoDemo(!autoDemo); return { ...result, message: autoDemo ? 'Đã tắt tự động demo.' : 'Demo 10 nhân viên đã bắt đầu. Không phải người xem thật.' }; })}>{autoDemo ? <Pause size={15}/> : <Play size={15}/>} {autoDemo ? 'Dừng auto demo' : 'Chạy demo 10 nhân viên'}<Sparkles size={15}/></button><div className="settings-row"><span>Tự động vòng drama</span><b className="pill">5 PHÚT</b></div><div className="settings-row"><span>Lưu tiến trình</span><b className={`pill ${state?.storage === 'memory' ? 'warning' : ''}`}>{state?.storage === 'postgres' ? 'POSTGRES' : 'BỘ NHỚ TẠM'}</b></div><div className="settings-row"><span>Âm thanh sân khấu</span><b className="pill">{sceneSettings.sound ? 'BẬT' : 'TẮT'}</b></div><button className="text-button danger" disabled={disabled} onClick={() => { if (confirm('Xóa toàn bộ nhân viên, XP và tiến trình trong phòng này? Không thể hoàn tác.')) { setAutoDemo(false); void control('reset'); } }}><RotateCcw size={12}/> Reset toàn bộ phiên</button></div></Panel>
      <AutomationPanel settings={state?.settings} disabled={disabled} save={saveSettings} speak={speak} panel={children => <Panel title="Trợ lý giọng nói & tự động" icon={<Mic size={16}/>} tag={state?.settings?.voice ? 'ĐANG ĐỌC' : 'TẮT GIỌNG'}>{children}</Panel>}/>
      <Panel title="Hiệu ứng sân khấu" icon={<Camera size={16}/>} tag="3D"><div className="panel-body scene-controls">
        <button className={`control-tile ${sceneSettings.sound ? 'on' : ''}`} onClick={() => updateSceneSettings({ sound: !sceneSettings.sound })}>{sceneSettings.sound ? <Volume2/> : <VolumeX/>}<span>{sceneSettings.sound ? 'Âm thanh: BẬT' : 'Âm thanh: TẮT'}</span></button>
        <button className={`control-tile ${sceneSettings.camera === 'follow' ? 'on' : ''}`} onClick={() => updateSceneSettings({ camera: sceneSettings.camera === 'follow' ? 'overview' : 'follow' })}><Camera/><span>{sceneSettings.camera === 'follow' ? 'Camera: theo dõi' : 'Camera: tổng quan'}</span></button>
        <label htmlFor="quality">Chất lượng đồ họa</label>
        <select id="quality" value={sceneSettings.quality} onChange={event => updateSceneSettings({ quality: event.target.value as SceneQuality })}><option value="auto">Tự động (giảm khi FPS thấp)</option><option value="high">Cao · bóng đổ mềm 2048</option><option value="medium">Trung bình</option><option value="low">Thấp · máy yếu</option></select>
        <label className="checkbox-row"><input type="checkbox" checked={sceneSettings.debug} onChange={event => updateSceneSettings({ debug: event.target.checked })}/> Hiện FPS / draw calls / bộ nhớ</label>
        <p className="fine-print">Âm thanh tổng hợp bằng Web Audio, chỉ phát ở tab này. Link OBS: thêm <code>&amp;sound=1</code>, <code>&amp;cam=follow</code>, <code>&amp;quality=low</code>.</p>
      </div></Panel>
      <Panel title="Quyền Game Master" icon={<LockKeyhole size={16}/>}><form className="panel-body" onSubmit={(event: FormEvent) => { event.preventDefault(); sessionStorage.setItem('office-admin', tokenDraft.trim()); setToken(tokenDraft.trim()); setNotice('Đã lưu token trong tab này. Thử chạy demo để kiểm tra quyền.'); setError(false); }}><label htmlFor="token">ADMIN_TOKEN trong file .env</label><input id="token" type="password" value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} placeholder="Dán token quản trị…" autoComplete="off" minLength={32} required/><button className="button button-outline full"><ShieldCheck size={14}/> {token ? 'Cập nhật token' : 'Mở quyền điều khiển'}</button><small className="fine-print">Token không đi vào link OBS. Chỉ lưu trong tab trình duyệt.</small></form></Panel>
    </aside>
    <section className="stage-column"><div className="stage-section-head"><div><span className="status-dot"/><strong>Sân khấu của công ty</strong></div><span>9:16 · 1080 × 1920</span></div><div className="stage-preview"><Stage state={state} connected={connected}/></div><div className="obs-link"><Monitor size={16}/><div><strong>Sẵn sàng cho OBS / LIVE Studio</strong><span>Browser Source · 1080 × 1920 · Không mở dashboard</span></div><button aria-label="Sao chép link sân khấu" title="Sao chép link sân khấu" onClick={() => { void navigator.clipboard.writeText(`${location.origin}/?view=stage`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { setNotice('Không sao chép được. Dùng nút Mở sân khấu LIVE.'); setError(true); }); }}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div></section>
    <aside className="right-rail"><Panel title="Phòng thử drama" icon={<MessageSquare size={17}/>} tag="SIMULATOR"><div className="panel-body"><p className="section-intro">Chưa LIVE? Tự mình làm một nhân viên bất ổn.</p><form onSubmit={event => { event.preventDefault(); void simulate(); }}><div className="form-row"><div><label htmlFor="player-name">Tên nhân viên</label><input id="player-name" value={playerName} onChange={event => setPlayerName(event.target.value)} required maxLength={24}/></div><div><label htmlFor="player-id">ID nhân viên</label><input id="player-id" value={playerId} onChange={event => setPlayerId(event.target.value)} required maxLength={100}/></div></div><label htmlFor="comment">Comment giả lập</label><div className="comment-input"><input id="comment" value={comment} onChange={event => setComment(event.target.value)} placeholder="damsep" maxLength={300} required/><button disabled={disabled} aria-label="Gửi comment giả lập"><Send size={16}/></button></div></form><div className="quick-commands">{[...Object.keys(COMMANDS).filter(command => command !== 'vote'), 'vote dinhcong', 'trưa nay ăn gì?'].map(text => <button key={text} disabled={disabled} onClick={() => { setComment(text); void simulate(text); }}>{text}</button>)}</div><div className="gift-sim"><button disabled={disabled} onClick={() => void simulate('', 'like', 500)}><Heart size={14}/> +500 tim</button><button disabled={disabled} onClick={() => void simulate('', 'follow')}><UserPlus size={14}/> Follow</button><button disabled={disabled} title="Giả lập người xem vừa vào LIVE (vào phòng ngay + được chào)" onClick={() => void simulate('', 'member')}><LogIn size={14}/> Vào phòng</button></div><div className="gift-sim"><button disabled={disabled} onClick={() => void simulate('', 'gift', 1)}><Gift size={14}/> Quà x1 · hoa</button><button disabled={disabled} onClick={() => void simulate('', 'gift', 10)}><Gift size={14}/> x10 · sinh nhật</button><button disabled={disabled} onClick={() => void simulate('', 'gift', 30)}><Gift size={14}/> x30 · báo cháy</button></div><p className="fine-print"><ShieldCheck size={12}/> Quà không cộng XP, không mua phiếu bầu.</p></div></Panel>
    <Panel title="Bảng vàng gây chuyện" icon={<Trophy size={17}/>} tag="TOP DRAMA"><div className="leaderboard">{state?.leaderboard.length ? state.leaderboard.map((player, index) => <div className="leader-row" key={player.id}><span className={`rank rank-${index}`}>{String(index + 1).padStart(2, '0')}</span><div><strong>{player.name}</strong><span>{ROLES[player.role]} · {player.xp} XP</span></div><b>{player.drama}<small>drama</small></b></div>) : <div className="empty-state"><Coffee size={25}/><strong>Công ty đang yên bình.</strong><span>Thêm nhân viên để bắt đầu câu chuyện.</span></div>}</div></Panel>
    <Panel title="Chuyện trong công ty" icon={<Activity size={17}/>} tag="REALTIME"><div className="activity-feed">{state?.feed.slice(0, 6).map(item => <div key={`${state.sessionId}-${item.id}`} className={`feed-item ${item.kind}`}><i/><p>{item.text}</p></div>) ?? <p className="fine-print">Đang đợi snapshot từ server…</p>}</div></Panel></aside></div>
    <div className={`notice ${error ? 'error' : ''}`} role="status" aria-live="polite">{error ? <Activity size={15}/> : <ShieldCheck size={15}/>}<span>{notice}</span><b>{connected ? 'SERVER AUTHORITATIVE' : 'RECONNECTING'}</b></div>
    <section className="employee-handbook" id="guide"><div><span className="eyebrow">SỔ TAY NHÂN VIÊN</span><h2>Đi làm không khó.<br/><span>Không gây chuyện mới khó.</span></h2><p>{Object.keys(COMMANDS).length} lệnh comment. Một văn phòng. Vô số chuyện để kể.</p></div><div className="handbook-commands">{Object.entries(COMMANDS).map(([command, rule]) => <div key={command}><code>{command}</code><span>{rule.label}</span><small>{rule.energy ? `${rule.energy} NL` : 'MIỄN PHÍ'}</small></div>)}</div></section>
    <footer className="footer"><span>ĐI LÀM ONLINE <b>© 2026</b></span><span>Mọi nhân vật đều đi làm tự nguyện. Ít nhất HR nói thế.</span><span>3D OFFICE / v0.2.0</span></footer></main>
  </div>;
}
