import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@workspace/api-client-react';

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

function getBasePath() {
  return import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base = getBasePath();
    // Use a dedicated close page so the popup auto-closes after auth completes.
    const returnTo = `${base}auth-done`.replace('//', '/');
    const url = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;

    // Open login in a popup so the OAuth redirect runs in a real top-level
    // window. This avoids the "missing initial state" / sessionStorage
    // partitioning error that occurs when the flow runs inside an iframe.
    const popup = window.open(url, 'auth-popup', 'width=520,height=640,left=200,top=100');
    if (!popup) {
      // Popup blocked — fall back to top-level navigation.
      (window.top ?? window).location.href = url;
      return;
    }

    // Listen for the auth-done page's postMessage.
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'auth_complete') {
        cleanup();
        window.location.reload();
      }
    };
    // Also poll in case postMessage is blocked (e.g. popup already closed).
    const interval = setInterval(() => {
      if (popup.closed) {
        cleanup();
        window.location.reload();
      }
    }, 500);

    function cleanup() {
      clearInterval(interval);
      window.removeEventListener('message', onMessage);
    }
    window.addEventListener('message', onMessage);
  }, []);

  const logout = useCallback(() => {
    const base = getBasePath();
    const url = `/api/logout?returnTo=${encodeURIComponent(base)}`;
    (window.top ?? window).location.href = url;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
