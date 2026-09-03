import { useState } from "react";
import App from "./App";
import { useAuth } from "./auth/useAuth";
import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import VerifyEmailPage from "./auth/VerifyEmailPage";
import ForgotPasswordPage from "./auth/ForgotPasswordPage";
import ResetPasswordPage from "./auth/ResetPasswordPage";
import ProfilePage from "./auth/ProfilePage";
import AccountSettingsPage from "./auth/AccountSettingsPage";
import ProfileMenu from "./auth/ProfileMenu";

type AuthScreen =
  | "login"
  | "signup"
  | "verify-email"
  | "forgot-password"
  | "reset-password";

type AppScreen = "app" | "profile" | "settings";

function UnauthenticatedRoot() {
  const [screen, setScreen] = useState<AuthScreen>("login");
  // Carried across Signup → VerifyEmail and ForgotPassword → ResetPassword.
  const [pendingEmail, setPendingEmail] = useState("");

  switch (screen) {
    case "signup":
      return (
        <SignupPage
          onSwitchToLogin={() => setScreen("login")}
          onSignedUp={(email) => {
            setPendingEmail(email);
            setScreen("verify-email");
          }}
        />
      );
    case "verify-email":
      return (
        <VerifyEmailPage
          email={pendingEmail}
          onVerified={() => {
            /* AuthProvider now has a token/user — the outer switcher in
               <Root> re-renders into the authenticated tree automatically. */
          }}
        />
      );
    case "forgot-password":
      return (
        <ForgotPasswordPage
          onSwitchToLogin={() => setScreen("login")}
          onProceedToReset={(email) => {
            setPendingEmail(email);
            setScreen("reset-password");
          }}
        />
      );
    case "reset-password":
      return (
        <ResetPasswordPage
          email={pendingEmail}
          onReset={() => setScreen("login")}
        />
      );
    case "login":
    default:
      return (
        <LoginPage
          onSwitchToSignup={() => setScreen("signup")}
          onSwitchToForgotPassword={() => setScreen("forgot-password")}
          onLoggedIn={() => {
            /* same as above — AuthProvider state flip re-renders <Root> */
          }}
        />
      );
  }
}

function AuthenticatedRoot() {
  const { logout } = useAuth();
  const [screen, setScreen] = useState<AppScreen>("app");

  if (screen === "profile") {
    return <ProfilePage onBack={() => setScreen("app")} />;
  }
  if (screen === "settings") {
    return <AccountSettingsPage onBack={() => setScreen("app")} />;
  }

  return (
    <App
      accountSlot={
        <ProfileMenu
          onOpenProfile={() => setScreen("profile")}
          onOpenSettings={() => setScreen("settings")}
          onLogout={logout}
        />
      }
    />
  );
}

export default function Root() {
  const { user, token, isLoading } = useAuth();

  if (isLoading) return null;

  return user && token ? <AuthenticatedRoot /> : <UnauthenticatedRoot />;
}
