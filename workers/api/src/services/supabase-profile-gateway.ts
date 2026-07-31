import { z } from "zod";

import { ApiError } from "../api-error";
import type {
  ProfileGateway,
  ProfileIdentity,
  StoredProfile
} from "./profile-service";

export type SupabaseProfileConfig = Readonly<{
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}>;

const storedProfileRowSchema = z
  .object({
    display_name: z.string().nullable(),
    avatar_path: z.string().nullable()
  })
  .strict();

const authUserSchema = z
  .object({
    email: z
      .union([z.string().email(), z.literal("")])
      .nullable()
      .optional(),
    user_metadata: z.record(z.unknown()).default({})
  })
  .passthrough();

const signedUrlSchema = z
  .object({
    signedURL: z.string().min(1)
  })
  .passthrough();

type FailureKind = "profile" | "storage";

function controlledFailure(kind: FailureKind): ApiError {
  return kind === "storage"
    ? new ApiError(
        "PROFILE_IMAGE_UPLOAD_FAILED",
        500,
        "Unable to update the profile image"
      )
    : new ApiError(
        "PROFILE_LOAD_FAILED",
        500,
        "Unable to load the user profile"
      );
}

function encodeObjectPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizedString(
  value: unknown,
  maximumLength?: number
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return maximumLength === undefined
    ? normalized
    : normalized.slice(0, maximumLength);
}

function normalizeIdentity(
  raw: z.infer<typeof authUserSchema>
): ProfileIdentity {
  const email = raw.email?.trim().toLowerCase() || undefined;
  let metadataName: string | undefined;
  for (const key of [
    "display_name",
    "name",
    "full_name",
    "preferred_username"
  ]) {
    metadataName = normalizedString(raw.user_metadata[key], 80);
    if (metadataName) break;
  }
  const fallbackDisplayName =
    metadataName ??
    normalizedString(email?.split("@")[0], 80) ??
    "ผู้ใช้ LINE";

  let lineAvatarUrl: string | undefined;
  for (const key of ["avatar_url", "picture"]) {
    lineAvatarUrl = normalizedString(raw.user_metadata[key]);
    if (lineAvatarUrl) break;
  }

  return {
    ...(email ? { email } : {}),
    fallbackDisplayName,
    ...(lineAvatarUrl ? { lineAvatarUrl } : {})
  };
}

export function createSupabaseProfileGateway(
  config: SupabaseProfileConfig
): ProfileGateway {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");
  const supabaseOrigin = new URL(`${baseUrl}/`).origin;

  async function request(
    path: string,
    init: RequestInit,
    failureKind: FailureKind
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", config.serviceRoleKey);
    headers.set(
      "authorization",
      `Bearer ${config.serviceRoleKey}`
    );

    let response: Response;
    try {
      response = await requestFetch.call(
        globalThis,
        `${baseUrl}${path}`,
        {
          ...init,
          headers
        }
      );
    } catch {
      throw controlledFailure(failureKind);
    }

    if (!response.ok) {
      throw controlledFailure(failureKind);
    }
    return response;
  }

  async function parseJson<Schema extends z.ZodTypeAny>(
    response: Response,
    schema: Schema,
    failureKind: FailureKind
  ): Promise<z.output<Schema>> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw controlledFailure(failureKind);
    }
  }

  function profilePath(userId: string): string {
    return `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
  }

  function storageObjectPath(path: string): string {
    return (
      "/storage/v1/object/profile-avatars/" +
      encodeObjectPath(path)
    );
  }

  function signedObjectPath(path: string): string {
    return (
      "/storage/v1/object/sign/profile-avatars/" +
      encodeObjectPath(path)
    );
  }

  async function patchProfile(
    userId: string,
    body: Record<string, unknown>
  ): Promise<void> {
    await request(
      profilePath(userId),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          prefer: "return=minimal"
        },
        body: JSON.stringify(body)
      },
      "profile"
    );
  }

  return {
    async readProfile(userId): Promise<StoredProfile> {
      const response = await request(
        `${profilePath(userId)}&select=display_name,avatar_path&limit=1`,
        { method: "GET" },
        "profile"
      );
      const rows = await parseJson(
        response,
        z.array(storedProfileRowSchema).length(1),
        "profile"
      );
      const row = rows[0]!;
      return {
        displayName: row.display_name,
        avatarPath: row.avatar_path
      };
    },

    async readIdentity(userId): Promise<ProfileIdentity> {
      const response = await request(
        `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        { method: "GET" },
        "profile"
      );
      const raw = await parseJson(
        response,
        authUserSchema,
        "profile"
      );
      return normalizeIdentity(raw);
    },

    updateDisplayName(userId, displayName) {
      return patchProfile(userId, {
        display_name: displayName
      });
    },

    updateAvatarPath(userId, avatarPath) {
      return patchProfile(userId, {
        avatar_path: avatarPath
      });
    },

    async uploadAvatar(input) {
      await request(
        storageObjectPath(input.path),
        {
          method: "POST",
          headers: {
            "content-type": input.contentType,
            "cache-control": "max-age=3600",
            "x-upsert": "false"
          },
          body: input.bytes as unknown as BodyInit
        },
        "storage"
      );
    },

    async signAvatar(path, expiresIn) {
      const expectedSignedPath = signedObjectPath(path);
      const response = await request(
        expectedSignedPath,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ expiresIn })
        },
        "profile"
      );
      const result = await parseJson(
        response,
        signedUrlSchema,
        "profile"
      );

      try {
        const normalizedSignedUrl = result.signedURL.trim();
        if (!normalizedSignedUrl) {
          throw new TypeError("Signed URL is empty");
        }
        const projectRelativeSignedUrl =
          normalizedSignedUrl.startsWith("/object/")
            ? `/storage/v1${normalizedSignedUrl}`
            : normalizedSignedUrl.startsWith("object/")
              ? `/storage/v1/${normalizedSignedUrl}`
              : normalizedSignedUrl;
        const signedUrl = new URL(
          projectRelativeSignedUrl,
          `${baseUrl}/`
        );
        if (
          signedUrl.origin !== supabaseOrigin ||
          signedUrl.pathname !== expectedSignedPath ||
          signedUrl.username ||
          signedUrl.password
        ) {
          throw new TypeError("Unexpected signed URL target");
        }
        return signedUrl.toString();
      } catch {
        throw controlledFailure("profile");
      }
    },

    async deleteAvatar(path) {
      await request(
        "/storage/v1/object/profile-avatars",
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ prefixes: [path] })
        },
        "storage"
      );
    }
  };
}
