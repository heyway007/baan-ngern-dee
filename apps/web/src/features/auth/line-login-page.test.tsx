import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  LINE_DESTINATION_KEY,
  readLineDestination
} from "./line-entry";
import {
  LineLoginFailurePage,
  LineLoginPage
} from "./line-login-page";

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

describe("LineLoginPage", () => {
  it("stores the destination and starts LINE OAuth once", async () => {
    const auth = { startLineSignIn: vi.fn().mockResolvedValue(undefined) };
    const storage = new MemoryStorage();

    render(
      <StrictMode>
        <LineLoginPage
          auth={auth}
          destination="/accounts"
          destinationStorage={storage}
          callbackUrl="https://app.example.test/line/callback"
        />
      </StrictMode>
    );

    await waitFor(() => {
      expect(auth.startLineSignIn).toHaveBeenCalledOnce();
    });
    expect(auth.startLineSignIn).toHaveBeenCalledWith(
      "https://app.example.test/line/callback"
    );
    expect(readLineDestination(storage)).toBe("/accounts");
  });

  it("shows a controlled error and retries LINE OAuth once", async () => {
    const user = userEvent.setup();
    const auth = {
      startLineSignIn: vi
        .fn()
        .mockRejectedValueOnce(new Error("sensitive provider failure"))
        .mockResolvedValueOnce(undefined)
    };

    render(
      <LineLoginPage
        auth={auth}
        destination="/installments"
        destinationStorage={new MemoryStorage()}
        callbackUrl="https://app.example.test/line/callback"
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังเข้าสู่ระบบด้วย LINE ไม่สำเร็จ"
    );
    expect(screen.queryByText("sensitive provider failure")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));

    await waitFor(() => {
      expect(auth.startLineSignIn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("LineLoginFailurePage", () => {
  it("returns to the same safe destination or the legacy sign-in page", () => {
    render(<LineLoginFailurePage destination="/transactions/new?type=expense" />);

    expect(screen.getByRole("link", { name: "ลองเข้าสู่ระบบด้วย LINE อีกครั้ง" }))
      .toHaveAttribute(
        "href",
        "/line?next=%2Ftransactions%2Fnew%3Ftype%3Dexpense"
      );
    expect(screen.getByRole("link", { name: "เข้าสู่ระบบด้วยอีเมล" })).toHaveAttribute(
      "href",
      "/sign-in"
    );
  });
});
