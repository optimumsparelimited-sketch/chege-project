import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { AuthUser } from '@workspace/api-client-react';

WebBrowser.maybeCompleteAuthSession();

export const AUTH_TOKEN_KEY = 'auth_session_token';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
});

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
        setUser(null);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      if (data.user) {
        setUser(data.user as AuthUser);
      } else {
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Handle cold-start deep link (app opened directly from mobile-budget:// URL)
  useEffect(() => {
    const handleUrl = async (url: string) => {
      const parsed = Linking.parse(url);
      if (parsed.hostname === 'auth' && parsed.queryParams?.token) {
        const token = parsed.queryParams.token as string;
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
        setIsLoading(true);
        await fetchUser();
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });
  }, [fetchUser]);

  const login = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      console.error('API base URL not configured');
      return;
    }

    // openAuthSessionAsync uses Chrome Custom Tabs on Android — it handles the
    // redirect back to the app internally so no "Open with…" disambiguation
    // dialog appears. The result URL is returned directly.
    const result = await WebBrowser.openAuthSessionAsync(
      `${apiBase}/api/mobile-login`,
      'mobile-budget://',
      { showInRecents: false },
    );

    if (result.type === 'success' && result.url) {
      const parsed = Linking.parse(result.url);
      if (parsed.hostname === 'auth' && parsed.queryParams?.token) {
        const token = parsed.queryParams.token as string;
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
        setIsLoading(true);
        await fetchUser();
      }
    }
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // swallow
    } finally {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
