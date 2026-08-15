import type { ReactNode } from "react";
import {
  AuthActionsContext,
  type AuthActions,
} from "@/providers/auth-actions-context";

export function AuthActionsProvider({
  children,
  clerkSignOut,
}: AuthActions & { children: ReactNode }) {
  return (
    <AuthActionsContext.Provider value={{ clerkSignOut }}>
      {children}
    </AuthActionsContext.Provider>
  );
}
