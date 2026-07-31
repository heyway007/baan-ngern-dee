import type {
  PublicAppConfig,
  UserProfile
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
  useLocation,
  useNavigate,
  useSearchParams
} from "react-router-dom";

import { AccountsPage } from "../features/accounts/accounts-page";
import { InvitationsPage } from "../features/admin/invitations-page";
import { UsersPage } from "../features/admin/users-page";
import { AcceptInvitePage } from "../features/auth/accept-invite-page";
import {
  readLineDestination,
  resolveLineDestination
} from "../features/auth/line-entry";
import {
  LineLoginFailurePage,
  LineLoginPage
} from "../features/auth/line-login-page";
import { LineWorkspacePage } from "../features/auth/line-workspace-page";
import { ResetPasswordPage } from "../features/auth/reset-password-page";
import { SessionGuard } from "../features/auth/session-guard";
import { SignInPage } from "../features/auth/sign-in-page";
import { OverviewPage } from "../features/dashboard/overview-page";
import { InstallmentsPage } from "../features/installments/installments-page";
import { OnboardingPage } from "../features/onboarding/onboarding-page";
import { RecurringPage } from "../features/recurring/recurring-page";
import { PlanningPage } from "../features/planning/planning-page";
import { ProfilePage } from "../features/profile/profile-page";
import { TransactionsPage } from "../features/transactions/transactions-page";
import {
  createSupabaseCloudAuth,
  type CloudAuth,
  type CloudSession
} from "../lib/cloud-auth";
import { loadPublicAppConfig } from "../lib/cloud-config";
import {
  createAdminInvitationApi,
  createPublicInvitationApi,
  type AdminInvitationApi,
  type PublicInvitationApi
} from "../lib/invitation-api";
import {
  createProfileApi,
  type ProfileApi
} from "../lib/profile-api";
import {
  createRemoteFinanceApi,
  type RemoteFinanceApi
} from "../lib/remote-finance-api";
import {
  createUserManagementApi,
  type UserManagementApi
} from "../lib/user-management-api";
import {
  cloudReducer,
  initialCloudState
} from "./cloud-state";
import { featureFlags } from "./feature-flags";
import { AppLayout } from "./layout";

const LEGACY_STORAGE_KEYS = [
  "systems-credit:session:v1",
  "systems-credit:finance:v1"
] as const;

export type CloudRouterDependencies = Readonly<{
  storage: Pick<Storage, "removeItem">;
  destinationStorage: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  >;
  loadConfig(): Promise<PublicAppConfig>;
  createAuth(config: PublicAppConfig): CloudAuth;
  createApi(
    auth: CloudAuth,
    onUnauthenticated: () => void
  ): RemoteFinanceApi;
  createAdminApi(
    auth: CloudAuth,
    onUnauthenticated: () => void
  ): AdminInvitationApi;
  createUserManagementApi(
    auth: CloudAuth,
    onUnauthenticated: () => void
  ): UserManagementApi;
  createProfileApi(
    auth: CloudAuth,
    onUnauthenticated: () => void
  ): ProfileApi;
  createPublicInvitationApi(): PublicInvitationApi;
}>;

const defaultDependencies: CloudRouterDependencies = {
  storage: window.localStorage,
  destinationStorage: window.sessionStorage,
  loadConfig: () => loadPublicAppConfig(),
  createAuth: createSupabaseCloudAuth,
  createApi: (auth, onUnauthenticated) =>
    createRemoteFinanceApi({ auth, onUnauthenticated }),
  createAdminApi: (auth, onUnauthenticated) =>
    createAdminInvitationApi({ auth, onUnauthenticated }),
  createUserManagementApi: (auth, onUnauthenticated) =>
    createUserManagementApi({ auth, onUnauthenticated }),
  createProfileApi: (auth, onUnauthenticated) =>
    createProfileApi({ auth, onUnauthenticated }),
  createPublicInvitationApi: () =>
    createPublicInvitationApi()
};

type FinanceRoutesProps = Readonly<{
  dependencies?: CloudRouterDependencies;
}>;

type ProfileViewState = Readonly<{
  profile: UserProfile;
  loading: boolean;
  error?: string;
}>;

const profileLoadFailedMessage =
  "ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ กรุณาลองใหม่";

function sessionProfile(session: CloudSession): UserProfile {
  return {
    userId: session.userId,
    displayName: session.displayName,
    accountChannel: session.email
      ? { kind: "email", label: session.email }
      : { kind: "line", label: "LINE" },
    avatar: session.avatarUrl
      ? { source: "line", url: session.avatarUrl }
      : { source: "initial", url: null }
  };
}

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

function AuthenticatedInvitationCard({
  onSignOut
}: Readonly<{ onSignOut(): void }>) {
  return (
    <main className="auth-center-shell">
      <section className="setup-card invitation-session-card">
        <h1>มีบัญชีเข้าสู่ระบบอยู่แล้ว</h1>
        <p className="muted">
          เพื่อป้องกันการสร้างบัญชีผิดคน กรุณาออกจากระบบก่อนใช้คำเชิญนี้
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={onSignOut}
        >
          ออกจากระบบเพื่อรับคำเชิญ
        </button>
      </section>
    </main>
  );
}

export function FinanceRoutes({
  dependencies = defaultDependencies
}: FinanceRoutesProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedLineDestination =
    location.pathname === "/line"
      ? resolveLineDestination(searchParams.get("next"))
      : readLineDestination(dependencies.destinationStorage);
  const lineCallbackUrl =
    `${window.location.origin}/line/callback`;
  const shouldRefreshLineSessionOnBoot = useRef(
    location.pathname === "/line"
  ).current;
  const [invitationToken] = useState(() => {
    if (location.pathname !== "/accept-invite") return "";
    const token =
      new URLSearchParams(
        location.hash.replace(/^#/, "")
      ).get("token") ?? "";
    if (token) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }
    return token;
  });
  const [state, dispatch] = useReducer(
    cloudReducer,
    initialCloudState
  );
  const [bootAttempt, setBootAttempt] = useState(0);
  const [publicConfig, setPublicConfig] =
    useState<PublicAppConfig | null>(null);
  const [canManageInvitations, setCanManageInvitations] =
    useState<boolean | null>(null);
  const [canManageUsers, setCanManageUsers] =
    useState<boolean | null>(null);
  const [profileState, setProfileState] =
    useState<ProfileViewState | null>(null);
  const authRef = useRef<CloudAuth | null>(null);
  const apiRef = useRef<RemoteFinanceApi | null>(null);
  const adminApiRef = useRef<AdminInvitationApi | null>(null);
  const userManagementApiRef =
    useRef<UserManagementApi | null>(null);
  const profileApiRef = useRef<ProfileApi | null>(null);
  const publicInvitationApiRef =
    useRef<PublicInvitationApi | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const profileLoadGenerationRef = useRef(0);
  const activeRef = useRef(true);

  const clearProfile = useCallback(() => {
    sessionUserIdRef.current = null;
    profileLoadGenerationRef.current += 1;
    setProfileState(null);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const profileApi = profileApiRef.current;
    if (!profileApi) return;
    const generation = profileLoadGenerationRef.current + 1;
    profileLoadGenerationRef.current = generation;
    setProfileState((current) =>
      current?.profile.userId === userId
        ? {
            profile: current.profile,
            loading: true
          }
        : current
    );
    try {
      const profile = await profileApi.get();
      if (
        activeRef.current &&
        sessionUserIdRef.current === userId &&
        profileLoadGenerationRef.current === generation
      ) {
        if (profile.userId !== userId) {
          setProfileState((current) =>
            current?.profile.userId === userId
              ? {
                  profile: current.profile,
                  loading: false,
                  error: profileLoadFailedMessage
                }
              : current
          );
          return;
        }
        setProfileState({
          profile,
          loading: false
        });
      }
    } catch {
      if (
        activeRef.current &&
        sessionUserIdRef.current === userId &&
        profileLoadGenerationRef.current === generation
      ) {
        setProfileState((current) =>
          current?.profile.userId === userId
            ? {
                profile: current.profile,
                loading: false,
                error: profileLoadFailedMessage
              }
            : current
        );
      }
    }
  }, []);

  const loadSnapshot = useCallback(
    async (
      session: CloudSession,
      api: RemoteFinanceApi,
      showLoadingState = true
    ) => {
      if (showLoadingState) {
        dispatch({ type: "SESSION_FOUND", session });
      }
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
        setPublicConfig(config);
        dispatch({ type: "CONFIG_LOADED" });

        const auth = dependencies.createAuth(config);
        const publicInvitationApi =
          dependencies.createPublicInvitationApi();
        const onUnauthenticated = () => {
          if (activeRef.current) {
            clearProfile();
            setCanManageInvitations(null);
            setCanManageUsers(null);
            dispatch({ type: "SIGNED_OUT" });
          }
        };
        const api = dependencies.createApi(
          auth,
          onUnauthenticated
        );
        const adminApi = dependencies.createAdminApi(
          auth,
          onUnauthenticated
        );
        const userManagementApi =
          dependencies.createUserManagementApi(
            auth,
            onUnauthenticated
          );
        const profileApi = dependencies.createProfileApi(
          auth,
          onUnauthenticated
        );
        authRef.current = auth;
        apiRef.current = api;
        adminApiRef.current = adminApi;
        userManagementApiRef.current = userManagementApi;
        profileApiRef.current = profileApi;
        publicInvitationApiRef.current = publicInvitationApi;

        let sessionUserId: string | null = null;
        const handleSession = (
          session: CloudSession | null,
          showLoadingState = false
        ) => {
          if (!activeRef.current) return;
          if (!session) {
            sessionUserId = null;
            clearProfile();
            setCanManageInvitations(null);
            setCanManageUsers(null);
            dispatch({ type: "SIGNED_OUT" });
            return;
          }
          sessionUserId = session.userId;
          sessionUserIdRef.current = session.userId;
          setProfileState({
            profile: sessionProfile(session),
            loading: true
          });
          void loadProfile(session.userId);
          for (const key of LEGACY_STORAGE_KEYS) {
            dependencies.storage.removeItem(key);
          }
          setCanManageInvitations(null);
          setCanManageUsers(null);
          void adminApi
            .capabilities()
            .then((capabilities) => {
              if (activeRef.current) {
                setCanManageInvitations(
                  capabilities.canManageInvitations
                );
                setCanManageUsers(
                  capabilities.canManageUsers
                );
              }
            })
            .catch(() => {
              if (activeRef.current) {
                setCanManageInvitations(false);
                setCanManageUsers(false);
              }
            });
          void loadSnapshot(session, api, showLoadingState);
        };

        let session = await auth.getSession();
        if (shouldRefreshLineSessionOnBoot && session) {
          session = await auth.refreshSession();
        }
        handleSession(session, true);
        unsubscribe = auth.subscribe((nextSession) => {
          if (nextSession?.userId === sessionUserId) return;
          handleSession(nextSession, true);
        });
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
  }, [
    bootAttempt,
    dependencies,
    clearProfile,
    loadProfile,
    loadSnapshot,
    shouldRefreshLineSessionOnBoot
  ]);

  async function signOut() {
    try {
      await authRef.current?.signOut();
    } finally {
      clearProfile();
      setCanManageInvitations(null);
      setCanManageUsers(null);
      dispatch({ type: "SIGNED_OUT" });
      navigate("/sign-in", { replace: true });
    }
  }

  async function signOutForInvitation() {
    const invitationLocation =
      `${location.pathname}${location.search}`;
    try {
      await authRef.current?.signOut();
    } finally {
      clearProfile();
      setCanManageInvitations(null);
      setCanManageUsers(null);
      dispatch({ type: "SIGNED_OUT" });
      navigate(invitationLocation, { replace: true });
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

  function refreshLineWorkspace() {
    if (
      state.status === "ready" &&
      state.session &&
      apiRef.current
    ) {
      return loadSnapshot(
        state.session,
        apiRef.current,
        false
      );
    }
    return Promise.resolve();
  }

  function acceptAuthenticatedSession(session: CloudSession) {
    sessionUserIdRef.current = session.userId;
    setProfileState({
      profile: sessionProfile(session),
      loading: true
    });
    void loadProfile(session.userId);
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
    const publicInvitationApi = publicInvitationApiRef.current;
    if (!auth || !publicInvitationApi) return null;
    return (
      <Routes>
        <Route
          path="/accept-invite"
          element={
            <AcceptInvitePage
              api={publicInvitationApi}
              auth={auth}
              token={invitationToken}
              onAuthenticated={(session) => {
                acceptAuthenticatedSession(session);
                navigate("/onboarding", { replace: true });
              }}
            />
          }
        />
        <Route
          path="/sign-in"
          element={
            <SignInPage
              auth={auth}
              turnstileSiteKey={
                publicConfig!.turnstileSiteKey
              }
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
        <Route
          path="/line"
          element={
            <LineLoginPage
              auth={auth}
              destination={requestedLineDestination}
              destinationStorage={
                dependencies.destinationStorage
              }
              callbackUrl={lineCallbackUrl}
            />
          }
        />
        <Route
          path="/line/callback"
          element={
            <LineLoginFailurePage
              destination={requestedLineDestination}
            />
          }
        />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  const { session, snapshot } = state;
  const api = apiRef.current;
  const adminApi = adminApiRef.current;
  const userManagementApi = userManagementApiRef.current;
  const profileApi = profileApiRef.current;
  if (!api || !adminApi || !userManagementApi || !profileApi) {
    return null;
  }
  const effectiveProfileState =
    profileState?.profile.userId === session.userId
      ? profileState
      : {
          profile: sessionProfile(session),
          loading: true
        };

  return (
    <Routes>
      <Route
        path="/accept-invite"
        element={
          <AuthenticatedInvitationCard
            onSignOut={() => void signOutForInvitation()}
          />
        }
      />
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
        path="/line"
        element={
          <LineWorkspacePage
            session={session}
            hasWorkspace={Boolean(snapshot.workspace)}
            api={api}
            destination={requestedLineDestination}
            destinationStorage={
              dependencies.destinationStorage
            }
            onWorkspaceChanged={refreshLineWorkspace}
          />
        }
      />
      <Route
        path="/line/callback"
        element={
          <LineWorkspacePage
            session={session}
            hasWorkspace={Boolean(snapshot.workspace)}
            api={api}
            destination={requestedLineDestination}
            destinationStorage={
              dependencies.destinationStorage
            }
            onWorkspaceChanged={refreshLineWorkspace}
          />
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
            <AppLayout
              profile={effectiveProfileState.profile}
              canManageInvitations={
                canManageInvitations === true
              }
              canManageUsers={canManageUsers === true}
              onSignOut={signOut}
            />
          }
        >
          <Route
            path="/overview"
            element={
              <OverviewPage
                displayName={effectiveProfileState.profile.displayName}
                snapshot={snapshot}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProfilePage
                profile={effectiveProfileState.profile}
                api={profileApi}
                loading={effectiveProfileState.loading}
                loadError={effectiveProfileState.error}
                onRetry={() => void loadProfile(session.userId)}
                onProfileChanged={(profile) => {
                  if (profile.userId !== session.userId) return;
                  profileLoadGenerationRef.current += 1;
                  setProfileState({
                    profile,
                    loading: false
                  });
                }}
              />
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
          <Route
            path="/recurring"
            element={
              <RecurringPage
                api={api}
                snapshot={snapshot}
                onChanged={refreshSnapshot}
              />
            }
          />
          <Route
            path="/admin/invitations"
            element={
              canManageInvitations === null ? (
                <CloudStatusCard
                  label="กำลังตรวจสอบสิทธิ์"
                  detail="กำลังยืนยันสิทธิ์ Super Admin กับระบบ"
                />
              ) : canManageInvitations ? (
                <InvitationsPage api={adminApi} />
              ) : (
                <Navigate to="/overview" replace />
              )
            }
          />
          <Route
            path="/admin/users"
            element={
              canManageUsers === null ? (
                <CloudStatusCard
                  label="กำลังตรวจสอบสิทธิ์"
                  detail="กำลังยืนยันสิทธิ์จัดการผู้ใช้กับระบบ"
                />
              ) : canManageUsers ? (
                <UsersPage
                  api={userManagementApi}
                  signedInUserId={session.userId}
                  protectedUserId={session.userId}
                />
              ) : (
                <Navigate to="/overview" replace />
              )
            }
          />
          <Route
            path="/planning"
            element={
              featureFlags.financialPlanning ? (
                <PlanningPage
                  api={api}
                  snapshot={snapshot}
                  onChanged={refreshSnapshot}
                />
              ) : (
                <Navigate to="/overview" replace />
              )
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
