import type {
  MusicTrack,
  NeteasePlaylist,
  OnlineSearchResults,
  OnlineSongInfo,
} from "./music-types.ts";
import type { MusicProvider } from "./music-platform.ts";
import { fetchOnline } from "./online-debug.ts";

export type ProviderErrorCode =
  | "unauthorized"
  | "expired"
  | "forbidden"
  | "rate_limited"
  | "risk_control"
  | "network"
  | "unsupported"
  | "invalid_response";

export class PlatformProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(
    message: string,
    code: ProviderErrorCode,
    status?: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "PlatformProviderError";
  }
}

export type LoginQrChallenge = {
  id: string;
  image: string;
  expiresAt: number;
  state: "waiting";
};

export type AccountSnapshot = {
  loggedIn: boolean;
  profile?: { nickname: string; userId?: string };
  warning?: string;
};

export interface PlatformProvider {
  readonly id: MusicProvider;
  loginQr(signal?: AbortSignal): Promise<LoginQrChallenge>;
  checkLogin(signal?: AbortSignal): Promise<AccountSnapshot>;
  refreshSession(signal?: AbortSignal): Promise<AccountSnapshot>;
  logout(signal?: AbortSignal): Promise<AccountSnapshot>;
  search(query: string, offset?: number, signal?: AbortSignal): Promise<OnlineSearchResults>;
  getUserPlaylists(offset?: number, signal?: AbortSignal): Promise<{ playlists: NeteasePlaylist[]; hasMore: boolean }>;
  getPlaylistTracks(playlistId: string, offset?: number, signal?: AbortSignal): Promise<{ tracks: (MusicTrack | null)[]; total: number }>;
  getLikedSongs(signal?: AbortSignal): Promise<MusicTrack[]>;
  setFavorite(trackId: string, favorite: boolean, signal?: AbortSignal): Promise<void>;
  getSongUrl(trackId: string, signal?: AbortSignal, options?: { sameOrigin?: boolean; attempt?: number }): Promise<{ audioUrl: string; duration?: number; trial?: { start: number; end: number }; bitrate?: number; format?: string }>;
  getLyrics(trackId: string, signal?: AbortSignal): Promise<OnlineSongInfo>;
  scrobble(trackId: string, position: number, signal?: AbortSignal): Promise<void>;
}

function providerError(status: number, message: string): PlatformProviderError {
  if (status === 401 || status === 301) return new PlatformProviderError(message, "unauthorized", status);
  if (status === 403) return new PlatformProviderError(message, "forbidden", status);
  if (status === 429) return new PlatformProviderError(message, "rate_limited", status);
  if (status === 460) return new PlatformProviderError(message, "risk_control", status);
  return new PlatformProviderError(message, "network", status);
}

/**
 * Browser-side adapter for the owned local service. Credentials never cross
 * this boundary; the service keeps the encrypted session in the main process.
 */
export class HttpNeteaseProvider implements PlatformProvider {
  readonly id = "netease" as const;

  private async request<T>(
    operation: string,
    url: string,
    options?: RequestInit,
    signal?: AbortSignal,
    attempt = 1,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchOnline(this.id, operation, url, {
        ...options,
        signal: signal ?? options?.signal,
      }, attempt);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new PlatformProviderError("无法连接网易云，请检查网络后重试。", "network");
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = body && typeof body.error === "string" ? body.error : "网易云请求失败，请稍后重试。";
      throw providerError(response.status, message);
    }
    return body as T;
  }

  private auth(action: "start" | "poll" | "cancel" | "logout", body?: object, signal?: AbortSignal) {
    return this.request<LoginQrChallenge | AccountSnapshot | { state: string }>(
      action,
      `/api/online/netease/auth/${action}`,
      body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : undefined,
      signal,
    );
  }

  loginQr(signal?: AbortSignal) {
    return this.auth("start", {}, signal) as Promise<LoginQrChallenge>;
  }

  checkLogin(signal?: AbortSignal) {
    return this.request<AccountSnapshot>("status", "/api/online/netease/auth/status", undefined, signal);
  }

  refreshSession(signal?: AbortSignal) {
    return this.checkLogin(signal);
  }

  logout(signal?: AbortSignal) {
    return this.auth("logout", {}, signal) as Promise<AccountSnapshot>;
  }

  cancelQr(id: string, signal?: AbortSignal) {
    return this.auth("cancel", { id }, signal);
  }

  pollQr(id: string, signal?: AbortSignal) {
    return this.auth("poll", { id }, signal) as Promise<
      { state: "waiting" | "scanned" | "expired" | "authorized" } & AccountSnapshot
    >;
  }

  search(query: string, offset = 0, signal?: AbortSignal) {
    return this.request<OnlineSearchResults>(
      "search",
      `/api/online/netease/search?q=${encodeURIComponent(query)}&offset=${offset}`,
      undefined,
      signal,
    );
  }

  getUserPlaylists(offset = 0, signal?: AbortSignal) {
    return this.request<{ playlists: NeteasePlaylist[]; hasMore: boolean }>(
      "playlists",
      `/api/online/netease/playlists?offset=${offset}`,
      undefined,
      signal,
    );
  }

  getPlaylistTracks(playlistId: string, offset = 0, signal?: AbortSignal) {
    if (!/^[1-9]\d{0,15}$/.test(playlistId)) {
      return Promise.reject(new PlatformProviderError("无效的网易云歌单 ID。", "invalid_response", 400));
    }
    return this.request<{ tracks: (MusicTrack | null)[]; total: number }>(
      "playlistTracks",
      `/api/online/netease/playlists/${playlistId}/tracks?offset=${offset}`,
      undefined,
      signal,
    );
  }

  getLikedSongs(signal?: AbortSignal) {
    return this.request<{ tracks: MusicTrack[] }>("likedSongs", "/api/online/netease/liked", undefined, signal).then(value => value.tracks);
  }

  setFavorite(trackId: string, favorite: boolean, signal?: AbortSignal) {
    if (!/^[1-9]\d{0,15}$/.test(trackId)) return Promise.reject(new PlatformProviderError("无效的网易云歌曲 ID。", "invalid_response", 400));
    return this.request<void>("favorite", "/api/online/netease/favorite", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, favorite }),
    }, signal).then(() => undefined);
  }

  getSongUrl(trackId: string, signal?: AbortSignal, options: { sameOrigin?: boolean; attempt?: number } = {}) {
    return this.request<{ audioUrl: string; duration?: number }>(
      "playback",
      `/api/online/netease/prepare/${encodeURIComponent(trackId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sameOrigin: options.sameOrigin === true }) },
      signal,
      options.attempt,
    );
  }

  getLyrics(trackId: string, signal?: AbortSignal) {
    return this.request<OnlineSongInfo>(
      "songInfo",
      `/api/online/netease/songs/${encodeURIComponent(trackId)}/info`,
      undefined,
      signal,
    );
  }

  scrobble(_trackId: string, _position: number, _signal?: AbortSignal) {
    return Promise.resolve();
  }
}

/** Default browser provider. Other providers can be added without changing UI callers. */
export const neteaseProvider = new HttpNeteaseProvider();

