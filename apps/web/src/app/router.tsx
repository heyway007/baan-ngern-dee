import type {
  PublicAppConfig
} from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState
} from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import { AccountsPage } from "../features/accounts/accounts-page";
import { ResetPasswordPage } from "../features/auth/reset-password-page";
import { SessionGuard } from "../features/auth/session-guard";
import { SignInPage } from "../features/auth/sign-in-page";
import { OverviewPage } from "../features/dashboard/overview-page";
import { InstallmentsPage } from "../features/installments/installments-page";
import { OnboardingPage } from "../features/onboarding/onboarding-page";
import { TransactionsPage } from "../features/transactions/transactions-page";
import {
  createSupabaseCloudAuth,
  type CloudAuth,
  type CloudSession
} from "../lib/cloud-auth";
import { loadPublicAppConfig } from "../lib/cloud-config";
import {
  createRemoteFinanceApi,
  type RemoteFinanceApi
} from "../lib/remote-finance-api";
import {
  cloudReducer,
  initialCloudState
} from "./cloud-state";
import { AppLayout } from "./layout";

const LEGACY_STORAGE_KEYS = [
  "systems-credit:session:v1",
  "systems-credit:finance:v1"
] as const;

export type CloudRouterDependencies = Readonly<{
  storage: Pick<Storage, "removeItem">;
  loadConfig(): Promise<PublicAppConfig>;
  createAuth(config: PublicAppConfig): CloudAuth;
  createApi(
    auth: CloudAuth,
    onUnauthenticated: () => void
  ): RemoteFinanceApi;
}>;

const defaultDependencies: CloudRouterDependencies = {
  storage: window.localStorage,
  loadConfig: () => loadPublicAppConfig(),
  createAuth: createSupabaseCloudAuth,
  createApi: (auth, onUnauthenticated) =>
    createRemoteFinanceApi({ auth, onUnauthenticated })
};

type FinanceRoutesProps = Readonly<{
  dependencies?: CloudRouterDependencies;
}>;

function CloudStatusCard({
  label,
  detail
}: Readonly<{ label: string; detail: string }>) {
  return (
    <main className="page-content">
      <section
        className="empty-state large"
        role="status"
        aria-label={label}
      >
        <span className="brand-mark" aria-hidden="true">฿</span>
        <h1>{label}</h1>
        <p>{detail}</p>
      </section>
    </main>
  );
}

function CloudErrorCard({
  message,
  onRetry
}: Readonly<{ message: string; onRetry(): void }>) {
  return (
    <main className="page-content">
      <section className="empty-state large" role="alert">
        <h1>ยังเชื่อมต่อข้อมูลไม่ได้</h1>
        <p>{message}</p>
        <button
          type="button"
          className="primary-button"
          onClick={onRetry}
        >
          ลองอีกครั้ง
        </button>
      </section>
    </main>
  );
}

export function FinanceRoutes({
  dependencies = defaultDependencies
}: FinanceRoutesProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, dispatch] = useReducer(
    cloudReducer,
    initialCloudState
  );
  const [bootAttempt, setBootAttempt] = useState(0);
  const authRef = useRef<CloudAuth | null>(null);
  const apiRef = useRef<RemoteFinanceApi | null>(null);
  const activeRef = useRef(true);

  const loadSnapshot = useCallback(
    async (session: CloudSession, api: RemoteFinanceApi) => {
      dispatch({ type: "SESSION_FOUND", session });
      try {
        const initial = await api.getSnapshot();
        let snapshot = initial;
        if (initial.workspace) {
          const period = toFinancialDate(
            new Date().toISOString(),
            initial.workspace.timeZone
          ).slice(0, 7);
          const materialized =
            await api.materializeRecurringPeriod({
              workspaceId: initial.workspace.id,
              period
            });
          if (materialized.createdCount > 0) {
            snapshot = await api.getSnapshot();
          }
        }
        if (activeRef.current) {
          dispatch({
            type: "SNAPSHOT_LOADED",
            session,
            snapshot
          });
        }
      } catch {
        if (activeRef.current) {
          dispatch({
            type: "SNAPSHOT_FAILED",
            session,
            message:
              "ตรวจสอบอินเทอร์เน็ตแล้วลองโหลดข้อมูลอีกครั้ง"
          });
        }
      }
    },
    []
  );

  useEffect(() => {
    activeRef.current = true;
    let unsubscribe = () => {};

    async function boot() {
      try {
        const config = await dependencies.loadConfig();
        if (!activeRef.current) return;
        dispatch({ type: "CONFIG_LOADED" });

        const auth = dependencies.createAuth(config);
        const api = dependencies.createApi(auth, () => {
          if (activeRef.current) {
            dispatch({ type: "SIGNED_OUT" });
          }
        });
        authRef.current = auth;
        apiRef.current = api;

        const handleSession = (session: CloudSession | null) => {
          if (!activeRef.current) return;
          if (!session) {
            dispatch({ type: "SIGNED_OUT" });
            return;
          }
          for (const key of LEGACY_STORAGE_KEYS) {
            dependencies.storage.removeItem(key);
          }
          void loadSnapshot(session, api);
        };

        unsubscribe = auth.subscribe(handleSession);
        handleSession(await auth.getSession());
      } catch {
        if (activeRef.current) {
          dispatch({
            type: "BOOT_FAILED",
            message:
              "โหลดการตั้งค่าระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
          });
        }
      }
    }

    void boot();
    return () => {
      activeRef.current = false;
      unsubscribe();
    };
  }, [bootAttempt, dependencies, loadSnapshot]);

  async function signOut() {
    try {
      await authRef.current?.signOut();
    } finally {
      dispatch({ type: "SIGNED_OUT" });
      navigate("/sign-in", { replace: true });
    }
  }

  function refreshSnapshot() {
    if (
      (state.status === "ready" ||
        state.status === "recoverable-error" ||
        state.status === "loading-finance") &&
      state.session &&
      apiRef.current
    ) {
      return loadSnapshot(state.session, apiRef.current);
    }
    return Promise.resolve();
  }

  function acceptAuthenticatedSession(session: CloudSession) {
    for (const key of LEGACY_STORAGE_KEYS) {
      dependencies.storage.removeItem(key);
    }
    if (apiRef.current) {
      void loadSnapshot(session, apiRef.current);
    }
  }

  if (state.status === "loading-config") {
    return (
      <CloudStatusCard
        label="กำลังเชื่อมต่อระบบคลาวด์"
        detail="กำลังโหลดการตั้งค่าที่ปลอดภัยสำหรับอุปกรณ์นี้"
      />
    );
  }
  if (state.status === "loading-session") {
    return (
      <CloudStatusCard
        label="กำลังตรวจสอบการเข้าสู่ระบบ"
        detail="กำลังกู้คืนเซสชัน Supabase ของคุณ"
      />
    );
  }
  if (state.status === "loading-finance") {
    return (
      <CloudStatusCard
        label="กำลังโหลดข้อมูลการเงิน"
        detail="กำลังซิงก์บัญชี รายการ และข้อมูลผ่อนจากคลาวด์"
      />
    );
  }
  if (state.status === "recoverable-error") {
    return (
      <CloudErrorCard
        message={state.message}
        onRetry={() => {
          if (state.retry === "boot") {
            dispatch({ type: "RETRY_BOOT" });
            setBootAttempt((attempt) => attempt + 1);
          } else if (state.session && apiRef.current) {
            dispatch({ type: "RETRY_SNAPSHOT" });
            void loadSnapshot(state.session, apiRef.current);
          }
        }}
      />
    );
  }

  if (state.status === "signed-out") {
    const auth = authRef.current;
    if (!auth) return null;
    return (
      <Routes>
        <Route
          path="/sign-in"
          element={
            <SignInPage
              auth={auth}
              onAuthenticated={acceptAuthenticatedSession}
            />
          }
        />
        <Route
          path="/reset-password"
          element={
            <ResetPasswordPage
              auth={auth}
              onComplete={() =>
                navigate("/sign-in", { replace: true })
              }
            />
          }
        />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  const { session, snapshot } = state;
  const api = apiRef.current;
  if (!api) {
    return null;
  }

  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <Navigate
            to={snapshot.workspace ? "/overview" : "/onboarding"}
            replace
          />
        }
      />
      <Route
        path="/reset-password"
        element={
          <ResetPasswordPage
            auth={authRef.current!}
            onComplete={() =>
              navigate("/overview", { replace: true })
            }
          />
        }
      />
      <Route
        path="/onboarding"
        element={
          snapshot.workspace ? (
            <Navigate to="/overview" replace />
          ) : (
            <OnboardingPage
              api={api}
              onComplete={() => {
                void refreshSnapshot().then(() => {
                  navigate("/overview", { replace: true });
                });
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
            <AppLayout session={session} onSignOut={signOut} />
          }
        >
          <Route
            path="/overview"
            element={
              <OverviewPage session={session} snapshot={snapshot} />
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
