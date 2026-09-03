import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./context";

// Split into its own file (rather than living alongside AuthProvider in
// AuthContext.tsx) so that file only exports a component, which keeps
// react-refresh/only-export-components happy.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
