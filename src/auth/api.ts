import axios from "axios";
import { API } from "../config";

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type AuthResult = { token: string; user: User };

export const signup = (email: string, password: string, name: string) =>
  axios
    .post<{ message: string }>(`${API}/auth/signup`, { email, password, name })
    .then((r) => r.data);

export const verifyEmail = (email: string, code: string) =>
  axios
    .post<AuthResult>(`${API}/auth/verify-email`, { email, code })
    .then((r) => r.data);

export const resendCode = (
  email: string,
  purpose: "signup" | "password_reset",
) =>
  axios
    .post<{ message: string }>(`${API}/auth/resend-code`, { email, purpose })
    .then((r) => r.data);

export const login = (email: string, password: string) =>
  axios
    .post<AuthResult>(`${API}/auth/login`, { email, password })
    .then((r) => r.data);

export const forgotPassword = (email: string) =>
  axios
    .post<{ message: string }>(`${API}/auth/forgot-password`, { email })
    .then((r) => r.data);

export const resetPassword = (
  email: string,
  code: string,
  newPassword: string,
) =>
  axios
    .post<{ message: string }>(`${API}/auth/reset-password`, {
      email,
      code,
      newPassword,
    })
    .then((r) => r.data);

export const getMe = () => axios.get<User>(`${API}/auth/me`).then((r) => r.data);

export const updateMe = (changes: Partial<Pick<User, "name" | "avatarUrl">>) =>
  axios.patch<User>(`${API}/auth/me`, changes).then((r) => r.data);

export const changePassword = (currentPassword: string, newPassword: string) =>
  axios
    .patch<{ message: string }>(`${API}/auth/change-password`, {
      currentPassword,
      newPassword,
    })
    .then((r) => r.data);

// Error bodies are inconsistently `{error}` or `{message}` depending on route.
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: string; message?: string }
      | undefined;
    return data?.error || data?.message || fallback;
  }
  return fallback;
}
