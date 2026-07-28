import {
  useEffect,
  useRef
} from "react";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
      theme: "auto";
    }
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptSelector = "script[data-baan-ngern-dee-turnstile]";
let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing =
      document.querySelector<HTMLScriptElement>(scriptSelector);
    const script = existing ?? document.createElement("script");

    const loaded = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("TURNSTILE_API_MISSING"));
      }
    };
    const failed = () => reject(new Error("TURNSTILE_LOAD_FAILED"));

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.baanNgernDeeTurnstile = "true";
      document.head.append(script);
    }
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

type TurnstileWidgetProps = Readonly<{
  siteKey: string;
  onToken(token: string): void;
  resetKey: number;
}>;

export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    let active = true;
    const container = containerRef.current;
    if (!container) return;

    void loadTurnstile()
      .then((turnstile) => {
        if (!active) return;
        widgetIdRef.current = turnstile.render(container, {
          sitekey: siteKey,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
          theme: "auto"
        });
      })
      .catch(() => {
        if (active) onToken("");
      });

    return () => {
      active = false;
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      widgetIdRef.current = undefined;
    };
  }, [onToken, siteKey]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
  }, [resetKey]);

  return (
    <div
      ref={containerRef}
      className="turnstile-slot"
      aria-label="การตรวจสอบความปลอดภัย"
    />
  );
}
