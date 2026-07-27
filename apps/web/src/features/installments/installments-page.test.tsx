import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { FinanceSnapshot } from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
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
    } as unknown as FinanceApi;
    const snapshot: FinanceSnapshot = {
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
      installmentSchedules: {},
      installmentPayments: [],
      installmentPayoffs: []
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

  it("opens the payment form for the next unpaid installment", async () => {
    const user = userEvent.setup();
    const contractId = "f8212dc2-bba0-46e2-a381-c39a134b2bc7";
    const accountId = "ad304c0f-7371-41d4-bd2c-a6bb34c4aeb7";
    const snapshot: FinanceSnapshot = {
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
      accounts: [
        {
          id: accountId,
          workspaceId,
          name: "บัญชีเงินเดือน",
          type: "bank",
          currency: "THB",
          version: 1
        }
      ],
      accountBalances: {
        [accountId]: {
          accountId,
          amount: "1000.00",
          currency: "THB"
        }
      },
      openingTransactions: [],
      transactions: [],
      installmentContracts: [
        {
          id: contractId,
          workspaceId,
          name: "สินเชื่อทดสอบ",
          kind: "debt",
          originalPrincipal: "100.00",
          downPayment: "0.00",
          financedPrincipal: "100.00",
          financedFees: "0.00",
          currency: "THB",
          interestMethod: "zero",
          annualRate: "0",
          periods: 1,
          firstDueDate: "2026-08-15",
          status: "active",
          version: 1
        }
      ],
      installmentSchedules: {
        [contractId]: [
          {
            sequence: 1,
            dueDate: "2026-08-15",
            openingPrincipal: "100.00",
            principal: "100.00",
            interest: "0.00",
            fees: "0.00",
            total: "100.00",
            closingPrincipal: "0.00",
            scheduledPenalty: "0.00",
            paidPrincipal: "0.00",
            paidInterest: "0.00",
            paidFees: "0.00",
            paidPenalty: "0.00",
            status: "upcoming"
          }
        ]
      },
      installmentPayments: [],
      installmentPayoffs: []
    };
    const api = {
      postInstallmentPayment: vi.fn()
    } as unknown as FinanceApi;

    render(
      <MemoryRouter initialEntries={["/installments"]}>
        <InstallmentsPage
          api={api}
          snapshot={snapshot}
          onChanged={vi.fn()}
        />
      </MemoryRouter>
    );

    await user.click(
      screen.getByRole("button", { name: "ชำระงวดที่ 1" })
    );
    expect(
      screen.getByRole("heading", { name: "บันทึกการชำระ" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("บัญชีที่ใช้ชำระ")).toHaveValue(
      accountId
    );

    await user.click(
      screen.getByRole("button", { name: "ชำระงวดที่ 1" })
    );
    await user.click(
      screen.getByRole("button", { name: "โปะหรือปิดยอด" })
    );
    expect(
      screen.getByRole("heading", {
        name: "โปะเงินต้นหรือปิดยอด"
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("บัญชีที่ใช้ชำระ")).toHaveValue(
      accountId
    );
  });
});
