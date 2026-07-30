import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UserProfile } from "@systems-credit/contracts";
import { AppLayout } from "./layout";

const profile: UserProfile = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Admin",
  accountChannel: {
    kind: "email",
    label: "admin@example.test"
  },
  avatar: {
    source: "custom",
    url: "https://example.test/admin-avatar.webp"
  }
};

describe("AppLayout invitation navigation", () => {
  it("hides financial planning while the feature is disabled", () => {
    render(
      <MemoryRouter>
        <AppLayout profile={profile} onSignOut={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole("link", { name: "แผนการเงิน" })
    ).not.toBeInTheDocument();
  });

  it("hides invitation management without the server capability", () => {
    render(
      <MemoryRouter>
        <AppLayout
          profile={profile}
          canManageInvitations={false}
          onSignOut={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole("link", {
        name: "คำเชิญผู้ใช้"
      })
    ).not.toBeInTheDocument();
  });

  it("hides user management without the server capability", () => {
    render(
      <MemoryRouter>
        <AppLayout
          profile={profile}
          canManageUsers={false}
          onSignOut={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole("link", { name: "จัดการผู้ใช้" })
    ).not.toBeInTheDocument();
  });

  it("shows user management with the server capability", () => {
    render(
      <MemoryRouter>
        <AppLayout
          profile={profile}
          canManageUsers
          onSignOut={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", { name: "จัดการผู้ใช้" })
    ).toHaveAttribute("href", "/admin/users");
  });

  it("shows invitation management with the server capability", () => {
    render(
      <MemoryRouter>
        <AppLayout
          profile={profile}
          canManageInvitations
          onSignOut={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", {
        name: "คำเชิญผู้ใช้"
      })
    ).toHaveAttribute("href", "/admin/invitations");
  });

  it("links desktop and mobile profile controls to the profile route", () => {
    render(
      <MemoryRouter>
        <AppLayout profile={profile} onSignOut={vi.fn()} />
      </MemoryRouter>
    );

    const desktopProfile = screen.getByRole("link", {
      name: "เปิดโปรไฟล์"
    });
    const mobileSettings = screen.getByRole("link", {
      name: "ตั้งค่า"
    });

    expect(desktopProfile).toHaveAttribute("href", "/profile");
    expect(mobileSettings).toHaveAttribute("href", "/profile");
    expect(desktopProfile).toHaveClass("profile-row");
    expect(mobileSettings).toHaveClass("icon-button");
  });

  it("renders the effective profile name and avatar", () => {
    render(
      <MemoryRouter>
        <AppLayout profile={profile} onSignOut={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", { name: "เปิดโปรไฟล์" })
    ).toHaveTextContent("Admin");
    expect(
      screen.getByRole("img", { name: "รูปโปรไฟล์ของ Admin" })
    ).toHaveAttribute(
      "src",
      "https://example.test/admin-avatar.webp"
    );
  });
});
