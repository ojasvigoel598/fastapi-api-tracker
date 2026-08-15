import { createContext, useContext } from "react";

export type AuthActions = {
  clerkSignOut?: () => Promise<void>;
};

export const AuthActionsContext = createContext<AuthActions>({});

export function useAuthActions(): AuthActions {
  return useContext(AuthActionsContext);
}
