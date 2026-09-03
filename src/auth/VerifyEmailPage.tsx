import { useState } from "react";
import { useAuth } from "./useAuth";
import { extractErrorMessage, resendCode } from "./api";

const RESEND_COOLDOWN_MS = 20_000;

export default function VerifyEmailPage({
  email,
  onVerified,
}: {
  email: string;
  onVerified: () => void;
}) {
  const { verifyEmail } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await verifyEmail(email, code.trim());
      onVerified();
    } catch (err) {
      setError(extractErrorMessage(err, "Invalid or expired code."));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown) return;
    setResendCooldown(true);
    setResendMessage(null);
    try {
      const res = await resendCode(email, "signup");
      setResendMessage(res.message || "A new code has been sent.");
    } catch (err) {
      setError(extractErrorMessage(err, "Could not resend code."));
    } finally {
      setTimeout(() => setResendCooldown(false), RESEND_COOLDOWN_MS);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">
          We sent a 6-digit code to <strong>{email}</strong>
        </p>

        {error && <div className="auth-error">{error}</div>}
        {resendMessage && <div className="auth-success">{resendMessage}</div>}

        <label className="auth-label" htmlFor="verify-code">
          Verification code
        </label>
        <input
          id="verify-code"
          className="auth-input"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <button
          className="auth-btn-primary"
          onClick={submit}
          disabled={loading || !code.trim()}
        >
          {loading ? "Verifying…" : "Verify"}
        </button>

        <div className="auth-footer">
          <button
            className="auth-link"
            onClick={handleResend}
            disabled={resendCooldown}
          >
            {resendCooldown ? "Code sent — wait a moment…" : "Resend code"}
          </button>
        </div>
      </div>
    </div>
  );
}
