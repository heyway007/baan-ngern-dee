import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CloudAuth,
  CloudSession
} from "../../lib/cloud-auth";
import { CloudAuthFailure } from "../../lib/cloud-auth";
import { SignInPage } from "./sign-in-page";

vi.mock("./turnstile-widget", () => ({
  TurnstileWidget: ({
    onToken
  }: {
    onToken(token: string): void;
  }) => (
    <button
      type="button"
      onClick={() => onToken("turnstile-token")}
    >
      ผ่านการตรวจสอบความปลอดภัย
    </button>
  )
}));

const session: CloudSession = {
  userId: "9c585235-f409-4764-b4ad-f1da4d500290",
  email: "min@example.test",
  displayName: "มิน",
  accessToken: "access-token"
};

function authActions() {
  return {
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn()
  } satisfies Pick<
    CloudAuth,
    "signIn" | "signUp" | "requestPasswordReset"
  >;
}

describe("SignInPage", () => {
  it("links LINE login from account modes and hides it during reset", async () => {
    const user = userEvent.setup();
    render(
      <SignInPage
        auth={authActions()}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    const lineLogin = screen.getByRole("link", {
      name: "เข้าสู่ระบบด้วย LINE"
    });
    expect(lineLogin).toHaveAttribute(
      "href",
      "/line?next=/overview"
    );

    await user.click(
      screen.getByRole("button", { name: "สมัครสมาชิก" })
    );
    expect(
      screen.getByRole("link", {
        name: "เข้าสู่ระบบด้วย LINE"
      })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "ลืมรหัสผ่าน" })
    );
    expect(
      screen.queryByRole("link", {
        name: "เข้าสู่ระบบด้วย LINE"
      })
    ).not.toBeInTheDocument();
  });

  it("signs in with email/password and disables the pending action", async () => {
    const user = userEvent.setup();
    let resolveSignIn:
      | ((value: CloudSession) => void)
      | undefined;
    const auth = authActions();
    auth.signIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        })
    );
    const onAuthenticated = vi.fn();
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={onAuthenticated}
      />
    );

    const email = screen.getByLabelText("อีเมล");
    const password = screen.getByLabelText("รหัสผ่าน");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute(
      "autocomplete",
      "current-password"
    );

    await user.type(email, "min@example.test");
    await user.type(password, "correct-horse-battery");
    await user.click(
      screen.getByRole("button", { name: "เข้าสู่ระบบ" })
    );

    expect(
      screen.getByRole("button", { name: "กำลังเข้าสู่ระบบ…" })
    ).toBeDisabled();
    resolveSignIn?.(session);
    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(session)
    );
    expect(auth.signIn).toHaveBeenCalledWith({
      email: "min@example.test",
      password: "correct-horse-battery"
    });
  });

  it("signs up with matching passwords and authenticates immediately", async () => {
    const user = userEvent.setup();
    const auth = authActions();
    auth.signUp.mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={onAuthenticated}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "สมัครสมาชิก" })
    );
    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มิน");
    await user.type(
      screen.getByLabelText("อีเมล"),
      "min@example.test"
    );
    const password = screen.getByLabelText("รหัสผ่าน");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await user.type(password, "correct-horse-battery");
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.click(
      screen.getByRole("button", {
        name: "ผ่านการตรวจสอบความปลอดภัย"
      })
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างบัญชี" })
    );

    expect(auth.signUp).toHaveBeenCalledWith({
      displayName: "มิน",
      email: "min@example.test",
      password: "correct-horse-battery",
      captchaToken: "turnstile-token"
    });
    expect(onAuthenticated).toHaveBeenCalledWith(session);
    expect(password).toHaveValue("");
    expect(screen.getByLabelText("ยืนยันรหัสผ่าน")).toHaveValue("");
  });

  it("orders sign-up fields for visual and keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <SignInPage
        auth={authActions()}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "สมัครสมาชิก" })
    );

    const controls = [
      screen.getByLabelText("ชื่อที่แสดง"),
      screen.getByLabelText("อีเมล"),
      screen.getByLabelText("รหัสผ่าน"),
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      screen.getByRole("button", {
        name: "ผ่านการตรวจสอบความปลอดภัย"
      }),
      screen.getByRole("button", { name: "สร้างบัญชี" })
    ];

    for (
      let index = 0;
      index < controls.length - 1;
      index += 1
    ) {
      expect(
        controls[index]!.compareDocumentPosition(
          controls[index + 1]!
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("rejects mismatched password confirmation before signup", async () => {
    const user = userEvent.setup();
    const auth = authActions();
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "สมัครสมาชิก" })
    );
    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มิน");
    await user.type(
      screen.getByLabelText("อีเมล"),
      "min@example.test"
    );
    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "different-password"
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างบัญชี" })
    );

    expect(auth.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "รหัสผ่านไม่ตรงกัน"
    );
  });

  it("requires a Turnstile token before signup", async () => {
    const user = userEvent.setup();
    const auth = authActions();
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "สมัครสมาชิก" })
    );
    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มิน");
    await user.type(
      screen.getByLabelText("อีเมล"),
      "min@example.test"
    );
    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างบัญชี" })
    );

    expect(auth.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "กรุณาผ่านการตรวจสอบความปลอดภัย"
    );
  });

  it("requests a password-reset email", async () => {
    const user = userEvent.setup();
    const auth = authActions();
    auth.requestPasswordReset.mockResolvedValue(undefined);
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "ลืมรหัสผ่าน" })
    );
    await user.type(
      screen.getByLabelText("อีเมล"),
      "min@example.test"
    );
    await user.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" })
    );

    expect(auth.requestPasswordReset).toHaveBeenCalledWith(
      "min@example.test",
      `${window.location.origin}/reset-password`
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "ส่งลิงก์แล้ว"
    );
  });

  it("shows a Thai error when Supabase rejects sign in", async () => {
    const user = userEvent.setup();
    const auth = authActions();
    auth.signIn.mockRejectedValue(
      new CloudAuthFailure("AUTH_INVALID_CREDENTIALS")
    );
    render(
      <SignInPage
        auth={auth}
        turnstileSiteKey="turnstile-site-key"
        onAuthenticated={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("อีเมล"),
      "min@example.test"
    );
    await user.type(screen.getByLabelText("รหัสผ่าน"), "wrong-pass");
    await user.click(
      screen.getByRole("button", { name: "เข้าสู่ระบบ" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
    );
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveValue("");
  });
});
