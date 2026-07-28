import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TurnstileWidget } from "./turnstile-widget";

describe("TurnstileWidget", () => {
  beforeEach(() => {
    document
      .querySelectorAll('script[data-baan-ngern-dee-turnstile]')
      .forEach((element) => element.remove());
    delete (window as Window & { turnstile?: unknown }).turnstile;
  });

  it("forwards token lifecycle and removes the widget on unmount", async () => {
    let options:
      | {
          callback(token: string): void;
          "expired-callback"(): void;
          "error-callback"(): void;
        }
      | undefined;
    const turnstile = {
      render: vi.fn(
        (
          _container: HTMLElement,
          nextOptions: NonNullable<typeof options>
        ) => {
          options = nextOptions;
          return "widget-1";
        }
      ),
      reset: vi.fn(),
      remove: vi.fn()
    };
    window.turnstile =
      turnstile as unknown as NonNullable<Window["turnstile"]>;
    const onToken = vi.fn();
    const view = render(
      <TurnstileWidget
        siteKey="turnstile-site-key"
        onToken={onToken}
        resetKey={0}
      />
    );

    await waitFor(() =>
      expect(turnstile.render).toHaveBeenCalledOnce()
    );
    act(() => options?.callback("verified-token"));
    expect(onToken).toHaveBeenLastCalledWith("verified-token");

    act(() => options?.["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith("");

    view.rerender(
      <TurnstileWidget
        siteKey="turnstile-site-key"
        onToken={onToken}
        resetKey={1}
      />
    );
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");

    view.unmount();
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });
});
