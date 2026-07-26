import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SessionGuard } from "./session-guard";

function renderGuard(
  session: { displayName: string } | null,
  hasWorkspace: boolean
) {
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <Routes>
        <Route path="/sign-in" element={<p>หน้าเริ่มต้น Local</p>} />
        <Route path="/onboarding" element={<p>ตั้งค่าพื้นที่</p>} />
        <Route
          element={
            <SessionGuard
              session={session}
              hasWorkspace={hasWorkspace}
            />
          }
        >
          <Route path="/overview" element={<p>ภาพรวมของฉัน</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("SessionGuard", () => {
  it("sends a visitor without local session to sign in", () => {
    renderGuard(null, false);
    expect(screen.getByText("หน้าเริ่มต้น Local")).toBeInTheDocument();
  });

  it("sends a local user without workspace to onboarding", () => {
    renderGuard({ displayName: "มิน" }, false);
    expect(screen.getByText("ตั้งค่าพื้นที่")).toBeInTheDocument();
  });

  it("shows protected content after local setup", () => {
    renderGuard({ displayName: "มิน" }, true);
    expect(screen.getByText("ภาพรวมของฉัน")).toBeInTheDocument();
  });
});
