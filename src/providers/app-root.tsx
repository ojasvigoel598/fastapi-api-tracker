import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useClerk,
} from "@clerk/clerk-react";
import { TRPCProvider } from "@/providers/trpc";
import { AuthActionsProvider } from "@/providers/auth-actions";
import { getSessionToken } from "@/lib/session-token";
import App from "@/App";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

function LocalApp() {
  return (
    <AuthActionsProvider>
      <TRPCProvider getToken={async () => getSessionToken()}>
        <App />
      </TRPCProvider>
    </AuthActionsProvider>
  );
}

function ClerkApp() {
  const { getToken } = useClerkAuth();
  const { signOut } = useClerk();

  return (
    <AuthActionsProvider clerkSignOut={signOut}>
      <TRPCProvider getToken={getToken}>
        <App />
      </TRPCProvider>
    </AuthActionsProvider>
  );
}

export default function AppRoot() {
  if (!clerkPublishableKey) return <LocalApp />;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ClerkApp />
    </ClerkProvider>
  );
}
