import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { CloudSession } from "../../lib/cloud-auth";
import { LINE_DESTINATION_KEY } from "./line-entry";
import { LineWorkspacePage } from "./line-workspace-page";

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

const lineSession: CloudSession = {
  userId: "9c585235-f409-4764-b4ad-f1da4d500290",
  displayName: "ผู้ใช้ LINE",
  accessToken: "access-token"
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderedBootstrap(options: {
  hasWorkspace: boolean;
  session?: CloudSession;
  api: { createPrivateWorkspace: ReturnType<typeof vi.fn> };
  destination?: "/overview" | "/accounts" | "/installments";
  storage: MemoryStorage;
  onWorkspaceChanged: ReturnType<typeof vi.fn>;
}) {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={["/line"]}>
        <LineWorkspacePage
          session={options.session ?? lineSession}
          hasWorkspace={options.hasWorkspace}
          api={options.api}
          destination={options.destination ?? "/overview"}
          destinationStorage={options.storage}
          onWorkspaceChanged={options.onWorkspaceChanged}
        />
        <LocationProbe />
      </MemoryRouter>
    </StrictMode>
  );
}

function renderBootstrap(options: Partial<{
  hasWorkspace: boolean;
  session: CloudSession;
  api: { createPrivateWorkspace: ReturnType<typeof vi.fn> };
  destination: "/overview" | "/accounts" | "/installments";
  storage: MemoryStorage;
  onWorkspaceChanged: ReturnType<typeof vi.fn>;
}> = {}) {
  const api = options.api ?? {
    createPrivateWorkspace: vi.fn().mockResolvedValue(undefined)
  };
  const storage = options.storage ?? new MemoryStorage();
  const onWorkspaceChanged = options.onWorkspaceChanged ?? vi.fn().mockResolvedValue(undefined);
  const props = {
    hasWorkspace: options.hasWorkspace ?? false,
    session: options.session ?? lineSession,
    api,
    destination: options.destination ?? "/overview",
    storage,
    onWorkspaceChanged
  };

  return {
    ...render(renderedBootstrap(props)),
    api,
    storage,
    onWorkspaceChanged,
    props
  };
}

describe("LineWorkspacePage", () => {
  it("navigates immediately when a workspace already exists", async () => {
    const { api } = renderBootstrap({ hasWorkspace: true, destination: "/accounts" });

    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts");
    expect(api.createPrivateWorkspace).not.toHaveBeenCalled();
  });

  it("creates a first workspace and waits for refreshed state", async () => {
    const view = renderBootstrap({
      hasWorkspace: false,
      session: { ...lineSession, displayName: "มิน" }
    });

    await waitFor(() => {
      expect(view.api.createPrivateWorkspace).toHaveBeenCalledWith({
        name: "บ้านเงินของ มิน",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      });
    });
    expect(view.onWorkspaceChanged).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location")).toHaveTextContent("/line");

    view.rerender(renderedBootstrap({ ...view.props, hasWorkspace: true }));

    expect(await screen.findByTestId("location")).toHaveTextContent("/overview");
  });

  it("uses the Thai fallback workspace name when LINE has no usable name", async () => {
    const { api } = renderBootstrap();

    await waitFor(() => {
      expect(api.createPrivateWorkspace).toHaveBeenCalledWith({
        name: "การเงินของฉัน",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      });
    });
  });

  it("retries after a creation error and reloads the snapshot before retrying", async () => {
    const user = userEvent.setup();
    const api = {
      createPrivateWorkspace: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider failure"))
        .mockResolvedValueOnce(undefined)
    };
    const onWorkspaceChanged = vi.fn().mockResolvedValue(undefined);
    renderBootstrap({ api, onWorkspaceChanged });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังสร้างพื้นที่ส่วนตัวไม่สำเร็จ"
    );
    expect(onWorkspaceChanged).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));

    await waitFor(() => {
      expect(api.createPrivateWorkspace).toHaveBeenCalledTimes(2);
      expect(onWorkspaceChanged).toHaveBeenCalledTimes(2);
    });
  });

  it("lets a refreshed workspace win over a creation error", async () => {
    let resolveRefresh: (() => void) | undefined;
    const onWorkspaceChanged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const view = renderBootstrap({
      api: { createPrivateWorkspace: vi.fn().mockRejectedValue(new Error("failed")) },
      destination: "/accounts",
      onWorkspaceChanged
    });

    await waitFor(() => {
      expect(onWorkspaceChanged).toHaveBeenCalledOnce();
    });
    view.rerender(renderedBootstrap({ ...view.props, hasWorkspace: true }));

    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts");
    resolveRefresh?.();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("clears the destination only after authoritative workspace navigation", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LINE_DESTINATION_KEY, "/accounts");
    const view = renderBootstrap({ storage, destination: "/accounts" });

    await waitFor(() => {
      expect(view.api.createPrivateWorkspace).toHaveBeenCalledOnce();
    });
    expect(storage.getItem(LINE_DESTINATION_KEY)).toBe("/accounts");

    view.rerender(renderedBootstrap({ ...view.props, hasWorkspace: true }));

    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts");
    expect(storage.getItem(LINE_DESTINATION_KEY)).toBeNull();
  });
});
