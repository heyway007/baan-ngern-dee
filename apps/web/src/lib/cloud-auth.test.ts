import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseCloudAuth } from "./cloud-auth";

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
    signUp: vi.fn().mockResolvedValue({
      data: { session: null },
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
    const auth = createSupabaseCloudAuth({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });

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
    const auth = createSupabaseCloudAuth({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });

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
        redirectTo: "https://app.example.test/"
      })
    ).resolves.toBe("confirmation_required");
    expect(sdk.signUp).toHaveBeenCalledWith({
      email: "min@example.test",
      password: "correct-horse-battery",
      options: {
        data: { display_name: "มิน" },
        emailRedirectTo: "https://app.example.test/"
      }
    });
  });

  it("requests reset, updates password, and signs out", async () => {
    const { sdk } = createAuthSdk();
    const auth = createSupabaseCloudAuth({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });

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
    const auth = createSupabaseCloudAuth({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });

    await expect(auth.getSession()).resolves.toMatchObject({
      displayName: "min"
    });
  });
});
