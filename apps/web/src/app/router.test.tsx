import type {
  FinanceSnapshot,
  PublicAppConfig
} from "@systems-credit/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type {
  CloudAuth,
  CloudSession
} from "../lib/cloud-auth";
import type {
  RemoteFinanceApi
} from "../lib/remote-finance-api";
import {
  FinanceRoutes,
  type CloudRouterDependencies
} from "./router";

const config: PublicAppConfig = {
  supabaseUrl: "https://project.supabase.co",
  supabasePublishableKey: "sb_publishable_public"
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
  recurringOccurrences: []
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
  storage?: Storage;
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
    updatePassword: vi.fn(),
    signOut: vi.fn(async () => {
      listener?.(null);
    })
  };
  const api = {
    getSnapshot: vi.fn().mockResolvedValue(
      options.snapshot ?? emptySnapshot
    )
  } as unknown as RemoteFinanceApi;
  const dependencies: CloudRouterDependencies = {
    storage: options.storage ?? new MemoryStorage(),
    loadConfig: vi.fn().mockResolvedValue(config),
    createAuth: vi.fn(() => auth),
    createApi: vi.fn(() => api)
  };
  return { auth, api, dependencies };
}

describe("cloud application flow", () => {
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
