import type {
  AdminUser,
  AdminUserListResponse
} from "@systems-credit/contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserManagementApi } from "../../lib/user-management-api";
import { UserManagementApiFailure } from "../../lib/user-management-api";
import { UsersPage } from "./users-page";

const signedInUserId =
  "11111111-1111-4111-8111-111111111111";
const protectedUserId =
  "22222222-2222-4222-8222-222222222222";
const friendId = "33333333-3333-4333-8333-333333333333";
const lineUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mutationId = "44444444-4444-4444-8444-444444444444";

function userRow(
  overrides: Partial<AdminUser> = {}
): AdminUser {
  return {
    userId: friendId,
    email: "friend@example.test",
    displayName: "Friend",
    status: "active",
    createdAt: "2026-07-28T10:00:00.000Z",
    emailConfirmedAt: "2026-07-28T10:01:00.000Z",
    privateWorkspaceCount: 1,
    deletionPending: false,
    ...overrides
  };
}

function createApi(
  initial: AdminUserListResponse = {
    users: [userRow()],
    nextCursor: null
  }
): UserManagementApi {
  return {
    list: vi.fn().mockResolvedValue(initial),
    confirm: vi.fn().mockResolvedValue({ user: userRow() }),
    suspend: vi.fn().mockResolvedValue({
      user: userRow({ status: "suspended" })
    }),
    resume: vi.fn().mockResolvedValue({ user: userRow() }),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  };
}

function renderPage(api: UserManagementApi) {
  return render(
    <UsersPage
      api={api}
      signedInUserId={signedInUserId}
      protectedUserId={protectedUserId}
    />
  );
}

describe("Super Admin users page", () => {
  it("loads 25 users and shows status-specific controls", async () => {
    const rows = [
      userRow({
        status: "unconfirmed",
        emailConfirmedAt: undefined
      }),
      userRow({
        userId: "55555555-5555-4555-8555-555555555555",
        email: "active@example.test",
        status: "active"
      }),
      userRow({
        userId: "66666666-6666-4666-8666-666666666666",
        email: "suspended@example.test",
        status: "suspended"
      }),
      userRow({
        userId: "77777777-7777-4777-8777-777777777777",
        email: "pending@example.test",
        status: "deletion_pending",
        deletionPending: true
      }),
      ...Array.from({ length: 21 }, (_, index) =>
        userRow({
          userId: `90000000-0000-4000-8000-${String(
            index + 1
          ).padStart(12, "0")}`,
          email: `member-${index + 1}@example.test`,
          displayName: `Member ${index + 1}`
        })
      )
    ];
    const api = createApi({ users: rows, nextCursor: null });

    renderPage(api);

    expect(
      screen.getByRole("status", { name: "กำลังโหลดผู้ใช้" })
    ).toBeInTheDocument();
    expect(await screen.findByText("ยังไม่ยืนยัน")).toBeInTheDocument();
    expect(screen.getAllByText("ใช้งานอยู่")[0]).toBeInTheDocument();
    expect(screen.getByText("ระงับ")).toBeInTheDocument();
    expect(screen.getByText("กำลังลบ")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({
      search: "",
      limit: 25
    });
    expect(screen.getAllByRole("row")).toHaveLength(26);

    const unconfirmed = screen
      .getByText("friend@example.test")
      .closest("tr")!;
    expect(
      withinRow(unconfirmed, "ยืนยันบัญชี")
    ).toBeInTheDocument();
    expect(withinRow(unconfirmed, "ระงับบัญชี")).toBeInTheDocument();

    const suspended = screen
      .getByText("suspended@example.test")
      .closest("tr")!;
    expect(withinRow(suspended, "เปิดใช้งาน")).toBeInTheDocument();
    expect(
      suspended.querySelector('[aria-label="ยืนยันบัญชี"]')
    ).toBeNull();
  });

  it("debounces search, resets its cursor, and opens the next page", async () => {
    const api = createApi({
      users: [userRow()],
      nextCursor:
        `2026-07-28T10:00:00.000Z|${friendId}`
    });
    vi.mocked(api.list)
      .mockResolvedValueOnce({
        users: [userRow()],
        nextCursor:
          `2026-07-28T10:00:00.000Z|${friendId}`
      })
      .mockResolvedValueOnce({
        users: [userRow()],
        nextCursor:
          `2026-07-28T10:00:00.000Z|${friendId}`
      })
      .mockResolvedValueOnce({
        users: [userRow()],
        nextCursor: null
      });
    const event = userEvent.setup();

    renderPage(api);
    await screen.findByText("friend@example.test");
    await event.type(
      screen.getByRole("searchbox", {
        name: "ค้นหาชื่อ อีเมล หรือรหัสผู้ใช้"
      }),
      "  FRIEND "
    );
    await waitFor(
      () => {
        expect(api.list).toHaveBeenLastCalledWith({
          search: "friend",
          limit: 25
        });
      },
      { timeout: 1000 }
    );

    await event.click(
      screen.getByRole("button", { name: "หน้าถัดไป" })
    );
    await waitFor(() => {
      expect(api.list).toHaveBeenLastCalledWith({
        search: "friend",
        limit: 25,
        cursor:
          `2026-07-28T10:00:00.000Z|${friendId}`
      });
    });
  });

  it("confirms reset intent and reports success without a token", async () => {
    const api = createApi();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);
    const event = userEvent.setup();

    renderPage(api);
    await event.click(
      await screen.findByRole("button", {
        name: "ส่งรีเซ็ตรหัสผ่าน"
      })
    );

    expect(confirm).toHaveBeenCalled();
    expect(api.sendPasswordReset).toHaveBeenCalledWith(friendId);
    expect(
      await screen.findByRole("status", {
        name: "ส่งอีเมลรีเซ็ตรหัสผ่านแล้ว"
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it("protects signed-in/configured users and requires exact email to delete", async () => {
    const rows = [
      userRow({
        userId: signedInUserId,
        email: "admin@example.test"
      }),
      userRow({
        userId: protectedUserId,
        email: "protected@example.test"
      }),
      userRow()
    ];
    const api = createApi({ users: rows, nextCursor: null });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mutationId);
    const event = userEvent.setup();

    renderPage(api);
    await screen.findByText("friend@example.test");
    expect(
      screen
        .getByText("admin@example.test")
        .closest("tr")!
        .querySelector<HTMLButtonElement>(
          '[aria-label="ลบบัญชีถาวร"]'
        )
    ).toBeDisabled();
    expect(
      screen
        .getByText("protected@example.test")
        .closest("tr")!
        .querySelector<HTMLButtonElement>(
          '[aria-label="ลบบัญชีถาวร"]'
        )
    ).toBeDisabled();

    const friendRow = screen
      .getByText("friend@example.test")
      .closest("tr")!;
    await event.click(withinRow(friendRow, "ลบบัญชีถาวร"));
    const dialog = screen.getByRole("dialog", {
      name: "ลบบัญชี friend@example.test"
    });
    const deleteButton = dialog.querySelector<HTMLButtonElement>(
      ".danger-confirm-submit"
    )!;
    expect(deleteButton).toBeDisabled();
    await event.type(
      screen.getByLabelText("พิมพ์อีเมลเพื่อยืนยัน"),
      "FRIEND@EXAMPLE.TEST"
    );
    expect(deleteButton).toBeEnabled();
    await event.click(deleteButton);

    expect(api.delete).toHaveBeenCalledWith(friendId, {
      confirmation: "friend@example.test",
      clientMutationId: mutationId
    });
    await waitFor(() => {
      expect(api.list).toHaveBeenLastCalledWith({
        search: "",
        limit: 25
      });
    });
  });

  it("labels an email-less LINE identity, hides email actions, and requires its exact UUID to delete", async () => {
    const lineUser = userRow({
      userId: lineUserId,
      email: undefined,
      emailConfirmedAt: undefined,
      displayName: "มิน LINE"
    });
    const api = createApi({
      users: [lineUser],
      nextCursor: null
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mutationId);
    const event = userEvent.setup();

    renderPage(api);
    const lineIdentity = await screen.findByText("บัญชี LINE");
    const row = lineIdentity.closest("tr")!;
    expect(row).toHaveTextContent(lineUserId);
    expect(
      row.querySelector('[aria-label="ยืนยันบัญชี"]')
    ).toBeNull();
    expect(
      row.querySelector('[aria-label="ส่งรีเซ็ตรหัสผ่าน"]')
    ).toBeNull();
    expect(withinRow(row, "ระงับบัญชี")).toBeEnabled();

    await event.click(withinRow(row, "ลบบัญชีถาวร"));
    const dialog = screen.getByRole("dialog", {
      name: `ลบบัญชี LINE ${lineUserId}`
    });
    const confirmation = screen.getByLabelText(
      "พิมพ์รหัสผู้ใช้เพื่อยืนยัน"
    );
    const deleteButton = dialog.querySelector<HTMLButtonElement>(
      ".danger-confirm-submit"
    )!;

    await event.type(confirmation, lineUserId.toUpperCase());
    expect(deleteButton).toBeDisabled();
    await event.clear(confirmation);
    await event.type(confirmation, `LINE ${lineUserId}`);
    expect(deleteButton).toBeEnabled();
    await event.click(deleteButton);

    expect(api.delete).toHaveBeenCalledWith(lineUserId, {
      confirmation: lineUserId,
      clientMutationId: mutationId
    });
  });

  it("explains shared-data conflicts and disables controls while pending", async () => {
    let rejectDelete!: (error: unknown) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectDelete = reject;
    });
    const api = createApi();
    vi.mocked(api.delete).mockReturnValue(pending);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mutationId);
    const event = userEvent.setup();

    renderPage(api);
    const friendRow = (await screen.findByText("friend@example.test"))
      .closest("tr")!;
    await event.click(withinRow(friendRow, "ลบบัญชีถาวร"));
    await event.type(
      screen.getByLabelText("พิมพ์อีเมลเพื่อยืนยัน"),
      "friend@example.test"
    );
    await event.click(
      screen.getByRole("button", { name: "ยืนยันลบบัญชีถาวร" })
    );
    expect(
      screen.getByRole("button", {
        name: "ยืนยันลบบัญชีถาวร"
      })
    ).toBeDisabled();

    rejectDelete(
      new UserManagementApiFailure(
        "USER_SHARED_DATA_CONFLICT",
        "conflict",
        "request-1"
      )
    );
    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent(
      "โอนความเป็นเจ้าของ สมาชิก หรือประวัติในพื้นที่ครอบครัว"
    );
  });
});

function withinRow(
  row: Element,
  label: string
): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`
  );
  if (!button) throw new Error(`Missing ${label}`);
  return button;
}
