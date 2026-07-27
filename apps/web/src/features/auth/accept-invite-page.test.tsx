import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CloudSession
} from "../../lib/cloud-auth";
import {
  RemoteInvitationError,
  type PublicInvitationApi
} from "../../lib/invitation-api";
import { AcceptInvitePage } from "./accept-invite-page";

const token = "a".repeat(43);
const session: CloudSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "friend@example.test",
  displayName: "Friend",
  accessToken: "access-token"
};

function createApi() {
  return {
    inspect: vi.fn().mockResolvedValue({
      displayName: "Friend",
      maskedEmail: "fr***@example.test",
      status: "ready" as const
    }),
    redeem: vi.fn().mockResolvedValue({
      email: "friend@example.test"
    })
  } satisfies PublicInvitationApi;
}

describe("AcceptInvitePage", () => {
  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      `/accept-invite#token=${token}`
    );
  });

  it("shows safe invitation details for the supplied token", async () => {
    const api = createApi();
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token={token}
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByText("Friend")).toBeInTheDocument();
    expect(screen.getByText("fr***@example.test")).toBeInTheDocument();
    expect(api.inspect).toHaveBeenCalledWith(token);
  });

  it("requires a matching password of at least eight characters", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token={token}
        onAuthenticated={vi.fn()}
      />
    );
    await screen.findByText("Friend");

    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "short"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "other"
    );
    await user.click(
      screen.getByRole("button", {
        name: "สร้างบัญชีและเข้าสู่ระบบ"
      })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"
    );
    expect(api.redeem).not.toHaveBeenCalled();
  });

  it("rejects a mismatched password confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token={token}
        onAuthenticated={vi.fn()}
      />
    );
    await screen.findByText("Friend");

    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "different-password"
    );
    await user.click(
      screen.getByRole("button", {
        name: "สร้างบัญชีและเข้าสู่ระบบ"
      })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "รหัสผ่านทั้งสองช่องไม่ตรงกัน"
    );
    expect(api.redeem).not.toHaveBeenCalled();
  });

  it("redeems, signs in, and hands the authenticated session to the app", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const signIn = vi.fn().mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn }}
        token={token}
        onAuthenticated={onAuthenticated}
      />
    );
    await screen.findByText("Friend");

    await user.type(
      screen.getByLabelText("รหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่าน"),
      "correct-horse-battery"
    );
    await user.click(
      screen.getByRole("button", {
        name: "สร้างบัญชีและเข้าสู่ระบบ"
      })
    );

    expect(api.redeem).toHaveBeenCalledWith({
      token,
      password: "correct-horse-battery"
    });
    expect(signIn).toHaveBeenCalledWith({
      email: "friend@example.test",
      password: "correct-horse-battery"
    });
    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith(session);
    });
  });

  it("shows a safe message when the invitation expired", async () => {
    const api = createApi();
    api.inspect.mockRejectedValue(
      new RemoteInvitationError(
        "INVITATION_EXPIRED",
        410,
        "INVITATION_EXPIRED"
      )
    );
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token={token}
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ลิงก์คำเชิญหมดอายุแล้ว"
    );
  });

  it("shows a safe message when the invitation was already used", async () => {
    const api = createApi();
    api.inspect.mockRejectedValue(
      new RemoteInvitationError(
        "INVITATION_REDEEMED",
        409,
        "INVITATION_REDEEMED"
      )
    );
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token={token}
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ลิงก์คำเชิญนี้ถูกใช้แล้ว"
    );
  });

  it("asks the recipient to reopen a link after refreshing without its fragment", async () => {
    const api = createApi();
    window.history.replaceState(null, "", "/accept-invite");
    render(
      <AcceptInvitePage
        api={api}
        auth={{ signIn: vi.fn() }}
        token=""
        onAuthenticated={vi.fn()}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ลิงก์คำเชิญไม่ถูกต้อง"
    );
    expect(api.inspect).not.toHaveBeenCalled();
  });
});
