import { useState } from "react";
import { useAuth } from "./useAuth";
import { extractErrorMessage } from "./api";

export default function SignupPage({
  onSwitchToLogin,
  onSignedUp,
}: {
  onSwitchToLogin: () => void;
  onSignedUp: (email: string) => void;
}) {
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await signup(email.trim(), password, name.trim());
      onSignedUp(email.trim());
    } catch (err) {
      setError(extractErrorMessage(err, "Could not sign up. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Create an account</h1>
        <p className="auth-subtitle">Sign up to get started</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-label" htmlFor="signup-name">
          Name (optional)
        </label>
        <input
          id="signup-name"
          className="auth-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="auth-label" htmlFor="signup-email">
          Email
        </label>
        <input
          id="signup-email"
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="auth-label" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
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
          {loading ? "Signing up…" : "Sign up"}
        </button>

        <div className="auth-footer">
          Already have an account?{" "}
          <button className="auth-link" onClick={onSwitchToLogin}>
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
