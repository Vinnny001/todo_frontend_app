import { useState } from "react";
import { useAuth } from "./useAuth";
import { extractErrorMessage } from "./api";

export default function LoginPage({
  onSwitchToSignup,
  onSwitchToForgotPassword,
  onLoggedIn,
}: {
  onSwitchToSignup: () => void;
  onSwitchToForgotPassword: () => void;
  onLoggedIn: () => void;
}) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(extractErrorMessage(err, "Could not log in. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Log in to your account</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="auth-input"
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <label className="auth-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="auth-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <button
          className="auth-btn-primary"
          onClick={submit}
          disabled={loading || !email.trim() || !password}
        >
          {loading ? "Logging in…" : "Log in"}
        </button>

        <div className="auth-footer">
          <button className="auth-link" onClick={onSwitchToForgotPassword}>
            Forgot password?
          </button>
        </div>
        <div className="auth-footer">
          Don't have an account?{" "}
          <button className="auth-link" onClick={onSwitchToSignup}>
            Sign up
          </button>
        </div>
      </div>
    </div>
  );
}
