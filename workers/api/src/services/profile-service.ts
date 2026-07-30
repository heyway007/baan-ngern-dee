import type {
  UpdateProfileInput,
  UserProfile
} from "@systems-credit/contracts";

import { ApiError } from "../api-error";
import type { AuthSession } from "../middleware/auth";
import { validateProfileImage } from "./profile-image";

export type StoredProfile = Readonly<{
  displayName: string | null;
  avatarPath: string | null;
}>;

export type ProfileIdentity = Readonly<{
  email?: string;
  fallbackDisplayName: string;
  lineAvatarUrl?: string;
}>;

export interface ProfileGateway {
  readProfile(userId: string): Promise<StoredProfile>;
  readIdentity(userId: string): Promise<ProfileIdentity>;
  updateDisplayName(
    userId: string,
    displayName: string
  ): Promise<void>;
  updateAvatarPath(
    userId: string,
    avatarPath: string | null
  ): Promise<void>;
  uploadAvatar(input: {
    path: string;
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png" | "image/webp";
  }): Promise<void>;
  signAvatar(
    path: string,
    expiresIn: number
  ): Promise<string>;
  deleteAvatar(path: string): Promise<void>;
}

export type ProfileAvatarCleanupFailure = Readonly<{
  stage: "rollback" | "replacement" | "removal";
  path: string;
  error: unknown;
}>;

export interface ProfileCleanupObserver {
  recordAvatarCleanupFailure(
    failure: ProfileAvatarCleanupFailure
  ): void | Promise<void>;
}

export interface ProfileService {
  get(actor: AuthSession): Promise<UserProfile>;
  update(
    actor: AuthSession,
    input: UpdateProfileInput
  ): Promise<UserProfile>;
  replaceAvatar(
    actor: AuthSession,
    bytes: Uint8Array
  ): Promise<UserProfile>;
  removeAvatar(actor: AuthSession): Promise<UserProfile>;
}

function profileLoadFailed(): ApiError {
  return new ApiError(
    "PROFILE_LOAD_FAILED",
    500,
    "Unable to load the user profile"
  );
}

function profileImageUploadFailed(): ApiError {
  return new ApiError(
    "PROFILE_IMAGE_UPLOAD_FAILED",
    500,
    "Unable to update the profile image"
  );
}

export function createProfileService(options: {
  gateway: ProfileGateway;
  cleanupObserver?: ProfileCleanupObserver;
  randomUUID?: () => string;
}): ProfileService {
  const cleanupObserver = options.cleanupObserver ?? {
    recordAvatarCleanupFailure(
      failure: ProfileAvatarCleanupFailure
    ) {
      console.error({
        event: "profile_avatar_cleanup_failed",
        ...failure
      });
    }
  };
  const randomUUID =
    options.randomUUID ?? (() => crypto.randomUUID());

  async function readStored(userId: string): Promise<StoredProfile> {
    try {
      return await options.gateway.readProfile(userId);
    } catch {
      throw profileLoadFailed();
    }
  }

  async function readCurrent(userId: string): Promise<UserProfile> {
    try {
      const [stored, identity] = await Promise.all([
        options.gateway.readProfile(userId),
        options.gateway.readIdentity(userId)
      ]);
      const displayName =
        stored.displayName ?? identity.fallbackDisplayName;
      const accountChannel = identity.email
        ? {
            kind: "email" as const,
            label: identity.email
          }
        : {
            kind: "line" as const,
            label: "LINE" as const
          };
      const avatar = stored.avatarPath
        ? {
            source: "custom" as const,
            url: await options.gateway.signAvatar(
              stored.avatarPath,
              24 * 60 * 60
            )
          }
        : identity.lineAvatarUrl
          ? {
              source: "line" as const,
              url: identity.lineAvatarUrl
            }
          : {
              source: "initial" as const,
              url: null
            };

      return {
        userId,
        displayName,
        accountChannel,
        avatar
      };
    } catch {
      throw profileLoadFailed();
    }
  }

  async function runAvatarMutation<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch {
      throw profileImageUploadFailed();
    }
  }

  async function cleanupAvatar(
    stage: ProfileAvatarCleanupFailure["stage"],
    path: string
  ): Promise<void> {
    try {
      await options.gateway.deleteAvatar(path);
    } catch (error) {
      try {
        await cleanupObserver.recordAvatarCleanupFailure({
          stage,
          path,
          error
        });
      } catch {
        // Cleanup reporting must not change the committed profile outcome.
      }
    }
  }

  return {
    async get(actor) {
      return readCurrent(actor.userId);
    },

    async update(actor, input) {
      await options.gateway.updateDisplayName(
        actor.userId,
        input.displayName.trim()
      );
      return readCurrent(actor.userId);
    },

    async replaceAvatar(actor, bytes) {
      const image = validateProfileImage(bytes);
      const stored = await readStored(actor.userId);
      const newPath =
        `${actor.userId}/${randomUUID()}.${image.extension}`;

      await runAvatarMutation(() =>
        options.gateway.uploadAvatar({
          path: newPath,
          bytes: image.bytes,
          contentType: image.contentType
        })
      );

      try {
        await options.gateway.updateAvatarPath(
          actor.userId,
          newPath
        );
      } catch {
        await cleanupAvatar("rollback", newPath);
        throw profileImageUploadFailed();
      }

      const oldPath = stored.avatarPath;
      if (oldPath) {
        await cleanupAvatar("replacement", oldPath);
      }

      return readCurrent(actor.userId);
    },

    async removeAvatar(actor) {
      const stored = await readStored(actor.userId);
      if (!stored.avatarPath) {
        return readCurrent(actor.userId);
      }

      await runAvatarMutation(() =>
        options.gateway.updateAvatarPath(actor.userId, null)
      );
      const oldPath = stored.avatarPath;
      await cleanupAvatar("removal", oldPath);
      return readCurrent(actor.userId);
    }
  };
}
