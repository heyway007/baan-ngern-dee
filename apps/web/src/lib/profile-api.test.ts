import type { CloudAuth, CloudSession } from "./cloud-auth";
import { describe, expect, it, vi } from "vitest";

import {
  ProfileApiFailure,
  createProfileApi
} from "./profile-api";

const profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "มิน",
  accountChannel: { kind: "email" as const, label: "min@example.test" },
  avatar: { source: "initial" as const, url: null }
};

const initialSession: CloudSession = {
  userId: profile.userId,
  displayName: profile.displayName,
  accessToken: "initial-token"
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createAuth(
  session: CloudSession | null = initialSession
): CloudAuth {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    refreshSession: vi.fn().mockResolvedValue({
      ...initialSession,
      accessToken: "refreshed-token"
    }),
    subscribe: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
    startLineSignIn: vi.fn(),
    updatePassword: vi.fn(),
    signOut: vi.fn()
  };
}

describe("createProfileApi", () => {
  it("gets a schema-validated profile with the current bearer token", async () => {
    const auth = createAuth();
    const requestFetch = vi.fn().mockResolvedValue(response(profile));
    const api = createProfileApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.get()).resolves.toEqual(profile);
    expect(requestFetch).toHaveBeenCalledWith("/v1/profile", {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer initial-token"
      }
    });
  });

  it("refreshes once after a 401 and retries with the fresh bearer token", async () => {
    const auth = createAuth();
    const requestFetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(profile));
    const api = createProfileApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.get()).resolves.toEqual(profile);
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(requestFetch.mock.calls.map(([, init]) => {
      return (init as RequestInit).headers;
    })).toEqual([
      { accept: "application/json", authorization: "Bearer initial-token" },
      { accept: "application/json", authorization: "Bearer refreshed-token" }
    ]);
  });

  it("signs out through the callback after a second 401", async () => {
    const onUnauthenticated = vi.fn();
    const requestFetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({}, 401));
    const api = createProfileApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated
    });

    await expect(api.get()).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("patches only the display name as JSON", async () => {
    const requestFetch = vi.fn().mockResolvedValue(response(profile));
    const api = createProfileApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await api.update({ displayName: "มินใหม่" });

    expect(requestFetch).toHaveBeenCalledWith("/v1/profile", {
      method: "PATCH",
      headers: {
        accept: "application/json",
        authorization: "Bearer initial-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ displayName: "มินใหม่" })
    });
  });

  it("uploads avatar bytes directly with their media type and no JSON content type", async () => {
    const requestFetch = vi.fn().mockResolvedValue(response(profile));
    const api = createProfileApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });
    const image = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/png"
    });

    await api.replaceAvatar(image);

    expect(requestFetch).toHaveBeenCalledWith("/v1/profile/avatar", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer initial-token",
        "content-type": "image/png"
      },
      body: image
    });
  });

  it("deletes the avatar through its exact endpoint", async () => {
    const requestFetch = vi.fn().mockResolvedValue(response(profile));
    const api = createProfileApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await api.removeAvatar();

    expect(requestFetch).toHaveBeenCalledWith("/v1/profile/avatar", {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: "Bearer initial-token"
      }
    });
  });

  it("preserves structured profile errors without reflecting response body data", async () => {
    const api = createProfileApi({
      auth: createAuth(),
      fetch: vi.fn().mockResolvedValue(
        response(
          {
            error: {
              code: "PROFILE_IMAGE_TOO_LARGE",
              message: "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB",
              requestId: "req-profile-123"
            }
          },
          413
        )
      ),
      onUnauthenticated: vi.fn()
    });

    await expect(api.replaceAvatar(new Blob(["image"]))).rejects.toEqual(
      new ProfileApiFailure(
        "PROFILE_IMAGE_TOO_LARGE",
        "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB",
        "req-profile-123"
      )
    );
  });

  it.each([
    ["malformed profile response", () => response({ profile }, 200)],
    ["network failure", () => Promise.reject(new TypeError("secret failure"))]
  ])("maps a %s while loading to a Thai controlled failure", async (_, result) => {
    const api = createProfileApi({
      auth: createAuth(),
      fetch: vi.fn().mockImplementation(result),
      onUnauthenticated: vi.fn()
    });

    await expect(api.get()).rejects.toMatchObject({
      code: "PROFILE_LOAD_FAILED",
      message: "ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ กรุณาลองใหม่"
    });
  });

  it.each([
    ["malformed profile response", () => response({ profile }, 200)],
    ["network failure", () => Promise.reject(new TypeError("secret failure"))]
  ])("maps a %s while uploading to a Thai controlled failure", async (_, result) => {
    const api = createProfileApi({
      auth: createAuth(),
      fetch: vi.fn().mockImplementation(result),
      onUnauthenticated: vi.fn()
    });

    await expect(api.replaceAvatar(new Blob(["image"]))).rejects.toMatchObject({
      code: "PROFILE_IMAGE_UPLOAD_FAILED",
      message: "ไม่สามารถอัปโหลดรูปโปรไฟล์ได้ กรุณาลองใหม่"
    });
  });
});
