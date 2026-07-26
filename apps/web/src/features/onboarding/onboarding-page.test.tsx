import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OnboardingPage } from "./onboarding-page";

describe("OnboardingPage", () => {
  it("creates a THB private workspace before showing account setup", async () => {
    const user = userEvent.setup();
    const createPrivateWorkspace = vi.fn().mockResolvedValue({
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "การเงินของฉัน",
        kind: "private",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok",
        role: "owner",
        version: 1
      },
      categories: []
    });
    const onComplete = vi.fn();

    render(
      <OnboardingPage
        api={{ createPrivateWorkspace }}
        onComplete={onComplete}
      />
    );
    await user.clear(screen.getByLabelText("ชื่อพื้นที่ส่วนตัว"));
    await user.type(
      screen.getByLabelText("ชื่อพื้นที่ส่วนตัว"),
      "บ้านของเรา"
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างพื้นที่" })
    );

    expect(createPrivateWorkspace).toHaveBeenCalledWith({
      name: "บ้านของเรา",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111"
      })
    );
  });

  it("shows an actionable Thai error when local creation fails", async () => {
    const user = userEvent.setup();
    const createPrivateWorkspace = vi
      .fn()
      .mockRejectedValue(new Error("storage failed"));

    render(
      <OnboardingPage
        api={{ createPrivateWorkspace }}
        onComplete={() => undefined}
      />
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างพื้นที่" })
    );

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("ยังสร้างพื้นที่ไม่ได้");
  });
});
