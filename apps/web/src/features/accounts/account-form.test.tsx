import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountForm } from "./account-form";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("AccountForm", () => {
  it("submits the original opening-balance decimal string", async () => {
    const user = userEvent.setup();
    const createAccount = vi.fn().mockResolvedValue({
      account: {
        id: "22222222-2222-4222-8222-222222222222",
        workspaceId,
        name: "บัญชีเงินเดือน",
        type: "bank",
        currency: "THB",
        version: 1
      },
      accountBalance: {
        accountId: "22222222-2222-4222-8222-222222222222",
        amount: "5000.50",
        currency: "THB"
      }
    });
    const onCreated = vi.fn();

    render(
      <AccountForm
        api={{ createAccount }}
        workspaceId={workspaceId}
        onCreated={onCreated}
      />
    );
    await user.type(
      screen.getByLabelText("ชื่อบัญชี"),
      "บัญชีเงินเดือน"
    );
    await user.selectOptions(screen.getByLabelText("ประเภทบัญชี"), "bank");
    await user.clear(screen.getByLabelText("ยอดตั้งต้น"));
    await user.type(screen.getByLabelText("ยอดตั้งต้น"), "5000.50");
    await user.type(
      screen.getByLabelText("ธนาคารหรือสถาบัน (ไม่บังคับ)"),
      "ธนาคารตัวอย่าง"
    );
    await user.click(
      screen.getByRole("button", { name: "เพิ่มบัญชี" })
    );

    expect(createAccount).toHaveBeenCalledWith({
      workspaceId,
      name: "บัญชีเงินเดือน",
      type: "bank",
      currency: "THB",
      institution: "ธนาคารตัวอย่าง",
      openingBalance: "5000.50"
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed money before calling the API", async () => {
    const user = userEvent.setup();
    const createAccount = vi.fn();

    render(
      <AccountForm
        api={{ createAccount }}
        workspaceId={workspaceId}
        onCreated={() => undefined}
      />
    );
    await user.type(screen.getByLabelText("ชื่อบัญชี"), "เงินสด");
    await user.clear(screen.getByLabelText("ยอดตั้งต้น"));
    await user.type(screen.getByLabelText("ยอดตั้งต้น"), "1,000");
    await user.click(
      screen.getByRole("button", { name: "เพิ่มบัญชี" })
    );

    expect(createAccount).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "กรอกจำนวนเงินเป็นตัวเลข"
    );
  });
});
