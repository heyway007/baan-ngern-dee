import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { CloudSession } from "../lib/cloud-auth";
import { AppLayout } from "./layout";

const session: CloudSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  displayName: "Admin",
  accessToken: "access-token"
};

describe("AppLayout invitation navigation", () => {
  it("links to the integrated financial plan", () => {
    render(
      <MemoryRouter>
        <AppLayout session={session} onSignOut={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", { name: "แผนการเงิน" })
    ).toHaveAttribute("href", "/planning");
  });

  it("hides invitation management without the server capability", () => {
    render(
      <MemoryRouter>
        <AppLayout
          session={session}
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
          session={session}
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
          session={session}
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
          session={session}
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
});
