import type {
  FinanceSnapshot,
  RecurringOccurrence,
  RecurringTemplate
} from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { RecurringPage } from "./recurring-page";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const currentPeriod = toFinancialDate(
  new Date().toISOString(),
  "Asia/Bangkok"
).slice(0, 7);

const currentOccurrence: RecurringOccurrence = {
  id: "44444444-4444-4444-8444-444444444444",
  workspaceId,
  templateId: "55555555-5555-4555-8555-555555555555",
  name: "ค่าเช่าปัจจุบัน",
  kind: "expense",
  period: currentPeriod,
  scheduledDate: `${currentPeriod}-01`,
  amount: "8000.00",
  currency: "THB",
  accountId,
  categoryId,
  status: "pending",
  version: 1
};

const activeTemplate: RecurringTemplate = {
  id: currentOccurrence.templateId,
  workspaceId,
  name: "ค่าเช่าปัจจุบัน",
  kind: "expense",
  amount: "8000.00",
  currency: "THB",
  accountId,
  categoryId,
  dayOfMonth: 1,
  startMonth: currentPeriod,
  status: "active",
  version: 2
};

const snapshot: FinanceSnapshot = {
  version: 1,
  workspace: {
    id: workspaceId,
    name: "บ้านของมิน",
    kind: "private",
    baseCurrency: "THB",
    timeZone: "Asia/Bangkok",
    role: "owner",
    version: 1
  },
  categories: [
    {
      id: categoryId,
      workspaceId,
      slug: "housing",
      name: "ที่อยู่อาศัย",
      kind: "expense",
      isDefault: true,
      version: 1
    }
  ],
  accounts: [
    {
      id: accountId,
      workspaceId,
      name: "บัญชีหลัก",
      type: "bank",
      currency: "THB",
      version: 1
    }
  ],
  accountBalances: {},
  openingTransactions: [],
  transactions: [],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [activeTemplate],
  recurringOccurrences: [currentOccurrence]
};

function previousPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  return previous.toISOString().slice(0, 7);
}

function createApi(overrides: Partial<FinanceApi> = {}) {
  return {
    getRecurringPeriod: vi.fn().mockResolvedValue({
      period: previousPeriod(currentPeriod),
      occurrences: []
    }),
    materializeRecurringPeriod: vi.fn().mockResolvedValue({
      createdCount: 0,
      existingCount: 1
    }),
    pauseRecurringTemplate: vi.fn().mockResolvedValue({
      ...activeTemplate,
      status: "paused",
      version: 3
    }),
    resumeRecurringTemplate: vi.fn(),
    cancelRecurringTemplate: vi.fn(),
    createRecurringTemplate: vi.fn(),
    updateRecurringTemplate: vi.fn(),
    updateRecurringOccurrence: vi.fn(),
    skipRecurringOccurrence: vi.fn(),
    postRecurringOccurrence: vi.fn(),
    ...overrides
  } as unknown as FinanceApi;
}

describe("RecurringPage", () => {
  it("uses current snapshot occurrences without a history request", () => {
    const api = createApi();
    render(
      <RecurringPage api={api} snapshot={snapshot} onChanged={vi.fn()} />
    );

    expect(
      screen.getByRole("heading", { name: "รายการประจำ" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("ค่าเช่าปัจจุบัน")).toHaveLength(2);
    expect(api.getRecurringPeriod).not.toHaveBeenCalled();
    expect(api.materializeRecurringPeriod).not.toHaveBeenCalled();
    expect(screen.getByLabelText("เดือนที่แสดง")).toHaveAttribute(
      "max",
      currentPeriod
    );
  });

  it("loads a past month as read-only history", async () => {
    const user = userEvent.setup();
    const pastPeriod = previousPeriod(currentPeriod);
    const pastOccurrence: RecurringOccurrence = {
      ...currentOccurrence,
      id: "66666666-6666-4666-8666-666666666666",
      name: "ค่าเช่าเดือนก่อน",
      period: pastPeriod,
      scheduledDate: `${pastPeriod}-01`,
      status: "skipped"
    };
    const getRecurringPeriod = vi.fn().mockResolvedValue({
      period: pastPeriod,
      occurrences: [pastOccurrence]
    });
    const api = createApi({ getRecurringPeriod });
    render(
      <RecurringPage api={api} snapshot={snapshot} onChanged={vi.fn()} />
    );

    await user.clear(screen.getByLabelText("เดือนที่แสดง"));
    await user.type(screen.getByLabelText("เดือนที่แสดง"), pastPeriod);

    expect(
      await screen.findByText("ค่าเช่าเดือนก่อน")
    ).toBeInTheDocument();
    expect(getRecurringPeriod).toHaveBeenCalledWith(
      workspaceId,
      pastPeriod
    );
    expect(
      screen.queryByRole("button", {
        name: "จ่ายแล้ว ค่าเช่าเดือนก่อน"
      })
    ).not.toBeInTheDocument();
    expect(api.materializeRecurringPeriod).not.toHaveBeenCalled();
  });

  it("materializes and refreshes after a template lifecycle change", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <RecurringPage
        api={api}
        snapshot={snapshot}
        onChanged={onChanged}
      />
    );

    await user.click(
      screen.getByRole("button", {
        name: "พัก ค่าเช่าปัจจุบัน"
      })
    );

    await waitFor(() => {
      expect(api.materializeRecurringPeriod).toHaveBeenCalledWith({
        workspaceId,
        period: currentPeriod
      });
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
