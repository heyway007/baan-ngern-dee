import { Navigate, Outlet } from "react-router-dom";

type SessionGuardProps = Readonly<{
  session: { displayName: string } | null;
  hasWorkspace: boolean;
}>;

export function SessionGuard({
  session,
  hasWorkspace
}: SessionGuardProps) {
  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  if (!hasWorkspace) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
