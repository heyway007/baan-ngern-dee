import type {
  AdminInvitation,
  CreateInvitationResponse
} from "@systems-credit/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdminInvitationApi
} from "../../lib/invitation-api";
import { InvitationsPage } from "./invitations-page";

const readyInvitation: AdminInvitation = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "person@example.test",
  displayName: "Person",
  status: "ready",
  createdAt: "2026-07-27T10:00:00.000Z",
  expiresAt: "2026-07-28T10:00:00.000Z"
};

const newInvitation: AdminInvitation = {
  ...readyInvitation,
  id: "44444444-4444-4444-8444-444444444444",
  email: "friend@example.test",
  displayName: "Friend"
};

const invitationUrl =
  `https://app.example/accept-invite#token=${"a".repeat(43)}`;

function createApi(
  invitations: readonly AdminInvitation[] = [readyInvitation]
) {
  const created: CreateInvitationResponse = {
    invitation: newInvitation,
    invitationUrl
  };
  return {
    capabilities: vi.fn(),
    list: vi.fn().mockResolvedValue(invitations),
    create: vi.fn().mockResolvedValue(created),
    replace: vi.fn().mockResolvedValue(created),
    revoke: vi.fn().mockResolvedValue(undefined)
  } satisfies AdminInvitationApi;
}

describe("InvitationsPage", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("creates an invitation and copies its one-time link", async () => {
    const user = userEvent.setup();
    const api = createApi([]);
    render(<InvitationsPage api={api} />);

    await user.type(
      screen.getByLabelText("ชื่อผู้รับ"),
      "Friend"
    );
    await user.type(
      screen.getByLabelText("อีเมลผู้รับ"),
      "friend@example.test"
    );
    await user.click(
      screen.getByRole("button", {
        name: "สร้างลิงก์เชิญ"
      })
    );

    expect(api.create).toHaveBeenCalledWith({
      displayName: "Friend",
      email: "friend@example.test"
    });
    expect(
      await screen.findByText(invitationUrl)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "ลิงก์นี้จะแสดงครั้งเดียว กรุณาคัดลอกก่อนปิด"
      )
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "คัดลอกลิงก์" })
    );
    expect(await navigator.clipboard.readText()).toBe(invitationUrl);
  });

  it("shows every invitation status as a Thai label", async () => {
    const statuses: AdminInvitation[] = [
      readyInvitation,
      { ...readyInvitation, id: crypto.randomUUID(), status: "busy" },
      {
        ...readyInvitation,
        id: crypto.randomUUID(),
        status: "redeemed",
        redeemedAt: "2026-07-27T11:00:00.000Z"
      },
      { ...readyInvitation, id: crypto.randomUUID(), status: "expired" },
      {
        ...readyInvitation,
        id: crypto.randomUUID(),
        status: "revoked",
        revokedAt: "2026-07-27T11:00:00.000Z"
      }
    ];
    render(<InvitationsPage api={createApi(statuses)} />);

    for (const label of [
      "พร้อมใช้",
      "กำลังดำเนินการ",
      "ใช้แล้ว",
      "หมดอายุ",
      "ยกเลิก"
    ]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
  });

  it("revokes an eligible invitation after confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<InvitationsPage api={api} />);

    await user.click(
      await screen.findByRole("button", {
        name: "ยกเลิกคำเชิญ Person"
      })
    );

    expect(window.confirm).toHaveBeenCalled();
    expect(api.revoke).toHaveBeenCalledWith(readyInvitation.id);
    await waitFor(() => {
      expect(screen.getByText("ยกเลิก")).toBeInTheDocument();
    });
  });

  it("replaces an invitation and reveals the new link once", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<InvitationsPage api={api} />);

    await user.click(
      await screen.findByRole("button", {
        name: "สร้างลิงก์ใหม่ให้ Person"
      })
    );

    expect(api.replace).toHaveBeenCalledWith(readyInvitation.id);
    expect(
      await screen.findByText(invitationUrl)
    ).toBeInTheDocument();
  });
});
