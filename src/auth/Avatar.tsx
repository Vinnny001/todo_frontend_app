import type { User } from "./api";

// Shared avatar rendering rule used by both ProfileMenu and ProfilePage:
// an <img> when avatarUrl is set, otherwise a colored circle with the first
// letter of the user's name, falling back to the first letter of the email.
export default function Avatar({
  user,
  size = "sm",
}: {
  user: User;
  size?: "sm" | "lg";
}) {
  const letter = (user.name?.trim()?.[0] || user.email[0] || "?").toUpperCase();
  const className = `avatar avatar-${size}`;

  if (user.avatarUrl) {
    return <img className={className} src={user.avatarUrl} alt={user.name || user.email} />;
  }
  return <span className={className}>{letter}</span>;
}
