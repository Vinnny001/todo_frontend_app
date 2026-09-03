import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";
import * as authApi from "./api";
import type { User } from "./api";
import { AuthContext } from "./context";

const LS_TOKEN = "auth_token";
const LS_USER = "auth_user";

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — session simply won't persist across restarts
  }
}
function clearLS(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function setAuthHeader(token: string | null) {
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

// Read synchronously so the very first render already has the right
// axios Authorization header set — avoids a flash of unauthenticated UI.
const initialToken = loadLS<string | null>(LS_TOKEN, null);
const initialUser = loadLS<User | null>(LS_USER, null);
setAuthHeader(initialToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUserState] = useState<User | null>(initialUser);
  // Reading localStorage above is synchronous, so there is nothing to
  // actually wait on — kept as `false` from the start to avoid any flicker.
  const [isLoading] = useState(false);
  const interceptorIdRef = useRef<number | null>(null);

  const logout = useCallback(() => {
    clearLS(LS_TOKEN);
    clearLS(LS_USER);
    setAuthHeader(null);
    setToken(null);
    setUserState(null);
  }, []);

  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          logout();
        }
        return Promise.reject(error);
      },
    );
    interceptorIdRef.current = id;
    return () => {
      if (interceptorIdRef.current !== null) {
        axios.interceptors.response.eject(interceptorIdRef.current);
      }
    };
  }, [logout]);

  const applyAuthResult = (result: { token: string; user: User }) => {
    saveLS(LS_TOKEN, result.token);
    saveLS(LS_USER, result.user);
    setAuthHeader(result.token);
    setToken(result.token);
    setUserState(result.user);
  };

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    applyAuthResult(result);
  }, []);

  const signup = useCallback(
    async (email: string, password: string, name: string) => {
      await authApi.signup(email, password, name);
      // signup does not log the user in — verifyEmail does, once the code
      // they receive by email is confirmed.
    },
    [],
  );

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const result = await authApi.verifyEmail(email, code);
    applyAuthResult(result);
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await authApi.getMe();
    saveLS(LS_USER, fresh);
    setUserState(fresh);
  }, []);

  const setUser = useCallback((u: User) => {
    saveLS(LS_USER, u);
    setUserState(u);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        signup,
        verifyEmail,
        logout,
        refreshUser,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
