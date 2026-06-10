/**
 * Full database backup — main admin only.
 * Dumps every public table as JSON inside a ZIP. Restorable by re-inserting
 * row-by-row with the service-role client.
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
  "admin_logs",
  "announcements",
  "deposits",
  "game_sessions",
  "levels",
  "level_objects",
  "referrals",
  "settings",
  "transactions",
] as const;

export const exportDatabaseBackup = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData, true);

    const zip = new JSZip();
    const summary: Record<string, number> = {};
    let totalRows = 0;

    for (const table of TABLES) {
      // Page through in 1000-row chunks (Supabase default cap).
      const all: unknown[] = [];
      let from = 0;
      const pageSize = 1000;
      // safety cap so a runaway table can't OOM the worker
      for (let page = 0; page < 200; page++) {
        const { data: rows, error } = await supabaseAdmin
          .from(table)
          .select("*")
          .range(from, from + pageSize - 1);
        if (error) break;
        if (!rows || rows.length === 0) break;
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      zip.file(`${table}.json`, JSON.stringify(all, null, 2));
      summary[table] = all.length;
      totalRows += all.length;
    }

    const meta = {
      generated_at: new Date().toISOString(),
      generated_by: admin.telegram_id,
      total_rows: totalRows,
      tables: summary,
      restore_note:
        "To restore: re-insert each <table>.json file row-by-row using the service-role client. Watch for foreign-key order: users → admins → deposits → game_sessions → transactions etc.",
    };
    zip.file("_manifest.json", JSON.stringify(meta, null, 2));

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const base64 = Buffer.from(buf).toString("base64");

    await logAdminAction(admin.telegram_id, "export_database_backup", null, {
      total_rows: totalRows,
      bytes: buf.length,
    });

    return {
      filename: `gtech-db-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      base64,
      size: buf.length,
      totalRows,
      tables: summary,
    };
  });
