/**
 * Telegram WebApp SDK bridge — client-only.
 * Loads the WebApp script and exposes initData + user info.
 */
import { useEffect, useState } from "react";

const TELEGRAM_SCRIPT_ID = "tg-webapp-script";
const TELEGRAM_INIT_TIMEOUT_MS = 3_000;

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: { id: number; username?: string; first_name?: string };
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (c: string) => void;
        setBackgroundColor?: (c: string) => void;
        HapticFeedback?: {
          impactOccurred: (s: "light" | "medium" | "heavy") => void;
          notificationOccurred: (s: "error" | "success" | "warning") => void;
        };
        showAlert?: (msg: string) => void;
      };
    };
  }
}

export function useTelegramWebApp() {
  const [initData, setInitData] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: number | undefined;

    const finishOutsideTelegram = () => {
      if (cancelled) return;
      setDevMode(true);
      setReady(true);
    };

    const attach = () => {
      const tg = window.Telegram?.WebApp;
      if (!tg) return false;

      try {
        tg.ready();
        tg.expand();
        tg.setBackgroundColor?.("#0a0a0a");
        tg.setHeaderColor?.("#0a0a0a");
      } catch {
        /* Telegram bridge can throw in non-Telegram browsers */
      }

      if (!tg.initData) return false;

      if (!cancelled) {
        setInitData(tg.initData);
        setDevMode(false);
        setReady(true);
      }
      return true;
    };

    const scheduleFallback = () => {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        if (!attach()) finishOutsideTelegram();
      }, TELEGRAM_INIT_TIMEOUT_MS);
    };

    const onTelegramEvent = () => {
      if (attach()) window.clearTimeout(fallbackTimer);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      const eventType =
        typeof data === "string"
          ? safeJsonParse(data)?.eventType
          : typeof data === "object" && data !== null && "eventType" in data
            ? String((data as { eventType?: unknown }).eventType ?? "")
            : "";

      if (eventType?.startsWith("web_app_") || event.origin === "https://web.telegram.org") {
        onTelegramEvent();
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("TelegramWebviewProxy_postEvent", onTelegramEvent as EventListener);
    window.addEventListener("resize", onTelegramEvent);

    if (attach()) {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("TelegramWebviewProxy_postEvent", onTelegramEvent as EventListener);
      window.removeEventListener("resize", onTelegramEvent);
      return;
    }

    const existing = document.getElementById(TELEGRAM_SCRIPT_ID) as HTMLScriptElement | null;
    if (!existing) {
      const s = document.createElement("script");
      s.id = TELEGRAM_SCRIPT_ID;
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.async = true;
      s.onload = () => {
        s.dataset.loaded = "true";
        if (!attach()) scheduleFallback();
      };
      s.onerror = () => {
        finishOutsideTelegram();
      };
      document.head.appendChild(s);
      scheduleFallback();
    } else if (existing.dataset.loaded === "true") {
      if (!attach()) scheduleFallback();
    } else {
      existing.addEventListener("load", onTelegramEvent, { once: true });
      scheduleFallback();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("TelegramWebviewProxy_postEvent", onTelegramEvent as EventListener);
      window.removeEventListener("resize", onTelegramEvent);
    };
  }, []);

  return { initData, ready, devMode };
}

function safeJsonParse(value: string): { eventType?: string } | null {
  try {
    return JSON.parse(value) as { eventType?: string };
  } catch {
    return null;
  }
}

export function hapticTap(kind: "light" | "medium" | "heavy" = "light") {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* noop */
  }
}

export function hapticNotify(kind: "success" | "error" | "warning") {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(kind);
  } catch {
    /* noop */
  }
}
