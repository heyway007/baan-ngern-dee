import type {
  FinanceSnapshot,
  PublicAppConfig
} from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { readLineDestination } from "../features/auth/line-entry";
import type {
  CloudAuth,
  CloudSession
} from "../lib/cloud-auth";
import type {
  AdminInvitationApi,
  PublicInvitationApi
} from "../lib/invitation-api";
import type {
  RemoteFinanceApi
} from "../lib/remote-finance-api";
import type { UserManagementApi } from "../lib/user-management-api";
import {
  FinanceRoutes,
  type CloudRouterDependencies
} from "./router";

const config: PublicAppConfig = {
  supabaseUrl: "https://project.supabase.co",
  supabasePublishableKey: "sb_publishable_public",
  turnstileSiteKey: "1x00000000000000000000AA"
};

const session: CloudSession = {
  userId: "9c585235-f409-4764-b4ad-f1da4d500290",
  email: "min@example.test",
  displayName: "มิน",
  accessToken: "access-token"
};

const emptySnapshot: FinanceSnapshot = {
  version: 1,
  workspace: null,
  categories: [],
  accounts: [],
  accountBalances: {},
  openingTransactions: [],
  transactions: [],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [],
  recurringOccurrences: [],
  budgetAllocations: [],
  savingsGoals: []
};

const workspaceSnapshot: FinanceSnapshot = {
  ...emptySnapshot,
  workspace: {
    id: "813b2d5c-0c0c-4d23-9981-b2996bbdf503",
    name: "บ้านของมิน",
    kind: "private",
    baseCurrency: "THB",
    timeZone: "Asia/Bangkok",
    role: "owner",
    version: 1
  }
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function createDependencies(options: {
  session: CloudSession | null;
  snapshot?: FinanceSnapshot;
  snapshots?: FinanceSnapshot[];
  materialized?: Readonly<{
    createdCount: number;
    existingCount: number;
  }>;
  storage?: Storage;
  destinationStorage?: Storage;
  createPrivateWorkspace?: ReturnType<typeof vi.fn>;
  canManageInvitations?: boolean;
  canManageUsers?: boolean;
}) {
  let listener: ((next: CloudSession | null) => void) | undefined;
  const auth: CloudAuth = {
    getSession: vi.fn().mockResolvedValue(options.session),
    refreshSession: vi.fn(),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
    startLineSignIn: vi.fn(),
    updatePassword: vi.fn(),
    signOut: vi.fn(async () => {
      listener?.(null);
    })
  };
  const getSnapshot = vi.fn();
  const configuredSnapshots = options.snapshots ?? [
    options.snapshot ?? emptySnapshot
  ];
  for (const snapshot of configuredSnapshots) {
    getSnapshot.mockResolvedValueOnce(snapshot);
  }
  getSnapshot.mockResolvedValue(
    configuredSnapshots.at(-1) ?? emptySnapshot
  );
  const materializeRecurringPeriod = vi.fn().mockResolvedValue(
    options.materialized ?? {
      createdCount: 0,
      existingCount: 0
    }
  );
  const getFinancialPlan = vi.fn().mockResolvedValue({
    workspaceId: workspaceSnapshot.workspace!.id,
    month: toFinancialDate(
      new Date().toISOString(),
      workspaceSnapshot.workspace!.timeZone
    ).slice(0, 7),
    currency: "THB",
    totals: {
      baseBudget: "0.00",
      priorCarry: "0.00",
      available: "0.00",
      spent: "0.00",
      remaining: "0.00"
    },
    categories: [],
    goals: []
  });
  const createPrivateWorkspace =
    options.createPrivateWorkspace ??
    vi.fn().mockResolvedValue(undefined);
  const api = {
    getSnapshot,
    materializeRecurringPeriod,
    initializeBudgetMonth: vi.fn().mockResolvedValue({ createdCount: 0 }),
    getFinancialPlan,
    createPrivateWorkspace
  } as unknown as RemoteFinanceApi;
  const adminApi = {
    capabilities: vi.fn().mockResolvedValue({
      canManageInvitations:
        options.canManageInvitations ?? false,
      canManageUsers: options.canManageUsers ?? false
    }),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    replace: vi.fn(),
    revoke: vi.fn()
  } satisfies AdminInvitationApi;
  const publicInvitationApi = {
    inspect: vi.fn().mockResolvedValue({
      displayName: "Friend",
      maskedEmail: "fr***@example.test",
      status: "ready" as const
    }),
    redeem: vi.fn()
  } satisfies PublicInvitationApi;
  const userManagementApi = {
    list: vi.fn().mockResolvedValue({
      users: [],
      nextCursor: null
    }),
    confirm: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    sendPasswordReset: vi.fn(),
    delete: vi.fn()
  } satisfies UserManagementApi;
  const destinationStorage =
    options.destinationStorage ?? new MemoryStorage();
  const dependencies: CloudRouterDependencies = {
    storage: options.storage ?? new MemoryStorage(),
    destinationStorage,
    loadConfig: vi.fn().mockResolvedValue(config),
    createAuth: vi.fn(() => auth),
    createApi: vi.fn(() => api),
    createAdminApi: vi.fn(() => adminApi),
    createUserManagementApi: vi.fn(
      () => userManagementApi
    ),
    createPublicInvitationApi: vi.fn(
      () => publicInvitationApi
    )
  };
  return {
    auth,
    api,
    adminApi,
    publicInvitationApi,
    userManagementApi,
    dependencies,
    destinationStorage,
    createPrivateWorkspace,
    getSnapshot,
    materializeRecurringPeriod
  };
}

describe("cloud application flow", () => {
  it("starts LINE OAuth from an allowlisted rich-menu destination", async () => {
    const {
      auth,
      dependencies,
      destinationStorage
    } = createDependencies({ session: null });

    render(
      <MemoryRouter
        initialEntries={[
          "/line?next=%2Ftransactions%2Fnew%3Ftype%3Dincome"
        ]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(auth.startLineSignIn).toHaveBeenCalledWith(
        `${window.location.origin}/line/callback`
      );
    });
    expect(readLineDestination(destinationStorage)).toBe(
      "/transactions/new?type=income"
    );
  });

  it("falls back to overview before starting LINE OAuth for an external destination", async () => {
    const {
      auth,
      dependencies,
      destinationStorage
    } = createDependencies({ session: null });

    render(
      <MemoryRouter
        initialEntries={[
          "/line?next=https%3A%2F%2Fevil.example%2Faccounts"
        ]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(auth.startLineSignIn).toHaveBeenCalledOnce();
    });
    expect(readLineDestination(destinationStorage)).toBe("/overview");
  });

  it("opens an authenticated rich-menu destination without restarting LINE OAuth", async () => {
    const { auth, dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot
    });

    render(
      <MemoryRouter
        initialEntries={["/line?next=%2Faccounts"]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "บัญชีทั้งหมด" })
    ).toBeInTheDocument();
    expect(auth.startLineSignIn).not.toHaveBeenCalled();
  });

  it("continues a LINE callback to its stored destination", async () => {
    const destinationStorage = new MemoryStorage();
    destinationStorage.setItem(
      "baan-ngern-dee:line-destination:v1",
      "/accounts"
    );
    const { auth, dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot,
      destinationStorage
    });

    render(
      <MemoryRouter initialEntries={["/line/callback"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "บัญชีทั้งหมด" })
    ).toBeInTheDocument();
    expect(auth.startLineSignIn).not.toHaveBeenCalled();
  });

  it("creates a private workspace after LINE callback and then opens the stored destination", async () => {
    const lineSession: CloudSession = {
      ...session,
      email: undefined,
      displayName: "ลิน"
    };
    const destinationStorage = new MemoryStorage();
    destinationStorage.setItem(
      "baan-ngern-dee:line-destination:v1",
      "/accounts"
    );
    const {
      createPrivateWorkspace,
      dependencies,
      getSnapshot
    } = createDependencies({
      session: lineSession,
      snapshots: [emptySnapshot, workspaceSnapshot],
      destinationStorage
    });

    render(
      <MemoryRouter initialEntries={["/line/callback"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(createPrivateWorkspace).toHaveBeenCalledWith({
        name: "บ้านเงินของ ลิน",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      });
    });
    expect(
      await screen.findByRole("heading", { name: "บัญชีทั้งหมด" })
    ).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("shows a controlled retry when LINE workspace creation fails", async () => {
    const createPrivateWorkspace = vi
      .fn()
      .mockRejectedValue(new Error("failed"));
    const { dependencies } = createDependencies({
      session: { ...session, email: undefined },
      snapshot: emptySnapshot,
      createPrivateWorkspace
    });

    render(
      <MemoryRouter initialEntries={["/line/callback"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("ยังสร้างพื้นที่ส่วนตัวไม่สำเร็จ");
    expect(
      screen.getByRole("button", { name: "ลองอีกครั้ง" })
    ).toBeInTheDocument();
  });

  it("shows a controlled LINE callback failure while signed out without redirecting again", async () => {
    const { auth, dependencies } = createDependencies({
      session: null
    });

    render(
      <MemoryRouter initialEntries={["/line/callback"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", {
        name: "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ"
      })
    ).toBeInTheDocument();
    expect(auth.startLineSignIn).not.toHaveBeenCalled();
  });

  it("redirects the disabled financial planning route to overview", async () => {
    const { dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot
    });
    render(
      <MemoryRouter initialEntries={["/planning"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: /สวัสดี มิน/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "แผนการเงิน" })
    ).not.toBeInTheDocument();
  });

  it("routes a signed-out user to sign in after cloud boot", async () => {
    const { dependencies } = createDependencies({ session: null });
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("status", { name: "กำลังเชื่อมต่อระบบคลาวด์" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: "เข้าสู่บ้านเงินดี"
      })
    ).toBeInTheDocument();
  });

  it("routes a session with an empty snapshot to onboarding", async () => {
    const { dependencies } = createDependencies({ session });
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "สร้างพื้นที่ส่วนตัว" })
    ).toBeInTheDocument();
  });

  it("routes a session with a workspace to overview and removes only legacy keys", async () => {
    const storage = new MemoryStorage();
    storage.setItem("systems-credit:session:v1", "legacy-session");
    storage.setItem("systems-credit:finance:v1", "legacy-finance");
    storage.setItem("keep-me", "preserved");
    const { dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot,
      storage
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: /สวัสดี มิน/ })
    ).toBeInTheDocument();
    expect(screen.getByText("บ้านของมิน")).toBeInTheDocument();
    expect(storage.getItem("systems-credit:session:v1")).toBeNull();
    expect(storage.getItem("systems-credit:finance:v1")).toBeNull();
    expect(storage.getItem("keep-me")).toBe("preserved");
  });

  it("materializes the current workspace period and reloads a changed snapshot", async () => {
    const occurrenceSnapshot: FinanceSnapshot = {
      ...workspaceSnapshot,
      recurringOccurrences: [
        {
          id: "bf7c0791-164e-43d4-a572-1e91f76c135a",
          workspaceId: workspaceSnapshot.workspace!.id,
          templateId: "657867ab-90ea-4578-b9dd-474b4de6f559",
          name: "ค่าเช่า",
          kind: "expense",
          period: toFinancialDate(
            new Date().toISOString(),
            workspaceSnapshot.workspace!.timeZone
          ).slice(0, 7),
          scheduledDate: toFinancialDate(
            new Date().toISOString(),
            workspaceSnapshot.workspace!.timeZone
          ).slice(0, 7) + "-01",
          amount: "8000.00",
          currency: "THB",
          accountId: "5eb5d48f-94c3-4b4e-9564-9e66d31bb64e",
          categoryId: "3ae7b8fd-d151-4e2a-9cb1-bbca58e1bf63",
          status: "pending",
          version: 1
        }
      ]
    };
    const {
      dependencies,
      getSnapshot,
      materializeRecurringPeriod
    } = createDependencies({
      session,
      snapshots: [workspaceSnapshot, occurrenceSnapshot],
      materialized: { createdCount: 1, existingCount: 0 }
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: /สวัสดี มิน/ })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(2);
    });
    expect(materializeRecurringPeriod).toHaveBeenCalledWith({
      workspaceId: workspaceSnapshot.workspace!.id,
      period: toFinancialDate(
        new Date().toISOString(),
        workspaceSnapshot.workspace!.timeZone
      ).slice(0, 7)
    });
    expect(getSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      materializeRecurringPeriod.mock.invocationCallOrder[0]
    );
    expect(
      materializeRecurringPeriod.mock.invocationCallOrder[0]
    ).toBeLessThan(getSnapshot.mock.invocationCallOrder[1]);
  });

  it("does not reload the snapshot when the current period already exists", async () => {
    const {
      dependencies,
      getSnapshot,
      materializeRecurringPeriod
    } = createDependencies({
      session,
      snapshot: workspaceSnapshot,
      materialized: { createdCount: 0, existingCount: 2 }
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: /สวัสดี มิน/ })
    ).toBeInTheDocument();
    expect(materializeRecurringPeriod).toHaveBeenCalledOnce();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it("does not materialize before a workspace exists", async () => {
    const {
      dependencies,
      getSnapshot,
      materializeRecurringPeriod
    } = createDependencies({ session });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "สร้างพื้นที่ส่วนตัว" })
    ).toBeInTheDocument();
    expect(materializeRecurringPeriod).not.toHaveBeenCalled();
    expect(getSnapshot).toHaveBeenCalledOnce();
  });

  it("opens the recurring workspace and exposes its navigation link", async () => {
    const { dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot
    });

    render(
      <MemoryRouter initialEntries={["/recurring"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "รายการประจำ" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "รายการประจำ" })
    ).toHaveAttribute("href", "/recurring");
    expect(
      screen.getByRole("link", { name: "ประจำ" })
    ).toHaveAttribute("href", "/recurring");
  });

  it("keeps the public invitation route available while signed out", async () => {
    const { dependencies, publicInvitationApi } =
      createDependencies({ session: null });
    const token = "a".repeat(43);
    window.history.replaceState(
      null,
      "",
      `/accept-invite#token=${token}`
    );
    render(
      <MemoryRouter
        initialEntries={[`/accept-invite#token=${token}`]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(window.location.hash).toBe("");
    expect(
      await screen.findByRole("heading", {
        name: "ตั้งรหัสผ่านเพื่อเริ่มใช้งาน"
      })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(publicInvitationApi.inspect).toHaveBeenCalledWith(token);
    });
  });

  it("moves a redeemed recipient into private-workspace onboarding", async () => {
    const user = userEvent.setup();
    const {
      auth,
      dependencies,
      publicInvitationApi
    } = createDependencies({
      session: null,
      snapshot: emptySnapshot
    });
    const token = "c".repeat(43);
    vi.mocked(publicInvitationApi.redeem).mockResolvedValue({
      email: "friend@example.test"
    });
    vi.mocked(auth.signIn).mockResolvedValue({
      ...session,
      email: "friend@example.test",
      displayName: "Friend"
    });
    window.history.replaceState(
      null,
      "",
      `/accept-invite#token=${token}`
    );
    render(
      <MemoryRouter
        initialEntries={[`/accept-invite#token=${token}`]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await screen.findByText("Friend");
    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.click(
      screen.getByRole("button", {
        name: "สร้างบัญชีและเข้าสู่ระบบ"
      })
    );

    expect(
      await screen.findByRole("heading", {
        name: "สร้างพื้นที่ส่วนตัว"
      })
    ).toBeInTheDocument();
  });

  it("asks an authenticated user to sign out before accepting an invitation", async () => {
    const user = userEvent.setup();
    const {
      auth,
      dependencies,
      publicInvitationApi
    } = createDependencies({
      session,
      snapshot: workspaceSnapshot
    });
    const token = "b".repeat(43);
    window.history.replaceState(
      null,
      "",
      `/accept-invite#token=${token}`
    );
    render(
      <MemoryRouter
        initialEntries={[`/accept-invite#token=${token}`]}
      >
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await user.click(
      await screen.findByRole("button", {
        name: "ออกจากระบบเพื่อรับคำเชิญ"
      })
    );

    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "ตั้งรหัสผ่านเพื่อเริ่มใช้งาน"
      })
    ).toBeInTheDocument();
    expect(publicInvitationApi.inspect).toHaveBeenCalledWith(token);
  });

  it("opens invitation management only after the server grants the capability", async () => {
    const { adminApi, dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot,
      canManageInvitations: true
    });

    render(
      <MemoryRouter initialEntries={["/admin/invitations"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "คำเชิญผู้ใช้" })
    ).toBeInTheDocument();
    expect(adminApi.capabilities).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "คำเชิญผู้ใช้" })
    ).toHaveAttribute("href", "/admin/invitations");
  });

  it("opens user management only after the server grants its capability", async () => {
    const { adminApi, userManagementApi, dependencies } =
      createDependencies({
        session,
        snapshot: workspaceSnapshot,
        canManageUsers: true
      });

    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", {
        name: "จัดการผู้ใช้"
      })
    ).toBeInTheDocument();
    expect(adminApi.capabilities).toHaveBeenCalledOnce();
    expect(userManagementApi.list).toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "จัดการผู้ใช้" })
    ).toHaveAttribute("href", "/admin/users");
  });

  it("redirects an unauthorized user-management visit to overview", async () => {
    const { dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot,
      canManageUsers: false
    });

    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", {
        name: /สวัสดี/
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "จัดการผู้ใช้" })
    ).not.toBeInTheDocument();
  });

  it("passes the public Turnstile site key into sign-up", async () => {
    const renderTurnstile = vi.fn(() => "widget-1");
    window.turnstile = {
      render: renderTurnstile,
      remove: vi.fn(),
      reset: vi.fn()
    };
    const event = userEvent.setup();
    const { dependencies } = createDependencies({
      session: null
    });

    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );
    await event.click(
      await screen.findByRole("button", {
        name: "สมัครสมาชิก"
      })
    );

    await waitFor(() => {
      expect(renderTurnstile).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({
          sitekey: config.turnstileSiteKey
        })
      );
    });
    delete window.turnstile;
  });

  it("signs out through Supabase and returns to sign in", async () => {
    const user = userEvent.setup();
    const { auth, dependencies } = createDependencies({
      session,
      snapshot: workspaceSnapshot
    });
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes dependencies={dependencies} />
      </MemoryRouter>
    );

    await user.click(
      await screen.findByRole("button", { name: "ออกจากระบบ" })
    );

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", {
        name: "เข้าสู่บ้านเงินดี"
      })
    ).toBeInTheDocument();
  });
});
