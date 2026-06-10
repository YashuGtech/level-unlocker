/**
 * CSV export of every table — always fresh, always reflects DB state.
 * Returned as a single ZIP (base64) of one CSV per table. Admin-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdmin, logAdminAction } from "@/lib/auth-helpers.server";

const Input = z.object({ initData: z.string().min(1).max(16384) });

const TABLES = [
  "users",
  "admins",
  "settings",
  "announcements",
  "levels",
  "level_objects",
  "game_sessions",
  "deposits",
  "transactions",
  "referrals",
  "admin_logs",
] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s: string;
    if (typeof v === "object") s = JSON.stringify(v);
    else s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const out: string[] = [headers.join(",")];
  for (const r of rows) {
    out.push(headers.map((h) => esc(r[h])).join(","));
  }
  return out.join("\n");
}

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let from = 0;
  // Pull in pages of 1000 to bypass Supabase row limit.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Casting because supabaseAdmin.from is strictly typed against generated schema.
    const { data, error } = await (supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          range: (a: number, b: number) => Promise<{
            data: Record<string, unknown>[] | null;
            error: unknown;
          }>;
        };
      };
    })
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export const exportAllCsv = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);

    const zip = new JSZip();
    let totalRows = 0;
    const stats: Record<string, number> = {};

    for (const t of TABLES) {
      try {
        const rows = await fetchAllRows(t);
        stats[t] = rows.length;
        totalRows += rows.length;
        zip.file(`${t}.csv`, toCsv(rows));
      } catch (e) {
        zip.file(
          `${t}.csv`,
          `ERROR exporting ${t}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const summary = [
      "Generated: " + new Date().toISOString(),
      "Total rows: " + totalRows,
      "",
      ...Object.entries(stats).map(([t, n]) => `${t}: ${n}`),
    ].join("\n");
    zip.file("_summary.txt", summary);

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const base64 = Buffer.from(buf).toString("base64");

    await logAdminAction(admin.telegram_id, "export_csv_all", null, {
      totalRows,
      tables: Object.keys(stats).length,
    });

    return {
      filename: `gtech-all-tables-${Date.now()}.zip`,
      base64,
      size: buf.length,
      totalRows,
      tables: stats,
    };
  });

/** Single-table CSV (kept for convenience). */
const SingleInput = z.object({
  initData: z.string().min(1).max(16384),
  table: z.enum(TABLES),
});

export const exportTableCsv = createServerFn({ method: "POST" })
  .inputValidator((input) => SingleInput.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData);
    const rows = await fetchAllRows(data.table);
    const csv = toCsv(rows);
    await logAdminAction(admin.telegram_id, "export_csv_table", data.table, {
      rows: rows.length,
    });
    return {
      filename: `${data.table}-${Date.now()}.csv`,
      csv,
      rows: rows.length,
    };
  });
