/**
 * Per-day revive + play tracker.
 * Resets at local 12:00 AM (midnight).
 *  - 2 free revives per day
 *  - Paid revive cost doubles: 100, 200, 400, 800, ...
 *  - 1 level played per day (a "play" = a win or a give-up; revives don't count)
 */

const KEY = "gtc.revive.v1";
const FREE_LIMIT = 2;
const BASE_PAID_COST = 200;

export type ReviveState = {
  date: string;
  freeUsed: number;
  paidUsed: number;
  playedToday: boolean;
};

// All "today" math is in Dubai time (UTC+4, no DST).
function dubaiNow(): Date {
  return new Date(Date.now() + 4 * 3600 * 1000);
}
function todayKey(): string {
  const d = dubaiNow();
  return d.toISOString().slice(0, 10);
}

function read(): ReviveState {
  if (typeof window === "undefined") {
    return { date: todayKey(), freeUsed: 0, paidUsed: 0, playedToday: false };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as ReviveState;
      if (v.date === todayKey()) return v;
    }
  } catch {
    /* noop */
  }
  const fresh: ReviveState = { date: todayKey(), freeUsed: 0, paidUsed: 0, playedToday: false };
  write(fresh);
  return fresh;
}

function write(state: ReviveState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

export function getReviveState(): ReviveState {
  return read();
}

export function freeRevivesLeft(): number {
  return Math.max(0, FREE_LIMIT - read().freeUsed);
}

/** Cost of the *next* paid revive. */
export function nextPaidCost(): number {
  const s = read();
  return BASE_PAID_COST * Math.pow(2, s.paidUsed);
}

export function consumeFreeRevive(): boolean {
  const s = read();
  if (s.freeUsed >= FREE_LIMIT) return false;
  s.freeUsed += 1;
  write(s);
  return true;
}

export function consumePaidRevive(): number {
  const s = read();
  const cost = BASE_PAID_COST * Math.pow(2, s.paidUsed);
  s.paidUsed += 1;
  write(s);
  return cost;
}

export function canPlayToday(): boolean {
  return !read().playedToday;
}

export function markPlayed() {
  const s = read();
  s.playedToday = true;
  write(s);
}

export function msUntilReset(): number {
  // Next 00:00 in Dubai (UTC+4): compute in shifted clock, then convert back.
  const shifted = dubaiNow();
  const next = new Date(shifted);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - shifted.getTime();
}

export function formatTimeUntilReset(): string {
  const ms = msUntilReset();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
