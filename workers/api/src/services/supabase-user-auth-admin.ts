import {
  adminUserSchema,
  type AdminUser
} from "@systems-credit/contracts";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { SupabaseAdminConfig } from "./supabase-invitation-repository";
import type { UserAuthAdmin } from "./user-management-service";

const rawAuthUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    user_metadata: z.record(z.unknown()).default({}),
    app_metadata: z.record(z.unknown()).default({}),
    created_at: z.string().datetime({ offset: true }),
    last_sign_in_at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    email_confirmed_at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    banned_until: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
  })
  .passthrough();

function controlledFailure(): ApiError {
  return new ApiError(
    "USER_ADMIN_ACTION_FAILED",
    500,
    "ไม่สามารถจัดการบัญชีผู้ใช้ได้ กรุณาลองใหม่"
  );
}

function authError(status: number): ApiError {
  if (status === 404) {
    return new ApiError(
      "USER_NOT_FOUND",
      404,
      "ไม่พบบัญชีผู้ใช้นี้"
    );
  }
  if (status === 429) {
    return new ApiError(
      "USER_ADMIN_RATE_LIMITED",
      429,
      "ดำเนินการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"
    );
  }
  return controlledFailure();
}

function normalizeUser(
  raw: z.infer<typeof rawAuthUserSchema>
): AdminUser {
  const deletionPending =
    raw.app_metadata.baan_ngern_dee_deletion_pending === true;
  const isBanned =
    typeof raw.banned_until === "string" &&
    Date.parse(raw.banned_until) > Date.now();
  const metadataName = raw.user_metadata.display_name;
  const displayName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().slice(0, 80)
      : raw.email.split("@")[0]!.slice(0, 80);

  return adminUserSchema.parse({
    userId: raw.id,
    email: raw.email,
    displayName,
    status: deletionPending
      ? "deletion_pending"
      : isBanned
        ? "suspended"
        : raw.email_confirmed_at
          ? "active"
          : "unconfirmed",
    createdAt: raw.created_at,
    ...(raw.last_sign_in_at
      ? { lastSignInAt: raw.last_sign_in_at }
      : {}),
    ...(raw.email_confirmed_at
      ? { emailConfirmedAt: raw.email_confirmed_at }
      : {}),
    ...(raw.banned_until
      ? { bannedUntil: raw.banned_until }
      : {}),
    privateWorkspaceCount: 0,
    deletionPending
  });
}

export function createSupabaseUserAuthAdmin(
  config: SupabaseAdminConfig
): UserAuthAdmin {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");

  async function request(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    try {
      const response = await requestFetch.call(
        globalThis,
        `${baseUrl}${path}`,
        {
          ...init,
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json",
            ...init.headers
          }
        }
      );
      if (!response.ok) throw authError(response.status);
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw controlledFailure();
    }
  }

  async function readUserResponse(
    response: Response
  ): Promise<AdminUser> {
    try {
      return normalizeUser(
        rawAuthUserSchema.parse(await response.json())
      );
    } catch {
      throw controlledFailure();
    }
  }

  const userPath = (userId: string) =>
    `/auth/v1/admin/users/${encodeURIComponent(userId)}`;

  async function updateUser(
    userId: string,
    body: Record<string, unknown>
  ): Promise<AdminUser> {
    return readUserResponse(
      await request(userPath(userId), {
        method: "PUT",
        body: JSON.stringify(body)
      })
    );
  }

  return {
    async getUser(userId) {
      return readUserResponse(
        await request(userPath(userId), { method: "GET" })
      );
    },

    confirmUser(userId) {
      return updateUser(userId, { email_confirm: true });
    },

    suspendUser(userId) {
      return updateUser(userId, { ban_duration: "876000h" });
    },

    resumeUser(userId) {
      return updateUser(userId, { ban_duration: "none" });
    },

    async sendPasswordReset(email) {
      await request("/auth/v1/recover", {
        method: "POST",
        body: JSON.stringify({ email })
      });
    },

    async markDeletionPending(userId) {
      const currentResponse = await request(userPath(userId), {
        method: "GET"
      });
      let current: z.infer<typeof rawAuthUserSchema>;
      try {
        current = rawAuthUserSchema.parse(
          await currentResponse.json()
        );
      } catch {
        throw controlledFailure();
      }
      return updateUser(userId, {
        ban_duration: "876000h",
        app_metadata: {
          ...current.app_metadata,
          baan_ngern_dee_deletion_pending: true
        }
      });
    },

    async deleteUser(userId) {
      await request(
        `${userPath(userId)}?should_soft_delete=false`,
        { method: "DELETE" }
      );
    }
  };
}
