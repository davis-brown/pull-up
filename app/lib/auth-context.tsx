import { focusManager, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import * as apiClient from "./api";
import { api } from "./api";
import {
  deactivateGeofencing,
  refreshGeofences,
  setGeofencingUser,
} from "./geofencing";
import {
  cancelPushTokenAssociation,
  registerPushToken,
  setPushRegistrationUser,
} from "./push-registration";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<apiClient.RegistrationResult>;
  verifyEmail: (token: string) => Promise<void>;
  requestEmailVerification: (email: string) => Promise<void>;
  oauthSignIn: (
    provider: "google" | "apple",
    idToken: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  const operationRef = useRef(0);
  const servicesRef = useRef(0);
  const restorePendingRef = useRef(false);
  const mountedRef = useRef(true);

  const applyIdentity = useCallback((next: User | null) => {
    const previousId = userRef.current?.id ?? null;
    const nextId = next?.id ?? null;
    if (previousId !== nextId) {
      apiClient.cancelSessionRequests();
      // Queries can contain optional-auth personalization even when their key
      // looks public. Cancel first, then clear both query and mutation caches
      // so no account can inherit another account's results.
      void queryClient.cancelQueries().catch(() => {});
      queryClient.clear();
    }
    apiClient.setExpectedUserId(nextId);
    userRef.current = next;
    setUser(next);
  }, [queryClient]);

  const stopIdentityServices = useCallback((userId: string | null) => {
    servicesRef.current += 1;
    const pushToken = cancelPushTokenAssociation(userId);
    void deactivateGeofencing().catch(() => {});
    return pushToken;
  }, []);


  const startIdentityServices = useCallback((next: User) => {
    const services = ++servicesRef.current;
    setPushRegistrationUser(next.id);
    void registerPushToken();
    void setGeofencingUser(next.id)
      .then(() => {
        if (
          mountedRef.current &&
          servicesRef.current === services &&
          userRef.current?.id === next.id
        ) {
          return refreshGeofences();
        }
      })
      .catch(() => {});
  }, []);

  const restoreSession = useCallback(async (showLoading: boolean) => {
    const operation = ++operationRef.current;
    restorePendingRef.current = false;
    if (showLoading) setLoading(true);
    try {
      if (!(await apiClient.hasSession())) {
        if (operation !== operationRef.current || !mountedRef.current) return;
        applyIdentity(null);
        stopIdentityServices(null);
        return;
      }
      const restored = await api<User>("/me");
      if (operation !== operationRef.current || !mountedRef.current) return;
      applyIdentity(restored);
      startIdentityServices(restored);
    } catch (error) {
      if (
        operation === operationRef.current &&
        mountedRef.current &&
        !(error instanceof apiClient.SessionChangedError)
      ) {
        // Definitive refresh rejection invokes onSessionExpired below. Other
        // failures keep credentials and retry on the next foreground/online
        // event instead of converting a temporary outage into a logout.
        restorePendingRef.current = true;
      }
    } finally {
      if (operation === operationRef.current && mountedRef.current) {
        setLoading(false);
      }
    }
  }, [applyIdentity, startIdentityServices, stopIdentityServices]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = apiClient.onSessionExpired(() => {
      operationRef.current += 1;
      restorePendingRef.current = false;
      const previousId = userRef.current?.id ?? null;
      applyIdentity(null);
      stopIdentityServices(previousId);
      setLoading(false);
    });
    void restoreSession(true);
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      unsubscribe();
    };
  }, [applyIdentity, restoreSession, stopIdentityServices]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const onChange = (state: string) => {
      const focused = state === "active";
      focusManager.setFocused(focused);
      if (focused && restorePendingRef.current && !userRef.current) {
        void restoreSession(false);
      }
    };
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", onChange);
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, [restoreSession]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onOnline = () => {
      if (restorePendingRef.current && !userRef.current) {
        void restoreSession(false);
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [restoreSession]);

  const authenticate = async (request: () => Promise<User>) => {
    const operation = ++operationRef.current;
    restorePendingRef.current = false;
    const previousId = userRef.current?.id ?? null;
    const pushAssociation = await stopIdentityServices(previousId);
    applyIdentity(null);
    if (previousId) {
      await apiClient.logout({
        pushToken: pushAssociation?.token,
        onPushTokenRemoved: pushAssociation?.commit,
      });
      if (operation !== operationRef.current) throw new apiClient.SessionChangedError();
    }
    const next = await request();
    if (operation !== operationRef.current) throw new apiClient.SessionChangedError();
    applyIdentity(next);
    startIdentityServices(next);
  };

  const signIn = (email: string, password: string) =>
    authenticate(() => apiClient.login(email, password));

  const signUp = async (email: string, password: string, displayName: string) => {
    const operation = ++operationRef.current;
    restorePendingRef.current = false;
    const previousId = userRef.current?.id ?? null;
    const pushAssociation = await stopIdentityServices(previousId);
    applyIdentity(null);
    if (previousId) {
      await apiClient.logout({
        pushToken: pushAssociation?.token,
        onPushTokenRemoved: pushAssociation?.commit,
      });
      if (operation !== operationRef.current) throw new apiClient.SessionChangedError();
    }
    const result = await apiClient.register(email, password, displayName);
    if (operation !== operationRef.current) throw new apiClient.SessionChangedError();
    return result;
  };

  const verifyEmail = (token: string) =>
    authenticate(() => apiClient.verifyEmail(token));

  const requestEmailVerification = (email: string) =>
    apiClient.requestEmailVerification(email);

  const oauthSignIn = (
    provider: "google" | "apple",
    idToken: string,
    displayName?: string,
  ) => authenticate(() => apiClient.oauthLogin(provider, idToken, displayName));

  const signOut = async () => {
    operationRef.current += 1;
    restorePendingRef.current = false;
    const previousId = userRef.current?.id ?? null;
    const pushAssociation = await stopIdentityServices(previousId);
    // Local identity and all account data disappear before the first await.
    applyIdentity(null);
    await apiClient.logout({
      pushToken: pushAssociation?.token,
      onPushTokenRemoved: pushAssociation?.commit,
    });
  };

  const refreshUser = async () => {
    const operation = operationRef.current;
    const userId = userRef.current?.id;
    if (!userId) return;
    const refreshed = await api<User>("/me");
    if (
      operation === operationRef.current &&
      userRef.current?.id === userId
    ) {
      userRef.current = refreshed;
      setUser(refreshed);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        verifyEmail,
        requestEmailVerification,
        oauthSignIn,
        signOut,
        refreshUser,
      }}
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
