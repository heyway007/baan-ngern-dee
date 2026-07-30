import { PROFILE_AVATAR_MAX_BYTES, type UserProfile } from "@systems-credit/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileApi } from "../../lib/profile-api";
import { ProfilePage } from "./profile-page";

const emailProfile: UserProfile = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "มิน",
  accountChannel: {
    kind: "email",
    label: "min.with.a.very.long.account@example.test"
  },
  avatar: { source: "initial", url: null }
};

const lineProfile: UserProfile = {
  ...emailProfile,
  accountChannel: { kind: "line", label: "LINE" }
};

const customProfile: UserProfile = {
  ...emailProfile,
  avatar: {
    source: "custom",
    url: "https://example.test/confirmed-avatar.webp"
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function profileApi(overrides: Partial<ProfileApi> = {}): ProfileApi {
  return {
    get: vi.fn().mockResolvedValue(emailProfile),
    update: vi.fn().mockResolvedValue(emailProfile),
    replaceAvatar: vi.fn().mockResolvedValue(emailProfile),
    removeAvatar: vi.fn().mockResolvedValue(emailProfile),
    ...overrides
  };
}

function renderPage(
  options: Partial<{
    profile: UserProfile;
    api: ProfileApi;
    loading: boolean;
    loadError: string;
    onRetry: () => void;
    onProfileChanged: (profile: UserProfile) => void;
  }> = {}
) {
  const props = {
    profile: options.profile ?? emailProfile,
    api: options.api ?? profileApi(),
    loading: options.loading ?? false,
    loadError: options.loadError,
    onRetry: options.onRetry ?? vi.fn(),
    onProfileChanged: options.onProfileChanged ?? vi.fn()
  };

  return { ...render(<ProfilePage {...props} />), props };
}

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue("blob:profile-preview"),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfilePage", () => {
  it.each([
    ["email", emailProfile, "min.with.a.very.long.account@example.test"],
    ["LINE", lineProfile, "LINE"]
  ])("shows the display name and read-only %s account channel", (_, profile, label) => {
    renderPage({ profile });

    expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("มิน");
    expect(
      screen.getByRole("group", { name: "ช่องทางเข้าสู่ระบบ" })
    ).toHaveTextContent(label);
    expect(screen.queryByRole("textbox", { name: label })).toBeNull();
  });

  it("saves a trimmed changed name and publishes only the server profile", async () => {
    const user = userEvent.setup();
    const pending = deferred<UserProfile>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const onProfileChanged = vi.fn();
    const serverProfile: UserProfile = {
      ...emailProfile,
      displayName: "มินใหม่"
    };
    renderPage({
      api: profileApi({ update }),
      onProfileChanged
    });

    const input = screen.getByLabelText("ชื่อที่แสดง");
    await user.clear(input);
    await user.type(input, "  มินใหม่  ");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));

    expect(update).toHaveBeenCalledWith({ displayName: "มินใหม่" });
    expect(onProfileChanged).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "กำลังบันทึกชื่อ" })
    ).toBeDisabled();

    pending.resolve(serverProfile);

    await waitFor(() => {
      expect(onProfileChanged).toHaveBeenCalledWith(serverProfile);
    });
    expect(input).toHaveValue("มินใหม่");
  });

  it("cross-disables mutation controls while preserving the read-only account channel", async () => {
    const user = userEvent.setup();
    const namePending = deferred<UserProfile>();
    const avatarPending = deferred<UserProfile>();
    renderPage({
      profile: customProfile,
      api: profileApi({
        update: vi.fn().mockReturnValue(namePending.promise),
        replaceAvatar: vi.fn().mockReturnValue(avatarPending.promise)
      })
    });

    const nameInput = screen.getByLabelText("ชื่อที่แสดง");
    const fileInput = screen.getByLabelText("เลือกรูปโปรไฟล์");
    const removeButton = screen.getByRole("button", { name: "ลบรูป" });
    await user.clear(nameInput);
    await user.type(nameInput, "มินใหม่");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));

    expect(fileInput).toBeDisabled();
    expect(removeButton).toBeDisabled();
    expect(
      screen.getByRole("group", { name: "ช่องทางเข้าสู่ระบบ" })
    ).toHaveTextContent(customProfile.accountChannel.label);

    namePending.resolve({
      ...customProfile,
      displayName: "มินใหม่"
    });
    await waitFor(() => expect(fileInput).toBeEnabled());

    await user.upload(
      fileInput,
      new File(["image"], "avatar.webp", { type: "image/webp" })
    );

    expect(nameInput).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "บันทึกชื่อ" })
    ).toBeDisabled();
    expect(removeButton).toBeDisabled();

    avatarPending.resolve(customProfile);
    await waitFor(() => expect(nameInput).toBeEnabled());
  });

  it("ignores a mutation completion from a prior profile user", async () => {
    const user = userEvent.setup();
    const pending = deferred<UserProfile>();
    const onProfileChanged = vi.fn();
    const { rerender, props } = renderPage({
      api: profileApi({
        update: vi.fn().mockReturnValue(pending.promise)
      }),
      onProfileChanged
    });
    const oldServerProfile: UserProfile = {
      ...emailProfile,
      displayName: "ชื่อจากคำขอเก่า"
    };
    const nextUserProfile: UserProfile = {
      ...lineProfile,
      userId: "22222222-2222-4222-8222-222222222222",
      displayName: "พลอย"
    };

    const input = screen.getByLabelText("ชื่อที่แสดง");
    await user.clear(input);
    await user.type(input, "ชื่อจากคำขอเก่า");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));

    rerender(<ProfilePage {...props} profile={nextUserProfile} />);
    await waitFor(() => expect(input).toHaveValue("พลอย"));

    await act(async () => {
      pending.resolve(oldServerProfile);
      await pending.promise;
    });

    expect(onProfileChanged).not.toHaveBeenCalled();
    expect(input).toHaveValue("พลอย");
    expect(input).toBeEnabled();
  });

  it("keeps the confirmed profile unchanged and shows a Thai alert after a failed save", async () => {
    const user = userEvent.setup();
    const onProfileChanged = vi.fn();
    renderPage({
      api: profileApi({
        update: vi.fn().mockRejectedValue(new Error("internal secret"))
      }),
      onProfileChanged
    });

    const input = screen.getByLabelText("ชื่อที่แสดง");
    await user.clear(input);
    await user.type(input, "ชื่อใหม่");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ไม่สามารถบันทึกชื่อได้ กรุณาลองใหม่"
    );
    expect(onProfileChanged).not.toHaveBeenCalled();
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toBeInTheDocument();
  });

  it("restricts the file picker to the supported image extensions", () => {
    renderPage();

    expect(screen.getByLabelText("เลือกรูปโปรไฟล์")).toHaveAttribute(
      "accept",
      ".jpg,.jpeg,.png,.webp"
    );
  });

  it("keeps the native file input keyboard reachable behind its visible label", async () => {
    const user = userEvent.setup();
    renderPage();

    const fileInput = screen.getByLabelText("เลือกรูปโปรไฟล์");
    expect(fileInput).not.toHaveAttribute("tabindex", "-1");
    expect(
      document.querySelector(
        'label[for="profile-avatar-file"]'
      )
    ).toHaveTextContent("เลือกรูป");

    await user.tab();

    expect(fileInput).toHaveFocus();
  });

  it("rejects an image over 2 MB before contacting the API", async () => {
    const user = userEvent.setup();
    const replaceAvatar = vi.fn();
    renderPage({ api: profileApi({ replaceAvatar }) });
    const oversizedImage = new File(
      [new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1)],
      "large.png",
      { type: "image/png" }
    );

    await user.upload(
      screen.getByLabelText("เลือกรูปโปรไฟล์"),
      oversizedImage
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB"
    );
    expect(replaceAvatar).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects an unsupported browser media type before contacting the API", async () => {
    const user = userEvent.setup({
      applyAccept: false
    });
    const replaceAvatar = vi.fn();
    renderPage({ api: profileApi({ replaceAvatar }) });

    await user.upload(
      screen.getByLabelText("เลือกรูปโปรไฟล์"),
      new File(["gif"], "avatar.gif", { type: "image/gif" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP"
    );
    expect(replaceAvatar).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows a local preview, then publishes the uploaded server profile and revokes the URL", async () => {
    const user = userEvent.setup();
    const pending = deferred<UserProfile>();
    const replaceAvatar = vi.fn().mockReturnValue(pending.promise);
    const onProfileChanged = vi.fn();
    const uploadedProfile: UserProfile = {
      ...emailProfile,
      avatar: {
        source: "custom",
        url: "https://example.test/server-avatar.webp"
      }
    };
    renderPage({
      api: profileApi({ replaceAvatar }),
      onProfileChanged
    });
    const image = new File(["image"], "avatar.webp", {
      type: "image/webp"
    });

    await user.upload(screen.getByLabelText("เลือกรูปโปรไฟล์"), image);

    expect(replaceAvatar).toHaveBeenCalledWith(image);
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveAttribute("src", "blob:profile-preview");
    expect(onProfileChanged).not.toHaveBeenCalled();

    pending.resolve(uploadedProfile);

    await waitFor(() => {
      expect(onProfileChanged).toHaveBeenCalledWith(uploadedProfile);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:profile-preview"
    );
  });

  it("discards and revokes a failed preview while keeping the confirmed avatar", async () => {
    const user = userEvent.setup();
    const onProfileChanged = vi.fn();
    renderPage({
      profile: customProfile,
      api: profileApi({
        replaceAvatar: vi.fn().mockRejectedValue(new Error("upload failed"))
      }),
      onProfileChanged
    });

    await user.upload(
      screen.getByLabelText("เลือกรูปโปรไฟล์"),
      new File(["image"], "avatar.jpg", { type: "image/jpeg" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ไม่สามารถอัปโหลดรูปโปรไฟล์ได้ กรุณาลองใหม่"
    );
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveAttribute(
      "src",
      "https://example.test/confirmed-avatar.webp"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:profile-preview"
    );
    expect(onProfileChanged).not.toHaveBeenCalled();
  });

  it("removes only a custom avatar and publishes the returned fallback", async () => {
    const user = userEvent.setup();
    const pending = deferred<UserProfile>();
    const removeAvatar = vi.fn().mockReturnValue(pending.promise);
    const onProfileChanged = vi.fn();
    renderPage({
      profile: customProfile,
      api: profileApi({ removeAvatar }),
      onProfileChanged
    });

    await user.click(screen.getByRole("button", { name: "ลบรูป" }));

    expect(onProfileChanged).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "กำลังลบรูป" })
    ).toBeDisabled();

    pending.resolve(emailProfile);

    await waitFor(() => {
      expect(onProfileChanged).toHaveBeenCalledWith(emailProfile);
    });
    expect(removeAvatar).toHaveBeenCalledOnce();
  });

  it("keeps the current fallback profile visible beside load error and retry states", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender, props } = renderPage({
      loading: true,
      onRetry
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "กำลังโหลดโปรไฟล์"
    );
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toHaveTextContent("ม");

    rerender(
      <ProfilePage
        {...props}
        loading={false}
        loadError="ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ กรุณาลองใหม่"
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ กรุณาลองใหม่"
    );
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ มิน" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("revokes a pending local preview when the page unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage({
      api: profileApi({
        replaceAvatar: vi.fn().mockReturnValue(new Promise(() => {}))
      })
    });

    await user.upload(
      screen.getByLabelText("เลือกรูปโปรไฟล์"),
      new File(["image"], "avatar.png", { type: "image/png" })
    );
    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:profile-preview"
    );
  });
});
