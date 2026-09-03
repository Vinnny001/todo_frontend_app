import { useState } from "react";
import { useAuth } from "./useAuth";
import { changePassword, extractErrorMessage, updateMe } from "./api";
import Avatar from "./Avatar";

export default function ProfilePage({ onBack }: { onBack: () => void }) {
  const { user, setUser } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const updated = await updateMe({
        name: name.trim(),
        avatarUrl: avatarUrl.trim(),
      });
      setUser(updated);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(extractErrorMessage(err, "Could not save profile."));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!currentPassword || !newPassword) return;
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSaved(false);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSaved(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordError(extractErrorMessage(err, "Could not change password."));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="page-screen">
      <div className="page-screen-header">
        <button className="auth-btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <span className="page-screen-title">Profile</span>
      </div>

      <div className="page-screen-body">
        <div className="page-section" style={{ textAlign: "center" }}>
          <Avatar user={{ ...user, name, avatarUrl }} size="lg" />

          {profileError && <div className="auth-error">{profileError}</div>}
          {profileSaved && (
            <div className="auth-success">Profile updated.</div>
          )}

          <label className="auth-label" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            className="auth-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProfileSaved(false);
            }}
          />

          <label className="auth-label" htmlFor="profile-avatar">
            Avatar URL
          </label>
          <input
            id="profile-avatar"
            className="auth-input"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value);
              setProfileSaved(false);
            }}
          />

          <button
            className="auth-btn-primary"
            onClick={saveProfile}
            disabled={savingProfile}
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </div>

        <div className="page-section">
          <h3 className="page-section-title">Change password</h3>

          {passwordError && <div className="auth-error">{passwordError}</div>}
          {passwordSaved && (
            <div className="auth-success">Password changed.</div>
          )}

          <label className="auth-label" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            className="auth-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          <label className="auth-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className="auth-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePassword()}
          />

          <button
            className="auth-btn-primary"
            onClick={savePassword}
            disabled={savingPassword || !currentPassword || !newPassword}
          >
            {savingPassword ? "Saving…" : "Change password"}
          </button>
        </div>
      </div>
    </div>
  );
}
