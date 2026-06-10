import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { GoldFrame } from "@/components/gold-ui";
import { readSecrets, writeSecrets } from "@/lib/secrets.functions";

export const Route = createFileRoute("/admin/secrets")({
  component: () => (
    <AppShell>
      <SecretsPage />
    </AppShell>
  ),
});

function SecretsPage() {
  const read = useServerFn(readSecrets);
  const write = useServerFn(writeSecrets);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof readSecrets>> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const primaryKeys = ["TELEGRAM_BOT_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"] as const;

  useEffect(() => {
    read({ data: {} }).then(setInfo).catch((e) => toast.error(String(e)));
  }, [read]);

  if (!info) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <GoldFrame className="p-5 space-y-2">
        <h1 className="font-display text-2xl text-gradient-gold">App Secrets</h1>
        <p className="text-xs text-muted-foreground">
          Stored in <code>{info.path}</code>. Leave a field blank to keep the
          current value. Restart the Node process for changes to take effect.
        </p>
        <p className="text-[10px] text-amber-400">
          Public access enabled — anyone with this URL can edit these values.
        </p>
      </GoldFrame>

      <GoldFrame className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg text-gradient-gold">Start here</h2>
          <p className="text-xs text-muted-foreground">Enter these two blank values first, then press save.</p>
        </div>
        {primaryKeys.map((k) => {
          const meta = info.values[k];
          return (
            <label key={k} className="block">
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-sm text-gold-soft">{k}</span>
                <span className="text-[10px] text-muted-foreground">
                  {meta?.set ? `set · ${meta.preview}` : "blank"}
                </span>
              </div>
              <input
                type="text"
                autoComplete="off"
                placeholder={k === "TELEGRAM_BOT_TOKEN" ? "Paste Telegram bot token here" : "Paste service role key here"}
                value={values[k] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                className="mt-1 w-full rounded border border-gold-soft/40 bg-background/70 px-3 py-3 text-sm text-gold-soft"
              />
            </label>
          );
        })}

        <div className="border-t border-gold-soft/20 pt-4" />

        {info.keys.filter((k) => !primaryKeys.includes(k as (typeof primaryKeys)[number])).map((k) => {
          const meta = info.values[k];
          return (
            <label key={k} className="block">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm text-gold-soft">{k}</span>
                <span className="text-[10px] text-muted-foreground">
                  {meta?.set ? `set · ${meta.preview}` : "not set"}
                </span>
              </div>
              <input
                type="text"
                autoComplete="off"
                placeholder={meta?.set ? "•••••••• (unchanged)" : "Enter value"}
                value={values[k] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                className="mt-1 w-full rounded border border-gold-soft/40 bg-black/40 px-3 py-2 text-sm text-gold-soft"
              />
            </label>
          );
        })}

        <button
          disabled={saving}
          onClick={async () => {
            const updates: Record<string, string> = {};
            for (const [k, v] of Object.entries(values)) {
              if (v && v.length > 0) updates[k] = v;
            }
            if (Object.keys(updates).length === 0) {
              toast.message("Nothing to save");
              return;
            }
            setSaving(true);
            try {
              await write({ data: { updates } });
              toast.success("Saved — restart the app to apply.");
              setValues({});
              const fresh = await read({ data: {} });
              setInfo(fresh);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Save failed");
            } finally {
              setSaving(false);
            }
          }}
          className="w-full rounded bg-gradient-gold-flat px-4 py-3 font-display uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save secrets to .env"}
        </button>
      </GoldFrame>
    </div>
  );
}
