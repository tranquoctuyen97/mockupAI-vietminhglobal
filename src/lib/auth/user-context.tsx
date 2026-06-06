"use client";

import { createContext, useContext } from "react";

interface AuthedUserContext {
  role: string;
}

const AuthedUserCtx = createContext<AuthedUserContext | null>(null);

export function AuthedUserProvider({
  role,
  children,
}: {
  role: string;
  children: React.ReactNode;
}) {
  return (
    <AuthedUserCtx.Provider value={{ role }}>
      {children}
    </AuthedUserCtx.Provider>
  );
}

/**
 * Returns the authenticated user's role from layout-injected context.
 * Eliminates the need for client-side /api/auth/me fetches.
 */
export function useAuthedUser(): AuthedUserContext | null {
  return useContext(AuthedUserCtx);
}
