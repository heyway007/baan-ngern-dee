import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../src/middleware/auth";
import {
  createProfileService,
  type ProfileGateway,
  type ProfileIdentity,
  type StoredProfile
} from "../src/services/profile-service";

const userId = "11111111-1111-4111-8111-111111111111";
const avatarId = "44444444-4444-4444-8444-444444444444";
const actor: AuthSession = {
  userId,
  accessToken: "access-token"
};
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a
]);

function createDependencies(input?: {
  stored?: StoredProfile;
  identity?: ProfileIdentity;
}) {
  const cleanupFailures: Array<{
    stage: "rollback" | "replacement" | "removal";
    path: string;
    error: unknown;
  }> = [];
  const operations: string[] = [];
  const signatures: string[] = [];
  const uploads: Array<
    Parameters<ProfileGateway["uploadAvatar"]>[0]
  > = [];
  const stored = {
    displayName: input?.stored?.displayName ?? null,
    avatarPath: input?.stored?.avatarPath ?? null
  };
  const identity: ProfileIdentity = input?.identity ?? {
    email: "mint@example.test",
    fallbackDisplayName: "Mint Auth"
  };
  const gateway: ProfileGateway = {
    readProfile: vi.fn(async () => ({ ...stored })),
    readIdentity: vi.fn(async () => identity),
    updateDisplayName: vi.fn(async (targetUserId, displayName) => {
      operations.push(`name:${targetUserId}:${displayName}`);
      stored.displayName = displayName;
    }),
    updateAvatarPath: vi.fn(async (_targetUserId, avatarPath) => {
      operations.push(`path:${avatarPath ?? "null"}`);
      stored.avatarPath = avatarPath;
    }),
    uploadAvatar: vi.fn(async (upload) => {
      uploads.push(upload);
      operations.push(`upload:${upload.path}`);
    }),
    signAvatar: vi.fn(async (path, expiresIn) => {
      signatures.push(`sign:${path}:${expiresIn}`);
      return `https://images.example.test/${path}`;
    }),
    deleteAvatar: vi.fn(async (path) => {
      operations.push(`delete:${path}`);
    })
  };
  const service = createProfileService({
    gateway,
    cleanupObserver: {
      recordAvatarCleanupFailure(failure) {
        cleanupFailures.push(failure);
      }
    },
    randomUUID: () => avatarId
  });

  return {
    cleanupFailures,
    gateway,
    identity,
    operations,
    service,
    signatures,
    stored,
    uploads
  };
}

describe("profile service", () => {
  it("uses the stored display name instead of the Auth fallback", async () => {
    const { service } = createDependencies({
      stored: {
        displayName: "Mint Profile",
        avatarPath: null
      },
      identity: {
        email: "mint@example.test",
        fallbackDisplayName: "Mint Auth"
      }
    });

    await expect(service.get(actor)).resolves.toMatchObject({
      userId,
      displayName: "Mint Profile"
    });
  });

  it("describes an email identity with its email address", async () => {
    const { service } = createDependencies({
      identity: {
        email: "mint@example.test",
        fallbackDisplayName: "Mint"
      }
    });

    await expect(service.get(actor)).resolves.toMatchObject({
      accountChannel: {
        kind: "email",
        label: "mint@example.test"
      }
    });
  });

  it("describes an email-less identity as LINE", async () => {
    const { service } = createDependencies({
      identity: {
        fallbackDisplayName: "Mint LINE"
      }
    });

    await expect(service.get(actor)).resolves.toMatchObject({
      accountChannel: {
        kind: "line",
        label: "LINE"
      }
    });
  });

  it("prefers a signed custom avatar over the LINE avatar", async () => {
    const oldPath = `${userId}/old.png`;
    const { service, signatures } = createDependencies({
      stored: {
        displayName: null,
        avatarPath: oldPath
      },
      identity: {
        fallbackDisplayName: "Mint LINE",
        lineAvatarUrl: "https://line.example.test/avatar"
      }
    });

    await expect(service.get(actor)).resolves.toMatchObject({
      avatar: {
        source: "custom",
        url: `https://images.example.test/${oldPath}`
      }
    });
    expect(signatures).toEqual([`sign:${oldPath}:86400`]);
  });

  it("prefers the LINE avatar over the initial fallback", async () => {
    const lineAvatarUrl = "https://line.example.test/avatar";
    const { service } = createDependencies({
      identity: {
        fallbackDisplayName: "Mint LINE",
        lineAvatarUrl
      }
    });

    await expect(service.get(actor)).resolves.toMatchObject({
      avatar: {
        source: "line",
        url: lineAvatarUrl
      }
    });
  });

  it("trims and writes the authenticated user's display name", async () => {
    const { operations, service } = createDependencies();

    await expect(
      service.update(actor, { displayName: "  Mint Profile  " })
    ).resolves.toMatchObject({
      userId,
      displayName: "Mint Profile"
    });
    expect(operations).toEqual([
      `name:${userId}:Mint Profile`
    ]);
  });

  it("uploads a replacement before switching paths and deleting the old avatar", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const { operations, service, stored, uploads } =
      createDependencies({
        stored: {
          displayName: "Mint",
          avatarPath: oldPath
        }
      });

    await service.replaceAvatar(actor, pngBytes);

    expect(operations).toEqual([
      `upload:${newPath}`,
      `path:${newPath}`,
      `delete:${oldPath}`
    ]);
    expect(uploads).toEqual([
      {
        path: newPath,
        bytes: pngBytes,
        contentType: "image/png"
      }
    ]);
    expect(stored.avatarPath).toBe(newPath);
  });

  it("leaves the old avatar path untouched when upload fails", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const { gateway, operations, service, stored } =
      createDependencies({
        stored: {
          displayName: "Mint",
          avatarPath: oldPath
        }
      });
    vi.mocked(gateway.uploadAvatar).mockImplementationOnce(
      async ({ path }) => {
        operations.push(`upload:${path}`);
        throw new Error("storage unavailable");
      }
    );

    await expect(
      service.replaceAvatar(actor, pngBytes)
    ).rejects.toMatchObject({
      code: "PROFILE_IMAGE_UPLOAD_FAILED",
      status: 500
    });
    expect(operations).toEqual([`upload:${newPath}`]);
    expect(stored.avatarPath).toBe(oldPath);
  });

  it("deletes a newly uploaded orphan when switching paths fails", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const { gateway, operations, service, stored } =
      createDependencies({
        stored: {
          displayName: "Mint",
          avatarPath: oldPath
        }
      });
    vi.mocked(gateway.updateAvatarPath).mockImplementationOnce(
      async (targetUserId, avatarPath) => {
        operations.push(`path:${avatarPath}`);
        expect(targetUserId).toBe(userId);
        throw new Error("database unavailable");
      }
    );

    await expect(
      service.replaceAvatar(actor, pngBytes)
    ).rejects.toMatchObject({
      code: "PROFILE_IMAGE_UPLOAD_FAILED",
      status: 500
    });
    expect(operations).toEqual([
      `upload:${newPath}`,
      `path:${newPath}`,
      `delete:${newPath}`
    ]);
    expect(stored.avatarPath).toBe(oldPath);
  });

  it("returns the committed replacement when deleting the old avatar fails", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const cleanupError = new Error("delete unavailable");
    const {
      cleanupFailures,
      gateway,
      operations,
      service,
      signatures,
      stored
    } = createDependencies({
      stored: {
        displayName: "Mint",
        avatarPath: oldPath
      }
    });
    vi.mocked(gateway.deleteAvatar).mockImplementationOnce(
      async (path) => {
        operations.push(`delete:${path}`);
        throw cleanupError;
      }
    );

    await expect(
      service.replaceAvatar(actor, pngBytes)
    ).resolves.toMatchObject({
      avatar: {
        source: "custom",
        url: `https://images.example.test/${newPath}`
      }
    });
    expect(operations).toEqual([
      `upload:${newPath}`,
      `path:${newPath}`,
      `delete:${oldPath}`
    ]);
    expect(signatures).toEqual([`sign:${newPath}:86400`]);
    expect(stored.avatarPath).toBe(newPath);
    expect(cleanupFailures).toEqual([
      {
        stage: "replacement",
        path: oldPath,
        error: cleanupError
      }
    ]);
  });

  it("logs one structured cleanup failure with the default observer", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const cleanupError = new Error("delete unavailable");
    const { gateway, stored } = createDependencies({
      stored: {
        displayName: "Mint",
        avatarPath: oldPath
      }
    });
    vi.mocked(gateway.deleteAvatar).mockRejectedValueOnce(
      cleanupError
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const service = createProfileService({
        gateway,
        randomUUID: () => avatarId
      });

      await expect(
        service.replaceAvatar(actor, pngBytes)
      ).resolves.toMatchObject({
        avatar: {
          source: "custom",
          url: `https://images.example.test/${newPath}`
        }
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith({
        event: "profile_avatar_cleanup_failed",
        stage: "replacement",
        path: oldPath,
        error: cleanupError
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(stored.avatarPath).toBe(newPath);
  });

  it("returns the committed removal when deleting the old avatar fails", async () => {
    const oldPath = `${userId}/old.png`;
    const cleanupError = new Error("delete unavailable");
    const {
      cleanupFailures,
      gateway,
      operations,
      service,
      stored
    } = createDependencies({
      stored: {
        displayName: "Mint",
        avatarPath: oldPath
      }
    });
    vi.mocked(gateway.deleteAvatar).mockImplementationOnce(
      async (path) => {
        operations.push(`delete:${path}`);
        throw cleanupError;
      }
    );

    await expect(
      service.removeAvatar(actor)
    ).resolves.toMatchObject({
      avatar: {
        source: "initial",
        url: null
      }
    });
    expect(operations).toEqual([
      "path:null",
      `delete:${oldPath}`
    ]);
    expect(stored.avatarPath).toBeNull();
    expect(cleanupFailures).toEqual([
      {
        stage: "removal",
        path: oldPath,
        error: cleanupError
      }
    ]);
  });

  it("records the orphan path when rollback cleanup fails", async () => {
    const oldPath = `${userId}/old.png`;
    const newPath = `${userId}/${avatarId}.png`;
    const pathError = new Error("database unavailable");
    const cleanupError = new Error("delete unavailable");
    const {
      cleanupFailures,
      gateway,
      operations,
      service,
      stored
    } = createDependencies({
      stored: {
        displayName: "Mint",
        avatarPath: oldPath
      }
    });
    vi.mocked(gateway.updateAvatarPath).mockImplementationOnce(
      async (_targetUserId, avatarPath) => {
        operations.push(`path:${avatarPath}`);
        throw pathError;
      }
    );
    vi.mocked(gateway.deleteAvatar).mockImplementationOnce(
      async (path) => {
        operations.push(`delete:${path}`);
        throw cleanupError;
      }
    );

    await expect(
      service.replaceAvatar(actor, pngBytes)
    ).rejects.toMatchObject({
      code: "PROFILE_IMAGE_UPLOAD_FAILED",
      status: 500
    });
    expect(operations).toEqual([
      `upload:${newPath}`,
      `path:${newPath}`,
      `delete:${newPath}`
    ]);
    expect(stored.avatarPath).toBe(oldPath);
    expect(cleanupFailures).toEqual([
      {
        stage: "rollback",
        path: newPath,
        error: cleanupError
      }
    ]);
  });

  it("clears the avatar path before deletion and is idempotent", async () => {
    const oldPath = `${userId}/old.png`;
    const { operations, service, stored } = createDependencies({
      stored: {
        displayName: "Mint",
        avatarPath: oldPath
      }
    });

    await service.removeAvatar(actor);
    await service.removeAvatar(actor);

    expect(operations).toEqual([
      "path:null",
      `delete:${oldPath}`
    ]);
    expect(stored.avatarPath).toBeNull();
  });

  it("maps profile read failures to a stable API error", async () => {
    const { gateway, service } = createDependencies();
    vi.mocked(gateway.readProfile).mockRejectedValueOnce(
      new Error("database unavailable")
    );

    await expect(service.get(actor)).rejects.toMatchObject({
      code: "PROFILE_LOAD_FAILED",
      status: 500
    });
  });
});
