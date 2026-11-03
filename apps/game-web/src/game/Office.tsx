import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@di-lam/shared';
import { NPC_ROSTER } from './npc-roster';
import { useSceneSettings } from './settings';
import type { Announcement } from './engine3d/director';
import type { OfficeScene, SceneStats } from './OfficeScene';

type Toast = Announcement & { id: number };
let toastSequence = 0;
/** Toast slots on screen; the scene already rate-limits announcements, so this never grows. */
const TOAST_SLOTS = 3;

/**
 * The 3D office (exactly 75% of the stage). Critical HUD lives in the stage's top band (App.tsx);
 * overlays here stay in the canvas' upper part and away from the right edge (TikTok safe zone).
 */
export function Office({ state }: { state: GameState | null }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const settings = useSceneSettings();
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState<SceneStats | null>(null);
  // everyone in the snapshot is on stage at once (no floors / 12-per-page rotation)
  const players = state?.players ?? [];
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    let disposed = false;
    let office: OfficeScene | undefined;
    void import('./OfficeScene').then(({ OfficeScene }) => {
      if (disposed || !host.current) return;
      office = new OfficeScene(host.current, {
        onStatus: status => { if (!disposed) setRenderStatus(status); },
        onAnnounce: item => { if (!disposed) setToasts(current => [{ ...item, id: ++toastSequence }, ...current].slice(0, TOAST_SLOTS)); },
        onStats: next => { if (!disposed) setStats(next); },
      });
      scene.current = office;
      const snapshot = latest.current;
      if (snapshot) office.sync(snapshot, snapshot.players);
    }).catch(error => {
      if (!disposed) { console.error('Office 3D failed to initialize', error); setRenderStatus('error'); }
    });
    return () => { disposed = true; scene.current = null; office?.dispose(); };
  }, []);
  useEffect(() => { if (state) scene.current?.sync(state, state.players); }, [state]);
  useEffect(() => { scene.current?.setQuality(settings.quality); }, [settings.quality, renderStatus]);
  useEffect(() => { scene.current?.setCameraMode(settings.camera); }, [settings.camera, renderStatus]);
  useEffect(() => { void scene.current?.setSound(settings.sound); }, [settings.sound, renderStatus]);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => setToasts(current => current.slice(0, -1)), 3200);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const meter = state?.dramaMeter ?? 0, stage = state?.dramaStage ?? 0;
  const total = state?.employeeCount ?? 0;
  return <div className={`office-canvas drama-stage-${stage}`} role="img" aria-label={`Văn phòng 3D với ${total} nhân viên. Mức drama ${meter}%. Sếp còn ${state?.bossHp ?? 10000} HP.`}>
    <div ref={host} className="office-renderer" aria-hidden="true"/>
    <div className="office-floor-tag"><b>VĂN PHÒNG</b><span title="Nhân viên thật (người xem) đang có mặt">{players.length < total ? `${players.length}/${total}` : total} NV</span>{state?.settings?.npcs !== false && <span className="npc-count" title="Nhân viên ảo do game tạo, không phải người xem">+{NPC_ROSTER.length} NPC</span>}{state?.bossHp === 0 && <em>SẾP ĐÃ GỤC!</em>}</div>
    <div className="office-toasts" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`office-toast ${toast.tone}`}>{toast.text}</div>)}</div>
    {!players.length && <div className="office-empty"><b>BÀN TRỐNG, DRAMA KHÔNG TRỐNG.</b><span>Vào live là vào phòng ngay · gõ lệnh để quậy</span></div>}
    {settings.debug && stats && <div className="office-stats">{stats.fps} FPS · {stats.tier.toUpperCase()} · {stats.drawCalls} draw · {(stats.triangles / 1000).toFixed(0)}k tri · {stats.geometries} geo · {stats.textures} tex · {stats.particles} fx · {stats.pops} pop · {stats.actors} NV</div>}
    {state?.paused && <div className="office-paused">CÔNG TY ĐANG TẠM NGHỈ</div>}
    {renderStatus !== 'ready' && <div className="office-render-status" role="status"><b>{renderStatus === 'loading' ? 'ĐANG DỰNG VĂN PHÒNG 3D…' : 'KHÔNG THỂ HIỂN THỊ 3D'}</b><span>{renderStatus === 'loading' ? 'Đang tải nội thất và nhân viên' : 'Bật tăng tốc đồ họa / WebGL trong trình duyệt rồi tải lại.'}</span></div>}
  </div>;
}
