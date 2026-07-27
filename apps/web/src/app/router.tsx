import { useMemo, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import { AccountsPage } from "../features/accounts/accounts-page";
import { SessionGuard } from "../features/auth/session-guard";
import { SignInPage } from "../features/auth/sign-in-page";
import { OverviewPage } from "../features/dashboard/overview-page";
import { OnboardingPage } from "../features/onboarding/onboarding-page";
import { InstallmentsPage } from "../features/installments/installments-page";
import { TransactionsPage } from "../features/transactions/transactions-page";
import {
  createLocalFinanceApi,
  type LocalFinanceSnapshot
} from "../lib/local-finance-api";
import {
  clearLocalSession,
  readLocalSession,
  writeLocalSession,
  type LocalSession
} from "../lib/local-session";
import { AppLayout } from "./layout";

type FinanceRoutesProps = Readonly<{
  storage?: Storage;
}>;

export function FinanceRoutes({
  storage = window.localStorage
}: FinanceRoutesProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const api = useMemo(() => createLocalFinanceApi(storage), [storage]);
  const [snapshot, setSnapshot] = useState<LocalFinanceSnapshot>(
    () => api.getSnapshot()
  );
  const [session, setSession] = useState<LocalSession | null>(
    () => readLocalSession(storage)
  );

  function refreshSnapshot() {
    setSnapshot(api.getSnapshot());
  }

  function signIn(displayName: string) {
    const next = writeLocalSession(storage, displayName);
    setSession(next);
    navigate(snapshot.workspace ? "/overview" : "/onboarding", {
      replace: true
    });
  }

  function signOut() {
    clearLocalSession(storage);
    setSession(null);
    navigate("/sign-in", { replace: true });
  }

  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          session ? (
            <Navigate
              to={snapshot.workspace ? "/overview" : "/onboarding"}
              replace
            />
          ) : (
            <SignInPage onSignIn={signIn} />
          )
        }
      />
      <Route
        path="/onboarding"
        element={
          !session ? (
            <Navigate to="/sign-in" replace />
          ) : snapshot.workspace ? (
            <Navigate to="/overview" replace />
          ) : (
            <OnboardingPage
              api={api}
              onComplete={() => {
                refreshSnapshot();
                navigate("/overview", { replace: true });
              }}
            />
          )
        }
      />

      <Route
        element={
          <SessionGuard
            session={session}
            hasWorkspace={Boolean(snapshot.workspace)}
          />
        }
      >
        <Route
          element={
            session ? (
              <AppLayout session={session} onSignOut={signOut} />
            ) : null
          }
        >
          <Route
            path="/overview"
            element={
              session ? (
                <OverviewPage session={session} snapshot={snapshot} />
              ) : null
            }
          />
          <Route
            path="/accounts"
            element={
              <AccountsPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
              />
            }
          />
          <Route
            path="/transactions"
            element={
              <TransactionsPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
              />
            }
          />
          <Route
            path="/transactions/new"
            element={
              <TransactionsPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
                initiallyOpen
                initialType={
                  searchParams.get("type") === "income"
                    ? "income"
                    : "expense"
                }
              />
            }
          />
          <Route
            path="/installments"
            element={
              <InstallmentsPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
              />
            }
          />
          <Route
            path="/installments/new"
            element={
              <InstallmentsPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
                initiallyOpen
              />
            }
          />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <FinanceRoutes />
    </BrowserRouter>
  );
}
