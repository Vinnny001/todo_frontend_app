import { createContext } from "react";
import type { User } from "./api";

export type AuthContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
};

// Split from AuthContext.tsx / useAuth.ts so that file only exports a
// component and this one only exports the context + its type — keeps
// react-refresh/only-export-components happy on both sides.
export const AuthContext = createContext<AuthContextValue | null>(null);
