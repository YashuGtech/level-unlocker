// Server-only Supabase secrets — committed intentionally as requested.
// The .server.ts suffix prevents Vite from bundling this into the client.
// WARNING: the service role key bypasses RLS. Replace with your own values
// in production; this file exists so the project runs without env setup.
export const PUBLIC_SUPABASE_URL = "https://litdumonvmcppvxpprte.supabase.co";
export const SERVER_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdGR1bW9udm1jcHB2eHBwcnRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTcxMzM2NCwiZXhwIjoyMDk1Mjg5MzY0fQ.PBmg4fHXzzmZ65ZvKOwA4hEI-xUHC1bY4r4U04_loks";
export const SERVER_TELEGRAM_BOT_TOKEN = "8989647034:AAGGyGXPXyhb89PZxjc-pbet3G2b3tUQEvs";
