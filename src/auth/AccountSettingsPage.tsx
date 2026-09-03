import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "../config";
import { extractErrorMessage } from "./api";

// Mirrors App.tsx's AppSettings type (App.tsx:36-39) — kept independent
// rather than imported, since App.tsx doesn't export it and this page is a
// standalone full-screen route rendered outside <App>.
type AppSettings = {
  notifyDueTodayEnabled: boolean;
  defaultReminderMessage: string;
};

export default function AccountSettingsPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios
      .get<AppSettings>(`${API}/settings`)
      .then((r) => setSettings(r.data))
      .catch((err) =>
        setError(extractErrorMessage(err, "Could not load settings.")),
      );
  }, []);

  const patch = async (changes: Partial<AppSettings>) => {
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, ...changes });
    setSaving(true);
    setError(null);
    try {
      const res = await axios.patch<AppSettings>(`${API}/settings`, changes);
      setSettings(res.data);
    } catch (err) {
      setSettings(prev);
      setError(extractErrorMessage(err, "Could not save settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-screen">
      <div className="page-screen-header">
        <button className="auth-btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <span className="page-screen-title">Settings</span>
      </div>

      <div className="page-screen-body">
        <div className="page-section">
          <h3 className="page-section-title">Notifications</h3>

          {error && <div className="auth-error">{error}</div>}

          {!settings ? (
            <p className="auth-subtitle">Loading…</p>
          ) : (
            <>
              <label className="auth-settings-row">
                <span>Notify me when a task is due today</span>
                <input
                  type="checkbox"
                  checked={settings.notifyDueTodayEnabled}
                  disabled={saving}
                  onChange={(e) =>
                    patch({ notifyDueTodayEnabled: e.target.checked })
                  }
                />
              </label>

              <p className="auth-label" style={{ marginTop: 14 }}>
                Default reminder message (use {"{task}"} for the task name)
              </p>
              <input
                className="auth-input"
                value={settings.defaultReminderMessage}
                onChange={(e) =>
                  setSettings((p) =>
                    p ? { ...p, defaultReminderMessage: e.target.value } : p,
                  )
                }
                onBlur={(e) =>
                  patch({ defaultReminderMessage: e.target.value })
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
