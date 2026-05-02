import type { ReactNode } from "react";
import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "JJ&PP Ingenieros | Gestión de obras" },
        { name: "description", content: "Sistema web para gestionar metrados, valorizaciones mensuales y liquidación de obras de ingeniería civil." },
        { property: "og:title", content: "JJ&PP Ingenieros | Gestión de obras" },
        { property: "og:description", content: "Sistema web para gestionar metrados, valorizaciones mensuales y liquidación de obras de ingeniería civil." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "JJ&PP Ingenieros | Gestión de obras" },
      { name: "twitter:description", content: "Sistema web para gestionar metrados, valorizaciones mensuales y liquidación de obras de ingeniería civil." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/98a2bae0-7c37-4e13-909c-0e4b6a065c4e/id-preview-974a9278--a5e09af0-a889-4164-a80d-646ad51ffbf0.lovable.app-1777700698049.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/98a2bae0-7c37-4e13-909c-0e4b6a065c4e/id-preview-974a9278--a5e09af0-a889-4164-a80d-646ad51ffbf0.lovable.app-1777700698049.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
  return (
    <ThemeProvider>
      <AuthProvider>
        <Outlet />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </ThemeProvider>
  );
}
