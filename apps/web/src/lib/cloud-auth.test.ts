import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CloudAuthFailure,
  createSupabaseCloudAuth
} from "./cloud-auth";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn()
}));

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "min@example.test",
  user_metadata: { display_name: "มิน" }
};
const session = {
  access_token: "access-token",
  user
};
const config = {
  supabaseUrl: "https://project.supabase.co",
  supabasePublishableKey: "sb_publishable_public",
  turnstileSiteKey: "turnstile-site-key"
};

function createAuthSdk() {
  const unsubscribe = vi.fn();
  const sdk = {
    getSession: vi.fn().mockResolvedValue({
      data: { session },
      error: null
    }),
    refreshSession: vi.fn().mockResolvedValue({
      data: {
        session: { ...session, access_token: "refreshed-token" }
      },
      error: null
    }),
    onAuthStateChange: vi.fn(
      (
        callback: (
          event: string,
          nextSession: typeof session | null
        ) => void
      ) => {
        callback("SIGNED_IN", session);
        return { data: { subscription: { unsubscribe } } };
      }
    ),
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { session },
      error: null
    }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({
      data: { session },
      error: null
    }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({
      data: {},
      error: null
    }),
    updateUser: vi.fn().mockResolvedValue({
      data: { user },
      error: null
    }),
    signOut: vi.fn().mockResolvedValue({ error: null })
  };
  vi.mocked(createClient).mockReturnValue({ auth: sdk } as never);
  return { sdk, unsubscribe };
}

describe("createSupabaseCloudAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores, refreshes, and subscribes to mapped cloud sessions", async () => {
    const { sdk, unsubscribe } = createAuthSdk();
    const auth = createSupabaseCloudAuth(config);

    await expect(auth.getSession()).resolves.toEqual({
      userId: user.id,
      email: user.email,
      displayName: "มิน",
      accessToken: "access-token"
    });
    await expect(auth.refreshSession()).resolves.toMatchObject({
      accessToken: "refreshed-token"
    });
    const listener = vi.fn();
    const stop = auth.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id })
    );
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(sdk.onAuthStateChange).toHaveBeenCalledOnce();
  });

  it("signs in and signs up with the exact email account options", async () => {
    const { sdk } = createAuthSdk();
    const auth = createSupabaseCloudAuth(config);

    await expect(
      auth.signIn({
        email: "min@example.test",
        password: "correct-horse-battery"
      })
    ).resolves.toMatchObject({ userId: user.id });
    expect(sdk.signInWithPassword).toHaveBeenCalledWith({
      email: "min@example.test",
      password: "correct-horse-battery"
    });

    await expect(
      auth.signUp({
        displayName: "มิน",
        email: "min@example.test",
        password: "correct-horse-battery",
        captchaToken: "turnstile-token"
      })
    ).resolves.toMatchObject({ userId: user.id });
    expect(sdk.signUp).toHaveBeenCalledWith({
      email: "min@example.test",
      password: "correct-horse-battery",
      options: {
        data: { display_name: "มิน" },
        captchaToken: "turnstile-token"
      }
    });
  });

  it("fails closed when signup does not return a session", async () => {
    const { sdk } = createAuthSdk();
    sdk.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: null
    });
    const auth = createSupabaseCloudAuth(config);

    await expect(
      auth.signUp({
        displayName: "มิน",
        email: "min@example.test",
        password: "correct-horse-battery",
        captchaToken: "turnstile-token"
      })
    ).rejects.toMatchObject({
      code: "AUTH_SIGNUP_SESSION_REQUIRED"
    });
  });

  it.each([
    ["email_exists", "AUTH_EMAIL_EXISTS"],
    ["email_not_confirmed", "AUTH_EMAIL_NOT_CONFIRMED"],
    ["invalid_credentials", "AUTH_INVALID_CREDENTIALS"],
    ["user_banned", "AUTH_USER_SUSPENDED"],
    ["weak_password", "AUTH_WEAK_PASSWORD"],
    ["captcha_failed", "AUTH_CAPTCHA_FAILED"],
    ["over_request_rate_limit", "AUTH_RATE_LIMITED"]
  ] as const)("maps Supabase code %s to %s", async (upstream, appCode) => {
    const { sdk } = createAuthSdk();
    sdk.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: {
        name: "AuthApiError",
        message: "upstream detail",
        status: 400,
        code: upstream
      }
    });
    const auth = createSupabaseCloudAuth(config);

    await expect(
      auth.signIn({
        email: "min@example.test",
        password: "wrong-password"
      })
    ).rejects.toEqual(new CloudAuthFailure(appCode));
  });

  it("maps a rejected Auth request to a network-safe error", async () => {
    const { sdk } = createAuthSdk();
    sdk.signInWithPassword.mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );
    const auth = createSupabaseCloudAuth(config);

    await expect(
      auth.signIn({
        email: "min@example.test",
        password: "wrong-password"
      })
    ).rejects.toMatchObject({
      code: "AUTH_NETWORK_UNAVAILABLE"
    });
  });

  it("requests reset, updates password, and signs out", async () => {
    const { sdk } = createAuthSdk();
    const auth = createSupabaseCloudAuth(config);

    await auth.requestPasswordReset(
      "min@example.test",
      "https://app.example.test/reset-password"
    );
    await auth.updatePassword("new-correct-horse-battery");
    await auth.signOut();

    expect(sdk.resetPasswordForEmail).toHaveBeenCalledWith(
      "min@example.test",
      {
        redirectTo: "https://app.example.test/reset-password"
      }
    );
    expect(sdk.updateUser).toHaveBeenCalledWith({
      password: "new-correct-horse-battery"
    });
    expect(sdk.signOut).toHaveBeenCalledOnce();
  });

  it("falls back to the email prefix when metadata has no display name", async () => {
    const { sdk } = createAuthSdk();
    sdk.getSession.mockResolvedValueOnce({
      data: {
        session: {
          ...session,
          user: { ...user, user_metadata: {} }
        }
      },
      error: null
    });
    const auth = createSupabaseCloudAuth(config);

    await expect(auth.getSession()).resolves.toMatchObject({
      displayName: "min"
    });
  });

  it("maps an email-less LINE session from provider metadata", async () => {
    const { sdk } = createAuthSdk();
    sdk.getSession.mockResolvedValueOnce({
      data: {
        session: {
          ...session,
          user: {
            ...user,
            email: undefined,
            user_metadata: { name: "มิน LINE" }
          }
        }
      },
      error: null
    });
    const auth = createSupabaseCloudAuth(config);

    await expect(auth.getSession()).resolves.toEqual({
      userId: user.id,
      displayName: "มิน LINE",
      accessToken: "access-token"
    });
  });

  it("starts the custom LINE provider with the exact callback", async () => {
    const { sdk } = createAuthSdk();
    const auth = createSupabaseCloudAuth(config);

    await auth.startLineSignIn("https://app.example.test/line/callback");

    expect(sdk.signInWithOAuth).toHaveBeenCalledWith({
      provider: "custom:line",
      options: {
        redirectTo: "https://app.example.test/line/callback"
      }
    });
  });
});
