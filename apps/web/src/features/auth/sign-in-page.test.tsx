import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignInPage } from "./sign-in-page";

describe("SignInPage", () => {
  it("starts an explicitly local session with a display name", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInPage onSignIn={onSignIn} />);

    expect(
      screen.getByText(/ไม่ใช่การล็อกอินสำหรับระบบออนไลน์/)
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มิน");
    await user.click(
      screen.getByRole("button", { name: "เริ่มใช้งานบนเครื่องนี้" })
    );

    expect(onSignIn).toHaveBeenCalledWith("มิน");
  });
});
