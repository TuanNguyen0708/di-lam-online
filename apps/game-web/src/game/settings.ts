import { useSyncExternalStore } from 'react';

export type SceneQuality = 'auto' | 'high' | 'medium' | 'low';
export type SceneCamera = 'overview' | 'follow';
/** `scale`: fixed 3D render scale from the URL (`&scale=1.5`), 1–3; `null` = the quality tier's default. */
export interface SceneSettings { sound: boolean; camera: SceneCamera; quality: SceneQuality; debug: boolean; scale: number | null }

const KEY = 'office-scene-settings';
const DEFAULTS: SceneSettings = { sound: false, camera: 'overview', quality: 'auto', debug: false, scale: null };
function parseScale(raw: string | null) {
  const value = Number(raw);
  return raw && Number.isFinite(value) ? Math.min(3, Math.max(1, value)) : null;
}
const listeners = new Set<() => void>();

/** URL params win (OBS links: ?view=stage&sound=1&cam=follow&quality=low&debug=1), then this tab's saved choice. */
function load(): SceneSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  let saved: Partial<SceneSettings> = {};
  try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<SceneSettings>; } catch { saved = {}; }
  const params = new URLSearchParams(window.location.search);
  const quality = params.get('quality'), camera = params.get('cam');
  return {
    sound: params.has('sound') ? params.get('sound') === '1' : saved.sound ?? DEFAULTS.sound,
    camera: camera === 'follow' || camera === 'overview' ? camera : saved.camera ?? DEFAULTS.camera,
    quality: quality === 'high' || quality === 'medium' || quality === 'low' || quality === 'auto' ? quality : saved.quality ?? DEFAULTS.quality,
    debug: params.get('debug') === '1' || (saved.debug ?? DEFAULTS.debug),
    scale: parseScale(params.get('scale')),
  };
}
let current = load();

export function getSceneSettings() { return current; }
export function updateSceneSettings(patch: Partial<SceneSettings>) {
  current = { ...current, ...patch };
  try { sessionStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
  listeners.forEach(listener => listener());
}
export function useSceneSettings() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getSceneSettings, () => DEFAULTS);
}
