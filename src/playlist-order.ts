import type { NeteasePlaylist } from './music-types';

const prefix = 'rhine-playlist-order:';
export function readPlaylistOrder(scope: string): string[] {
  if (!scope) return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + scope) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length < 128))].slice(0, 5100) : [];
  } catch { return []; }
}
export function savePlaylistOrder(scope: string, ids: string[]) {
  if (!scope) throw new Error('请先登录音乐账号。');
  // Let storage failures reach the dialog rather than claiming the order was saved.
  if (ids.length) localStorage.setItem(prefix + scope, JSON.stringify([...new Set(ids)].slice(0, 5100)));
  else localStorage.removeItem(prefix + scope);
}
export function orderedPlaylists(list: NeteasePlaylist[], ids: string[]) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
