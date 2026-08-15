import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import { useMemo, type ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

// Retry transient network failures (e.g. the backend briefly disappears during
// a sandbox recycle) with exponential backoff, without retrying forever.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
    },
  },
});
type TokenGetter = () => Promise<string | null>;

export function TRPCProvider({
  children,
  getToken,
}: {
  children: ReactNode;
  getToken?: TokenGetter;
}) {
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: "/api/trpc",
            transformer: superjson,
            async fetch(input, init) {
              // A half-configured or unavailable Clerk instance must never
              // break ordinary requests; fall back to the session cookie.
              let token: string | null = null;
              try {
                token = (await getToken?.()) ?? null;
              } catch {
                token = null;
              }
              const headers = new Headers(init?.headers);
              if (token) headers.set("Authorization", `Bearer ${token}`);
              return globalThis.fetch(input, {
                ...(init ?? {}),
                headers,
                credentials: "include",
              });
            },
          }),
        ],
      }),
    [getToken],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
