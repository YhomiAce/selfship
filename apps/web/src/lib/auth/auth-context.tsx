'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UserDto } from '@selfship/shared';
import { ApiRequestError } from '@/lib/api-client';
import { authApi } from './auth-api';

/** Value exposed by {@link useAuth}. */
export interface AuthContextValue {
  /** Signed-in user, or null once loading finished without a session. */
  user: UserDto | null;
  /** True until the first `/auth/me` request completes. */
  isLoading: boolean;
  /** Re-fetches the user (e.g. after verifying the email). */
  refresh: () => Promise<void>;
  /** Signs out and goes to the login page. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Loads the signed-in user.
 *
 * @returns The user, or null when there is no valid session
 * @throws {ApiRequestError} For errors other than 401
 */
async function fetchCurrentUser(): Promise<UserDto | null> {
  try {
    return await authApi.me();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/**
 * Loads the signed-in user once and shares it with the dashboard tree.
 *
 * @param props.children - Components that need the current user
 */
export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [user, setUser] = useState<UserDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setUser(await fetchCurrentUser());
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await authApi.logout();
    // Full navigation (not a client-side route change) so no signed-in state
    // survives in memory, and the dashboard's own redirect doesn't race this one.
    window.location.replace('/login');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      // If the API is unreachable, treat the visitor as signed out; the login
      // page then shows a clear "server could not be reached" error.
      .catch(() => null)
      .then((current) => {
        if (cancelled) return;
        setUser(current);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, refresh, logout }),
    [user, isLoading, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Accesses the current user and auth actions.
 *
 * @returns Auth state and actions
 * @throws {Error} When used outside {@link AuthProvider}
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
