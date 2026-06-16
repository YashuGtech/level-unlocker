/**
 * App-wide session context. Bootstraps the user once and exposes
 * user/admin/settings/announcements to every route.
 *
 * Two auth sources:
 *   - Telegram WebApp initData (when launched from @GTCgames_bot).
 *   - Browser web session token stored in localStorage (set by /auth).
 *     Sent to server fns as the string `web:<token>` in place of initData.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTelegramWebApp } from "@/lib/telegram-webapp";
import { bootstrapUser } from "@/lib/auth.functions";
import { webLogout } from "@/lib/web-auth.functions";

const WEB_TOKEN_KEY = "gtech_web_token";

export function getWebToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WEB_TOKEN_KEY);
}
export function setWebToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(WEB_TOKEN_KEY, t);
  else window.localStorage.removeItem(WEB_TOKEN_KEY);
}

type SessionUser = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  is_premium: boolean | null;
  balance_gtc: number;
  banned: boolean;
};

type SessionData = {
  user: SessionUser | null;
  admin: { role: "main" | "secondary" } | null;
  settings: Record<string, string | number | boolean | null>;
  announcements: Array<{ id: string; title: string; body: string; created_at: string }>;
  lock: { message: string; url: string; scope: "user" | "broadcast" } | null;
};

type SessionCtx = SessionData & {
  initData: string | null;
  authMode: "telegram" | "web" | "none";
  loading: boolean;
  error: string | null;
  devMode: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Persist a freshly-issued web session token and immediately bootstrap with it. */
  signInWithWebToken: (token: string) => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

const SESSION_CACHE_KEY = "gtech_session_cache_v1";

function readCachedSession(): SessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}
function writeCachedSession(data: SessionData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* quota — ignore */
  }
}
function clearCachedSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_CACHE_KEY);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { initData: tgInitData, ready, devMode } = useTelegramWebApp();
  const [webToken, setWebTokenState] = useState<string | null>(null);
  const cached = typeof window !== "undefined" ? readCachedSession() : null;
  const [state, setState] = useState<SessionData>(
    cached ?? {
      user: null,
      admin: null,
      settings: {},
      announcements: [],
      lock: null,
    },
  );
  // If we already have a cached user, render the app immediately and refresh
  // in the background — this is the "ultra fast" login the user wants.
  const [loading, setLoading] = useState(cached?.user ? false : true);

  const [error, setError] = useState<string | null>(null);

  // Resolve the auth credential to send to bootstrapUser.
  const effectiveInitData: string | null = tgInitData
    ? tgInitData
    : webToken
      ? `web:${webToken}`
      : null;
  const authMode: "telegram" | "web" | "none" = tgInitData
    ? "telegram"
    : webToken
      ? "web"
      : "none";

  const load = async (id: string, opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await bootstrapUser({ data: { initData: id } });
      const next: SessionData = {
        user: (res.user as SessionUser | null) ?? state.user,
        admin: res.admin,
        settings: res.settings,
        announcements: res.announcements as SessionData["announcements"],
        lock: (res as { lock?: SessionData["lock"] }).lock ?? null,
      };
      setState(next);
      if (next.user) writeCachedSession(next);
    } catch (e) {
      if (!opts.silent) {
        const msg = e instanceof Error ? e.message : "Failed to authenticate";
        setError(msg);
        // Web session no longer valid → clear it so the auth screen shows.
        if (id.startsWith("web:") && /expired|invalid|not found/i.test(msg)) {
          setWebToken(null);
          setWebTokenState(null);
          clearCachedSession();
        }
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    setWebTokenState(getWebToken());
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (effectiveInitData) {
      // If we already hydrated from cache, refresh silently so the UI doesn't blank.
      void load(effectiveInitData, { silent: Boolean(cached?.user) });
    } else if (devMode) {
      // No Telegram session and no web token → show /auth.
      setLoading(false);
      clearCachedSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, effectiveInitData, devMode]);


  return (
    <Ctx.Provider
      value={{
        ...state,
        initData: effectiveInitData,
        authMode,
        loading,
        error,
        devMode,
        refresh: async () => {
          if (effectiveInitData) await load(effectiveInitData, { silent: true });
        },
        logout: async () => {
          const t = getWebToken();
          if (t) {
            try {
              await webLogout({ data: { token: t } });
            } catch {
              /* ignore */
            }
          }
          setWebToken(null);
          setWebTokenState(null);
          clearCachedSession();
          setState({ user: null, admin: null, settings: {}, announcements: [], lock: null });
        },
        signInWithWebToken: async (token: string) => {
          setWebToken(token);
          setWebTokenState(token);
          await load(`web:${token}`);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
