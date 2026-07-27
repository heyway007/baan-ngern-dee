import {
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallmentForm } from "./installment-form";

describe("InstallmentForm", () => {
  it("submits original strings and exact financed principal for a flat-rate purchase", async () => {
    const user = userEvent.setup();
    const createInstallmentContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        contract: {
          id: crypto.randomUUID(),
          name: "โทรศัพท์",
          financedPrincipal: "10000.00",
          status: "active"
        },
        schedule: []
      });
    render(
      <InstallmentForm
        api={{ createInstallmentContract }}
        workspaceId="52d3fbcb-c083-42dd-87d0-62a66e337fd0"
        accounts={[]}
        categories={[]}
        onCreated={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText("ชื่อรายการผ่อนหรือหนี้"), "โทรศัพท์");
    await user.clear(screen.getByLabelText("ราคาสินค้า/เงินต้นเดิม"));
    await user.type(screen.getByLabelText("ราคาสินค้า/เงินต้นเดิม"), "12000.00");
    await user.clear(screen.getByLabelText("เงินดาวน์"));
    await user.type(screen.getByLabelText("เงินดาวน์"), "2000.00");
    await user.selectOptions(screen.getByLabelText("วิธีคิดดอกเบี้ย"), "flat");
    await user.clear(screen.getByLabelText("ดอกเบี้ยต่อปี (%)"));
    await user.type(screen.getByLabelText("ดอกเบี้ยต่อปี (%)"), "12");
    await user.clear(screen.getByLabelText("จำนวนงวด"));
    await user.type(screen.getByLabelText("จำนวนงวด"), "10");
    await user.clear(screen.getByLabelText("วันครบกำหนดงวดแรก"));
    await user.type(screen.getByLabelText("วันครบกำหนดงวดแรก"), "2026-08-15");
    await user.click(screen.getByRole("button", { name: "สร้างตารางผ่อน" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const firstMutationId =
      createInstallmentContract.mock.calls[0]![1];
    await user.click(
      screen.getByRole("button", { name: "สร้างตารางผ่อน" })
    );
    await waitFor(() =>
      expect(createInstallmentContract).toHaveBeenCalledTimes(2)
    );
    expect(createInstallmentContract.mock.calls[1]![1]).toBe(
      firstMutationId
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างตารางผ่อน" })
    );
    await waitFor(() =>
      expect(createInstallmentContract).toHaveBeenCalledTimes(3)
    );
    expect(createInstallmentContract.mock.calls[2]![1]).not.toBe(
      firstMutationId
    );

    expect(createInstallmentContract).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "โทรศัพท์",
        originalPrincipal: "12000.00",
        downPayment: "2000.00",
        interestMethod: "flat",
        annualRate: "12",
        periods: 10,
        firstDueDate: "2026-08-15"
      }),
      expect.any(String)
    );
    expect(
      within(screen.getByRole("status")).getByText("฿10,000.00")
    ).toBeInTheDocument();
  });

  it("submits exact creditor rows for a manual schedule", async () => {
    const user = userEvent.setup();
    const createInstallmentContract = vi.fn().mockResolvedValue({
      contract: {
        id: crypto.randomUUID(),
        name: "หนี้ร้านค้า",
        financedPrincipal: "1000.00",
        status: "active"
      },
      schedule: []
    });
    render(
      <InstallmentForm
        api={{ createInstallmentContract }}
        workspaceId="52d3fbcb-c083-42dd-87d0-62a66e337fd0"
        accounts={[]}
        categories={[]}
        onCreated={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("ชื่อรายการผ่อนหรือหนี้"),
      "หนี้ร้านค้า"
    );
    const principal = screen.getByLabelText("ราคาสินค้า/เงินต้นเดิม");
    await user.clear(principal);
    await user.type(principal, "1000.00");
    const firstDueDate = screen.getByLabelText("วันครบกำหนดงวดแรก");
    await user.clear(firstDueDate);
    await user.type(firstDueDate, "2026-08-15");
    await user.selectOptions(
      screen.getByLabelText("วิธีคิดดอกเบี้ย"),
      "manual"
    );

    expect(screen.getByLabelText("เงินต้นงวดที่ 1")).toHaveValue("1000.00");
    await user.click(screen.getByRole("button", { name: "เพิ่มงวด" }));
    await user.clear(screen.getByLabelText("เงินต้นงวดที่ 1"));
    await user.type(screen.getByLabelText("เงินต้นงวดที่ 1"), "400.00");
    await user.clear(screen.getByLabelText("เงินต้นงวดที่ 2"));
    await user.type(screen.getByLabelText("เงินต้นงวดที่ 2"), "600.00");
    await user.clear(screen.getByLabelText("วันครบกำหนดงวดที่ 2"));
    await user.type(
      screen.getByLabelText("วันครบกำหนดงวดที่ 2"),
      "2026-09-15"
    );
    await user.clear(screen.getByLabelText("ดอกเบี้ยงวดที่ 1"));
    await user.type(screen.getByLabelText("ดอกเบี้ยงวดที่ 1"), "25.00");
    expect(
      screen.getByRole("heading", { name: "2 งวด" })
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "สร้างตารางผ่อน" })
    );

    expect(createInstallmentContract).toHaveBeenCalledWith(
      expect.objectContaining({
        interestMethod: "manual",
        periods: 2,
        firstDueDate: "2026-08-15",
        manualRows: [
          {
            dueDate: "2026-08-15",
            principal: "400.00",
            interest: "25.00",
            fees: "0.00"
          },
          {
            dueDate: "2026-09-15",
            principal: "600.00",
            interest: "0.00",
            fees: "0.00"
          }
        ]
      }),
      expect.any(String)
    );
  });
});
