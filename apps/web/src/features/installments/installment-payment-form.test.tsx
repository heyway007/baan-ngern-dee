import {
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account } from "@systems-credit/contracts";
import type {
  LocalInstallmentContract,
  LocalInstallmentScheduleRow
} from "../../lib/local-finance-api";
import { InstallmentPaymentForm } from "./installment-payment-form";

const workspaceId = "52d3fbcb-c083-42dd-87d0-62a66e337fd0";
const accountId = "ad304c0f-7371-41d4-bd2c-a6bb34c4aeb7";

const account: Account = {
  id: accountId,
  workspaceId,
  name: "บัญชีเงินเดือน",
  type: "bank",
  currency: "THB",
  version: 1
};

const contract = {
  id: "f8212dc2-bba0-46e2-a381-c39a134b2bc7",
  workspaceId,
  name: "สินเชื่อทดสอบ",
  kind: "debt",
  originalPrincipal: "100.00",
  downPayment: "0.00",
  financedPrincipal: "100.00",
  financedFees: "5.00",
  currency: "THB",
  interestMethod: "manual",
  annualRate: "0",
  periods: 1,
  firstDueDate: "2026-08-15",
  status: "active",
  version: 1
} satisfies LocalInstallmentContract;

const row = {
  sequence: 1,
  dueDate: "2026-08-15",
  openingPrincipal: "100.00",
  principal: "100.00",
  interest: "20.00",
  fees: "5.00",
  total: "125.00",
  closingPrincipal: "0.00",
  scheduledPenalty: "0.00",
  paidPrincipal: "0.00",
  paidInterest: "0.00",
  paidFees: "0.00",
  paidPenalty: "0.00",
  status: "upcoming"
} satisfies LocalInstallmentScheduleRow;

describe("InstallmentPaymentForm", () => {
  it("previews exact allocation and posts only after explicit confirmation", async () => {
    const user = userEvent.setup();
    const postInstallmentPayment = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        paymentId: crypto.randomUUID(),
        allocation: {
          penalty: "10.00",
          fees: "5.00",
          interest: "20.00",
          principal: "0.00",
          total: "35.00"
        },
        reportableExpense: "35.00",
        scheduleStatus: "partially_paid",
        contractStatus: "active",
        accountBalance: {
          accountId,
          amount: "965.00",
          currency: "THB"
        },
        expenseTransactionId: crypto.randomUUID()
      });
    const onPosted = vi.fn();
    render(
      <InstallmentPaymentForm
        api={{ postInstallmentPayment }}
        contract={contract}
        row={row}
        accounts={[account]}
        onPosted={onPosted}
      />
    );

    const amount = screen.getByLabelText("จำนวนเงินที่ชำระ");
    await user.clear(amount);
    await user.type(amount, "35.00");
    const penalty = screen.getByLabelText("ค่าปรับเพิ่ม");
    await user.clear(penalty);
    await user.type(penalty, "10.00");

    const preview = screen.getByRole("status", {
      name: "การจัดสรรยอดชำระ"
    });
    expect(within(preview).getByText("฿10.00")).toBeInTheDocument();
    expect(within(preview).getByText("฿5.00")).toBeInTheDocument();
    expect(within(preview).getByText("฿20.00")).toBeInTheDocument();
    expect(within(preview).getByText("฿0.00")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "บันทึกการชำระ" })
    );
    expect(postInstallmentPayment).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "กรุณายืนยันว่าชำระเงินจริงแล้ว"
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: "ยืนยันว่าชำระเงินจริงแล้ว"
      })
    );
    await user.click(
      screen.getByRole("button", { name: "บันทึกการชำระ" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังบันทึกการชำระไม่ได้"
    );
    const firstMutationId =
      postInstallmentPayment.mock.calls[0]![0].clientMutationId;
    await user.click(
      screen.getByRole("button", { name: "บันทึกการชำระ" })
    );
    await waitFor(() =>
      expect(postInstallmentPayment).toHaveBeenCalledTimes(2)
    );
    expect(
      postInstallmentPayment.mock.calls[1]![0].clientMutationId
    ).toBe(firstMutationId);
    await user.click(
      screen.getByRole("button", { name: "บันทึกการชำระ" })
    );
    await waitFor(() =>
      expect(postInstallmentPayment).toHaveBeenCalledTimes(3)
    );
    expect(
      postInstallmentPayment.mock.calls[2]![0].clientMutationId
    ).not.toBe(firstMutationId);

    expect(postInstallmentPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        contractId: contract.id,
        sequence: 1,
        accountId,
        amount: "35.00",
        penaltyAmount: "10.00",
        currency: "THB"
      })
    );
    expect(onPosted).toHaveBeenCalledTimes(2);
  });
});
