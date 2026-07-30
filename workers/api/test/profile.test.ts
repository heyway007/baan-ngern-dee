import {
  PROFILE_AVATAR_MAX_BYTES,
  userProfileSchema,
  type UserProfile
} from "@systems-credit/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import type { ProfileService } from "../src/services/profile-service";

const userId = "11111111-1111-4111-8111-111111111111";
const accessToken = "profile-token";
const actor = { userId, accessToken };

const currentProfile: UserProfile = {
  userId,
  displayName: "Current Name",
  accountChannel: {
    kind: "email",
    label: "person@example.test"
  },
  avatar: {
    source: "custom",
    url: "https://example.test/current-avatar.png"
  }
};

const updatedProfile: UserProfile = {
  ...currentProfile,
  displayName: "Updated Name"
};

const avatarProfile: UserProfile = {
  ...updatedProfile,
  avatar: {
    source: "custom",
    url: "https://example.test/new-avatar.png"
  }
};

const fallbackProfile: UserProfile = {
  ...updatedProfile,
  avatar: {
    source: "initial",
    url: null
  }
};

function createFakeProfileService(
  overrides: Partial<ProfileService> = {}
): ProfileService {
  return {
    get: vi.fn().mockResolvedValue(currentProfile),
    update: vi.fn().mockResolvedValue(updatedProfile),
    replaceAvatar: vi.fn().mockResolvedValue(avatarProfile),
    removeAvatar: vi.fn().mockResolvedValue(fallbackProfile),
    ...overrides
  };
}

function createProfileRouteApp(profileService: ProfileService) {
  return createApp({
    authVerifier: createStaticAuthVerifier({
      [accessToken]: userId
    }),
    profileService
  });
}

const authenticatedHeaders = {
  authorization: `Bearer ${accessToken}`
};

describe("authenticated profile routes", () => {
  it.each([
    ["GET", "/v1/profile", undefined],
    [
      "PATCH",
      "/v1/profile",
      JSON.stringify({ displayName: "Updated Name" })
    ],
    ["POST", "/v1/profile/avatar", new Uint8Array([1, 2, 3])],
    ["DELETE", "/v1/profile/avatar", undefined]
  ])(
    "returns 401 for unauthenticated %s %s without calling the service",
    async (method, path, body) => {
      const profileService = createFakeProfileService();

      const response = await createApp({ profileService }).request(
        path,
        {
          method,
          ...(body === undefined ? {} : { body })
        }
      );

      expect(response.status).toBe(401);
      expect(profileService.get).not.toHaveBeenCalled();
      expect(profileService.update).not.toHaveBeenCalled();
      expect(profileService.replaceAvatar).not.toHaveBeenCalled();
      expect(profileService.removeAvatar).not.toHaveBeenCalled();
    }
  );

  it("returns the authenticated user's validated profile", async () => {
    const profileService = createFakeProfileService();

    const response = await createProfileRouteApp(
      profileService
    ).request("/v1/profile", {
      headers: authenticatedHeaders
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(userProfileSchema.parse(body)).toEqual(currentProfile);
    expect(profileService.get).toHaveBeenCalledWith(actor);
  });

  it("trims a valid display name before delegating", async () => {
    const profileService = createFakeProfileService();

    const response = await createProfileRouteApp(
      profileService
    ).request("/v1/profile", {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({ displayName: "  Updated Name  " })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(userProfileSchema.parse(body)).toEqual(updatedProfile);
    expect(profileService.update).toHaveBeenCalledWith(actor, {
      displayName: "Updated Name"
    });
  });

  it("rejects unknown profile update keys before delegating", async () => {
    const profileService = createFakeProfileService();

    const response = await createProfileRouteApp(
      profileService
    ).request("/v1/profile", {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        displayName: "Updated Name",
        userId: "22222222-2222-4222-8222-222222222222"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROFILE_NAME_INVALID" }
    });
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized avatar without reading its body", async () => {
    const profileService = createFakeProfileService();
    const request = new Request(
      "http://localhost/v1/profile/avatar",
      {
        method: "POST",
        headers: {
          ...authenticatedHeaders,
          "content-length": String(PROFILE_AVATAR_MAX_BYTES + 1)
        },
        body: new Uint8Array([1, 2, 3])
      }
    );
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");

    const response = await createProfileRouteApp(
      profileService
    ).request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROFILE_IMAGE_TOO_LARGE" }
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(profileService.replaceAvatar).not.toHaveBeenCalled();
  });

  it("passes the actual avatar request bytes to the service", async () => {
    const profileService = createFakeProfileService();
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);

    const response = await createProfileRouteApp(
      profileService
    ).request("/v1/profile/avatar", {
      method: "POST",
      headers: authenticatedHeaders,
      body: bytes
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(userProfileSchema.parse(body)).toEqual(avatarProfile);
    expect(profileService.replaceAvatar).toHaveBeenCalledWith(
      actor,
      bytes
    );
  });

  it("returns the fallback profile after deleting the avatar", async () => {
    const profileService = createFakeProfileService();

    const response = await createProfileRouteApp(
      profileService
    ).request("/v1/profile/avatar", {
      method: "DELETE",
      headers: authenticatedHeaders
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(userProfileSchema.parse(body)).toEqual(fallbackProfile);
    expect(profileService.removeAvatar).toHaveBeenCalledWith(actor);
  });

  it.each([
    ["GET", "/v1/profile", "get"],
    ["PATCH", "/v1/profile", "update"],
    ["POST", "/v1/profile/avatar", "replaceAvatar"],
    ["DELETE", "/v1/profile/avatar", "removeAvatar"]
  ] as const)(
    "rejects an invalid service profile from %s %s",
    async (method, path, serviceMethod) => {
      const invalidProfile = {
        ...currentProfile,
        userId: "not-a-user-id"
      } as unknown as UserProfile;
      const profileService = createFakeProfileService({
        [serviceMethod]: vi.fn().mockResolvedValue(invalidProfile)
      });
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const response = await createProfileRouteApp(
        profileService
      ).request(path, {
        method,
        headers: {
          ...authenticatedHeaders,
          ...(method === "PATCH"
            ? { "content-type": "application/json" }
            : {})
        },
        ...(method === "PATCH"
          ? {
              body: JSON.stringify({
                displayName: "Updated Name"
              })
            }
          : method === "POST"
            ? { body: new Uint8Array([1, 2, 3]) }
            : {})
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INTERNAL_ERROR" }
      });
      errorLog.mockRestore();
    }
  );
});
