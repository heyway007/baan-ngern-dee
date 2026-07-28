import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MonthlyTransactionTable } from "./monthly-transaction-table";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const categoryId = "30000000-0000-4000-8000-000000000003";

const account: Account = {
  id: accountId,
  workspaceId,
  name: "บัญชีหลัก",
  type: "bank",
  currency: "THB",
  version: 1
};

const category: Category = {
  id: categoryId,
  workspaceId,
  slug: "salary",
  name: "เงินเดือน",
  kind: "income",
  isDefault: true,
  version: 1
};

function transaction(
  index: number,
  overrides: Partial<FinanceTransaction> = {}
): FinanceTransaction {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workspaceId,
    accountId,
    type: index % 2 === 0 ? "expense" : "income",
    amount: index % 2 === 0 ? "25.00" : "100.00",
    currency: "THB",
    financialDate: `2026-07-${String(index).padStart(2, "0")}`,
    categoryId,
    note: `รายการ ${index}`,
    tagIds: [],
    state: "posted",
    version: 1,
    createdAt: `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    ...overrides
  };
}

function renderTable(
  props: Partial<ComponentProps<typeof MonthlyTransactionTable>> = {}
) {
  const onMonthChange = vi.fn();
  const rendered = render(
    <MemoryRouter>
      <MonthlyTransactionTable
        month="2026-07"
        transactions={[]}
        accounts={[account]}
        categories={[category]}
        onMonthChange={onMonthChange}
        {...props}
      />
    </MemoryRouter>
  );
  return { onMonthChange, ...rendered };
}

describe("MonthlyTransactionTable", () => {
  it("changes the selected month from its accessible controls", async () => {
    const user = userEvent.setup();
    const { onMonthChange, unmount } = renderTable();

    expect(
      screen.getByRole("heading", { name: "รายการประจำเดือน" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "เดือนก่อนหน้า" })
    ).toBeInTheDocument();
    const monthInput = screen.getByLabelText("เลือกเดือน");
    expect(monthInput).toHaveValue("2026-07");
    expect(
      screen.getByRole("button", { name: "เดือนถัดไป" })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "เดือนก่อนหน้า" })
    );
    await user.click(
      screen.getByRole("button", { name: "เดือนถัดไป" })
    );
    expect(onMonthChange).toHaveBeenNthCalledWith(1, "2026-06");
    expect(onMonthChange).toHaveBeenNthCalledWith(2, "2026-08");

    unmount();
    const onInputMonthChange = vi.fn();
    function MonthInputHarness() {
      const [month, setMonth] = useState("2026-07");
      return (
        <MemoryRouter>
          <MonthlyTransactionTable
            month={month}
            transactions={[]}
            accounts={[account]}
            categories={[category]}
            onMonthChange={(nextMonth) => {
              onInputMonthChange(nextMonth);
              setMonth(nextMonth);
            }}
          />
        </MemoryRouter>
      );
    }

    render(<MonthInputHarness />);
    const monthPicker = screen.getByLabelText("เลือกเดือน");
    fireEvent.change(monthPicker, { target: { value: "2026-08" } });

    expect(onInputMonthChange).toHaveBeenCalledWith("2026-08");
    expect(monthPicker).toHaveValue("2026-08");
  });

  it("paginates newest rows while retaining monthly totals in the footer", async () => {
    const user = userEvent.setup();
    const transactions = Array.from({ length: 12 }, (_, index) =>
      transaction(index + 1, index === 11 ? { categoryId: undefined } : {})
    );
    renderTable({ transactions });

    expect(screen.getByText("รายการ 12")).toBeInTheDocument();
    expect(screen.getByText("รายการ 3")).toBeInTheDocument();
    expect(screen.queryByText("รายการ 2")).not.toBeInTheDocument();

    const footer = screen.getByRole("row", { name: /รวม/ });
    expect(within(footer).getByText("฿600.00")).toBeInTheDocument();
    expect(within(footer).getByText("฿150.00")).toBeInTheDocument();
    expect(within(footer).getByText("฿450.00")).toBeInTheDocument();
    expect(screen.getByText("หน้า 1 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));

    expect(screen.getByText("รายการ 2")).toBeInTheDocument();
    expect(screen.getByText("รายการ 1")).toBeInTheDocument();
    expect(screen.queryByText("รายการ 12")).not.toBeInTheDocument();
    expect(screen.getByText("หน้า 2 / 2")).toBeInTheDocument();
  });

  it("resets pagination when its month prop changes", async () => {
    const user = userEvent.setup();
    const july = Array.from({ length: 12 }, (_, index) => transaction(index + 1));
    const august = Array.from({ length: 12 }, (_, index) =>
      transaction(index + 1, {
        financialDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        note: `สิงหาคม ${index + 1}`,
        createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      })
    );

    function Harness() {
      const [month, setMonth] = useState("2026-07");
      return (
        <MemoryRouter>
          <button type="button" onClick={() => setMonth("2026-08")}>
            เปลี่ยนเดือน
          </button>
          <MonthlyTransactionTable
            month={month}
            transactions={[...july, ...august]}
            accounts={[account]}
            categories={[category]}
            onMonthChange={setMonth}
          />
        </MemoryRouter>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    expect(screen.getByText("หน้า 2 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เปลี่ยนเดือน" }));

    expect(screen.getByText("สิงหาคม 12")).toBeInTheDocument();
    expect(screen.getByText("หน้า 1 / 2")).toBeInTheDocument();
  });

  it("keeps month controls and the transactions link available for an empty month", () => {
    renderTable({ transactions: [transaction(1, { financialDate: "2026-06-01" })] });

    expect(
      screen.getByText("ยังไม่มีรายการในเดือนนี้")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("เลือกเดือน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เดือนก่อนหน้า" })).toBeEnabled();
    expect(screen.getByRole("link", { name: /ดูรายการทั้งหมด/ })).toHaveAttribute(
      "href",
      "/transactions"
    );
  });

  it("labels every body cell with its matching table column for stacked layouts", () => {
    renderTable({ transactions: [transaction(1)] });

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    const row = screen.getByText("รายการ 1").closest("tr");

    expect(row).not.toBeNull();
    expect(
      within(row as HTMLTableRowElement)
        .getAllByRole("cell")
        .map((cell) => cell.getAttribute("data-label"))
    ).toEqual(headers);
  });
});
