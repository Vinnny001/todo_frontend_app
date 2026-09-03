import { useState } from "react";
import { extractErrorMessage, resetPassword } from "./api";

export default function ResetPasswordPage({
  email: initialEmail,
  onReset,
}: {
  email: string;
  onReset: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !code.trim() || !newPassword) return;
    setLoading(true);
    setError(null);
    try {
      await resetPassword(email.trim(), code.trim(), newPassword);
      onReset();
    } catch (err) {
      setError(extractErrorMessage(err, "Invalid or expired code."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-subtitle">
          Enter the code you received and a new password
        </p>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-label" htmlFor="reset-email">
          Email
        </label>
        <input
          id="reset-email"
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="auth-label" htmlFor="reset-code">
          Reset code
        </label>
        <input
          id="reset-code"
          className="auth-input"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />

        <label className="auth-label" htmlFor="reset-password">
          New password
        </label>
        <input
          id="reset-password"
          className="auth-input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <button
          className="auth-btn-primary"
          onClick={submit}
          disabled={loading || !email.trim() || !code.trim() || !newPassword}
        >
          {loading ? "Resetting…" : "Reset password"}
        </button>
      </div>
    </div>
  );
}
