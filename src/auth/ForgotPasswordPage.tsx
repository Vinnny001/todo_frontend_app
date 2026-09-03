import { useState } from "react";
import { extractErrorMessage, forgotPassword } from "./api";

export default function ForgotPasswordPage({
  onSwitchToLogin,
  onProceedToReset,
}: {
  onSwitchToLogin: () => void;
  onProceedToReset: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Backend always returns a generic 200 — never used to infer whether
      // the account exists.
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Forgot password</h1>
        <p className="auth-subtitle">
          Enter your email and we'll send you a reset code
        </p>

        {error && <div className="auth-error">{error}</div>}
        {sent && (
          <div className="auth-success">
            If an account exists for that email, a reset code has been sent.
          </div>
        )}

        <label className="auth-label" htmlFor="forgot-email">
          Email
        </label>
        <input
          id="forgot-email"
          className="auth-input"
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {!sent ? (
          <button
            className="auth-btn-primary"
            onClick={submit}
            disabled={loading || !email.trim()}
          >
            {loading ? "Sending…" : "Send reset code"}
          </button>
        ) : (
          <button
            className="auth-btn-primary"
            onClick={() => onProceedToReset(email.trim())}
          >
            I have a code
          </button>
        )}

        <div className="auth-footer">
          <button className="auth-link" onClick={onSwitchToLogin}>
            Back to log in
          </button>
        </div>
      </div>
    </div>
  );
}
