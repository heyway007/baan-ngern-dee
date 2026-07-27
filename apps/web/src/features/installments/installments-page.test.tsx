import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type {
  LocalFinanceApi,
  LocalFinanceSnapshot
} from "../../lib/local-finance-api";
import { InstallmentsPage } from "./installments-page";

const workspaceId = "52d3fbcb-c083-42dd-87d0-62a66e337fd0";

describe("InstallmentsPage", () => {
  it("returns from the new route to the contract list after creation", async () => {
    const user = userEvent.setup();
    const createInstallmentContract = vi.fn().mockResolvedValue({
      contract: {
        id: crypto.randomUUID(),
        workspaceId,
        name: "หนี้ทดสอบ",
        kind: "debt",
        originalPrincipal: "1000.00",
        downPayment: "0.00",
        financedPrincipal: "1000.00",
        financedFees: "0.00",
        currency: "THB",
        interestMethod: "zero",
        annualRate: "0",
        periods: 12,
        firstDueDate: "2026-08-15",
        status: "active",
        version: 1
      },
      schedule: []
    });
    const api = {
      createInstallmentContract
    } as unknown as LocalFinanceApi;
    const snapshot: LocalFinanceSnapshot = {
      version: 1,
      workspace: {
        id: workspaceId,
        name: "การเงินทดสอบ",
        kind: "private",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok",
        role: "owner",
        version: 1
      },
      categories: [],
      accounts: [],
      accountBalances: {},
      openingTransactions: [],
      transactions: [],
      installmentContracts: [],
      installmentSchedules: {}
    };

    render(
      <MemoryRouter initialEntries={["/installments/new"]}>
        <Routes>
          <Route
            path="/installments/new"
            element={
              <InstallmentsPage
                api={api}
                snapshot={snapshot}
                onChanged={vi.fn()}
                initiallyOpen
              />
            }
          />
          <Route path="/installments" element={<h1>รายการสัญญา</h1>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(
      screen.getByLabelText("ชื่อรายการผ่อนหรือหนี้"),
      "หนี้ทดสอบ"
    );
    const principal = screen.getByLabelText("ราคาสินค้า/เงินต้นเดิม");
    await user.clear(principal);
    await user.type(principal, "1000.00");
    await user.click(
      screen.getByRole("button", { name: "สร้างตารางผ่อน" })
    );

    expect(
      await screen.findByRole("heading", { name: "รายการสัญญา" })
    ).toBeInTheDocument();
  });
});
