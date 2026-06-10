import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { SessionProvider } from "@/lib/session";
import { Toaster } from "sonner";

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-2xl text-gold-soft">Something broke</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-gradient-gold-flat px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="font-display text-6xl text-gradient-gold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#0a0a0a" },
      { title: "GTech Fantasy" },
      { name: "description", content: "Persistent Runner is an endless runner game where players avoid obstacles and collect rewards." },
      { property: "og:title", content: "GTech Fantasy" },
      { name: "twitter:title", content: "GTech Fantasy" },
      { property: "og:description", content: "Persistent Runner is an endless runner game where players avoid obstacles and collect rewards." },
      { name: "twitter:description", content: "Persistent Runner is an endless runner game where players avoid obstacles and collect rewards." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/23a8a93b-62e6-48b8-ba25-94f237c06eda/id-preview-438d5321--d9fc9c76-0d9c-4168-b668-a963afa614fc.lovable.app-1779288151725.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/23a8a93b-62e6-48b8-ba25-94f237c06eda/id-preview-438d5321--d9fc9c76-0d9c-4168-b668-a963afa614fc.lovable.app-1779288151725.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Outlet />
        <Toaster theme="dark" position="top-center" richColors />
      </SessionProvider>
    </QueryClientProvider>
  );
}
