/**
 * Frontend ZIP export — main admin only.
 *
 * Workers have no real filesystem at runtime, so we embed the project source
 * with Vite's `import.meta.glob({ query: '?raw' })`. Every matched file is
 * inlined as a string into the server bundle at build time and can be zipped
 * deterministically at request time.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireAdmin, logAdminAction } from "@/lib/auth-helpers.server";

const Input = z.object({ initData: z.string().min(1).max(16384) });

// Eagerly load every source file as raw text. The `/**/*` patterns are
// resolved at build time by Vite/Rollup, so the worker bundle ships the
// full source tree (minus binaries / node_modules / dist).
const sourceModules = import.meta.glob(
  [
    "/src/**/*",
    "/public/**/*",
    "/supabase/**/*",
    "/package.json",
    "/bun.lock",
    "/bunfig.toml",
    "/vite.config.ts",
    "/tsconfig.json",
    "/components.json",
    "/eslint.config.js",
    "/wrangler.jsonc",
    "/.prettierrc",
    "/.prettierignore",
    "/.gitignore",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// Binary assets (images, fonts) — load as URL so we can fetch their bytes.
const binaryAssets = import.meta.glob(
  ["/src/assets/**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf}", "/public/**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf,mp3,wav}"],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

export const exportFrontendZip = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }) => {
    const { user: admin } = await requireAdmin(data.initData, true);

    const zip = new JSZip();
    let fileCount = 0;

    // Text files — embedded as strings at build time.
    for (const [absPath, contents] of Object.entries(sourceModules)) {
      const rel = absPath.replace(/^\//, "");
      // Skip if also handled as binary (avoid corrupting images that the raw
      // loader may have read as text).
      if (binaryAssets[absPath]) continue;
      zip.file(rel, contents);
      fileCount++;
    }

    // Binary assets — fetch from their bundled URL.
    await Promise.all(
      Object.entries(binaryAssets).map(async ([absPath, url]) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const buf = new Uint8Array(await r.arrayBuffer());
          const rel = absPath.replace(/^\//, "");
          zip.file(rel, buf);
          fileCount++;
        } catch {
          /* ignore individual asset failures */
        }
      }),
    );

    // Netlify SPA config.
    zip.file(
      "netlify.toml",
      `[build]
  command = "bun install && bun run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`,
    );
    zip.file("public/_redirects", "/*  /index.html  200\n");

    zip.file(
      "README_NETLIFY.md",
      `# GTech Fantasy — Frontend bundle

This zip contains the static frontend source. The backend (database, admins,
deposits) remains hosted on Lovable Cloud.

## Deploy to Netlify

1. Drag the **unzipped folder** onto https://app.netlify.com/drop, or
2. Push to a Git repo and connect it; Netlify will run \`bun install && bun run build\`.
3. Set the env vars in Netlify (Site settings → Build & deploy → Environment):
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_PUBLISHABLE_KEY
   - VITE_SUPABASE_PROJECT_ID
4. Open the site URL inside Telegram via \`@GTCgames_bot\`.

Generated: ${new Date().toISOString()}
Files: ${fileCount}
`,
    );

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const base64 = Buffer.from(buf).toString("base64");

    await logAdminAction(admin.telegram_id, "export_zip", null, {
      files: fileCount,
      bytes: buf.length,
    });

    return {
      filename: `gtech-fantasy-frontend-${Date.now()}.zip`,
      base64,
      size: buf.length,
    };
  });
