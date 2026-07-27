import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResetPasswordPage } from "./reset-password-page";

describe("ResetPasswordPage", () => {
  it("updates a matching new password", async () => {
    const user = userEvent.setup();
    const updatePassword = vi.fn().mockResolvedValue(undefined);
    render(
      <ResetPasswordPage
        auth={{ updatePassword }}
        onComplete={vi.fn()}
      />
    );

    const password = screen.getByLabelText("รหัสผ่านใหม่");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await user.type(password, "correct-horse-battery");
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่านใหม่"),
      "correct-horse-battery"
    );
    await user.click(
      screen.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" })
    );

    expect(updatePassword).toHaveBeenCalledWith(
      "correct-horse-battery"
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "เปลี่ยนรหัสผ่านแล้ว"
    );
  });

  it("does not update when password confirmation differs", async () => {
    const user = userEvent.setup();
    const updatePassword = vi.fn();
    render(
      <ResetPasswordPage
        auth={{ updatePassword }}
        onComplete={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("รหัสผ่านใหม่"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่านใหม่"),
      "different-password"
    );
    await user.click(
      screen.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" })
    );

    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "รหัสผ่านทั้งสองช่องไม่ตรงกัน"
    );
  });
});
