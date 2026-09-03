import { useRef, useState } from "react";
import { ContextMenu } from "../components/ContextMenu";
import { useAuth } from "./useAuth";
import Avatar from "./Avatar";

export default function ProfileMenu({
  onOpenProfile,
  onOpenSettings,
  onLogout,
}: {
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  if (!user) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        className="avatar-btn"
        onClick={() => setOpen((p) => !p)}
        title={user.name || user.email}
      >
        <Avatar user={user} size="sm" />
      </button>

      {open && (
        <ContextMenu
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
          items={[
            {
              label: "View profile",
              icon: "👤",
              onClick: onOpenProfile,
            },
            {
              label: "Settings",
              icon: "⚙️",
              onClick: onOpenSettings,
            },
            {
              label: "Log out",
              icon: "🚪",
              danger: true,
              onClick: onLogout,
            },
          ]}
        />
      )}
    </div>
  );
}
