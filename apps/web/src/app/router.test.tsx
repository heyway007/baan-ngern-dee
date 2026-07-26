import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FinanceRoutes } from "./router";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local application flow", () => {
  it("continues from local sign-in through onboarding to overview", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FinanceRoutes storage={new MemoryStorage()} />
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มิน");
    await user.click(
      screen.getByRole("button", { name: "เริ่มใช้งานบนเครื่องนี้" })
    );
    expect(
      screen.getByRole("heading", { name: "สร้างพื้นที่ส่วนตัว" })
    ).toBeInTheDocument();

    const workspaceName = screen.getByLabelText("ชื่อพื้นที่ส่วนตัว");
    await user.clear(workspaceName);
    await user.type(workspaceName, "บ้านของมิน");
    await user.click(
      screen.getByRole("button", { name: "สร้างพื้นที่" })
    );

    expect(
      await screen.findByRole("heading", { name: /สวัสดี มิน/ })
    ).toBeInTheDocument();
    expect(screen.getByText("บ้านของมิน")).toBeInTheDocument();
  });
});
