import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as apiClient from "./api";
import { api } from "./api";
import { registerPushToken } from "./push-registration";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  oauthSignIn: (
    provider: "google" | "apple",
    idToken: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  // Re-fetch the signed-in user after a profile edit (avatar, display name).
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the session on launch: if a refresh token exists, /me will
    // succeed (transparently refreshing the access token if needed).
    (async () => {
      try {
        if (await apiClient.hasSession()) {
          setUser(await api<User>("/me"));
          void registerPushToken();
        }
      } catch {
        await apiClient.clearTokens();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    setUser(await apiClient.login(email, password));
    void registerPushToken();
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    setUser(await apiClient.register(email, password, displayName));
    void registerPushToken();
  };

  const oauthSignIn = async (
    provider: "google" | "apple",
    idToken: string,
    displayName?: string,
  ) => {
    setUser(await apiClient.oauthLogin(provider, idToken, displayName));
    void registerPushToken();
  };

  const signOut = async () => {
    await apiClient.logout();
    setUser(null);
  };

  const refreshUser = async () => {
    setUser(await api<User>("/me"));
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, oauthSignIn, signOut, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
