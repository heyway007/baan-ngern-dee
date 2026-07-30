import {
  adminUserSchema,
  type AdminUser,
  type ListAdminUsersQuery
} from "@systems-credit/contracts";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { SupabaseAdminConfig } from "./supabase-invitation-repository";
import type { UserManagementRepository } from "./user-management-service";

type SupabaseErrorBody = Readonly<{
  code?: string;
  message?: string;
}>;

const rawAdminUserSchema = z
  .object({
    user_id: z.string().uuid(),
    email: z.string().email().nullable(),
    display_name: z.string().min(1).max(80),
    status: z.enum([
      "unconfirmed",
      "active",
      "suspended",
      "deletion_pending"
    ]),
    created_at: z.string().datetime({ offset: true }),
    last_sign_in_at: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    email_confirmed_at: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    banned_until: z
      .string()
      .datetime({ offset: true })
      .nullable(),
    private_workspace_count: z.number().int().nonnegative(),
    deletion_pending: z.boolean()
  })
  .strict();

const deletionStateSchema = z
  .object({
    purge_completed: z.boolean(),
    completed: z.boolean()
  })
  .strict();

const purgeResultSchema = z
  .object({
    private_workspaces_deleted: z.number().int().nonnegative()
  })
  .strict();

function controlledFailure(): ApiError {
  return new ApiError(
    "USER_ADMIN_ACTION_FAILED",
    500,
    "ไม่สามารถจัดการผู้ใช้ได้ กรุณาลองใหม่"
  );
}

function databaseError(body: SupabaseErrorBody): ApiError {
  if (body.message?.includes("USER_SHARED_DATA_CONFLICT")) {
    return new ApiError(
      "USER_SHARED_DATA_CONFLICT",
      409,
      "ผู้ใช้นี้ยังมีข้อมูลที่ใช้ร่วมกับผู้อื่น จึงยังลบบัญชีไม่ได้"
    );
  }
  if (body.message?.includes("USER_ADMIN_RATE_LIMITED")) {
    return new ApiError(
      "USER_ADMIN_RATE_LIMITED",
      429,
      "ดำเนินการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"
    );
  }
  return controlledFailure();
}

function normalizeUser(
  raw: z.infer<typeof rawAdminUserSchema>
): AdminUser {
  return adminUserSchema.parse({
    userId: raw.user_id,
    ...(raw.email ? { email: raw.email } : {}),
    displayName: raw.display_name,
    status: raw.status,
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
    privateWorkspaceCount: raw.private_workspace_count,
    deletionPending: raw.deletion_pending
  });
}

function parseCursor(cursor?: string): {
  createdAt: string | null;
  userId: string | null;
} {
  if (!cursor) {
    return { createdAt: null, userId: null };
  }
  const separator = cursor.lastIndexOf("|");
  return {
    createdAt: cursor.slice(0, separator),
    userId: cursor.slice(separator + 1)
  };
}

export function createSupabaseUserManagementRepository(
  config: SupabaseAdminConfig
): UserManagementRepository {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");

  async function rpc<T>(
    functionName: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>
  ): Promise<T> {
    try {
      const response = await requestFetch.call(
        globalThis,
        `${baseUrl}/rest/v1/rpc/${functionName}`,
        {
          method: "POST",
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(parameters)
        }
      );
      if (!response.ok) {
        const body = await response
          .json<SupabaseErrorBody>()
          .catch(() => ({}));
        throw databaseError(body);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return schema.parse(await response.json());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw controlledFailure();
    }
  }

  return {
    async list(input: ListAdminUsersQuery) {
      const cursor = parseCursor(input.cursor);
      const rows = await rpc(
        "list_admin_users",
        {
          p_search_text: input.search,
          p_page_limit: input.limit + 1,
          p_cursor_created_at: cursor.createdAt,
          p_cursor_user_id: cursor.userId
        },
        z.array(rawAdminUserSchema)
      );
      const visibleRows = rows.slice(0, input.limit);
      const users = visibleRows.map(normalizeUser);
      const lastUser = users.at(-1);
      return {
        users,
        nextCursor:
          rows.length > input.limit && lastUser
            ? `${lastUser.createdAt}|${lastUser.userId}`
            : null
      };
    },

    recordAction(input) {
      return rpc(
        "record_user_admin_action",
        {
          p_actor_user_id: input.actorUserId,
          p_target_user_id: input.targetUserId,
          p_action: input.action,
          p_details: input.details
        },
        z.void()
      );
    },

    async getDeletionState(input) {
      const rows = await rpc(
        "get_user_deletion_state",
        {
          p_target_user_id: input.targetUserId,
          p_client_mutation_id: input.clientMutationId
        },
        z.array(deletionStateSchema).max(1)
      );
      const state = rows[0];
      return state
        ? {
            purgeCompleted: state.purge_completed,
            completed: state.completed
          }
        : null;
    },

    async purgePrivateData(input) {
      const rows = await rpc(
        "purge_private_user_data",
        {
          p_actor_user_id: input.actorUserId,
          p_target_user_id: input.targetUserId,
          p_client_mutation_id: input.clientMutationId,
          p_normalized_email: input.confirmation
        },
        z.array(purgeResultSchema).length(1)
      );
      return {
        privateWorkspacesDeleted:
          rows[0]!.private_workspaces_deleted
      };
    },

    completeDeletion(input) {
      return rpc(
        "complete_user_deletion",
        {
          p_actor_user_id: input.actorUserId,
          p_target_user_id: input.targetUserId,
          p_client_mutation_id: input.clientMutationId
        },
        z.void()
      );
    }
  };
}
