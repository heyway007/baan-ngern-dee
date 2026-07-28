import {
  adminUserListResponseSchema,
  adminUserMutationResponseSchema,
  apiErrorCodes,
  listAdminUsersQuerySchema,
  type AdminUserListResponse,
  type AdminUserMutationResponse,
  type ApiErrorCode,
  type DeleteAdminUserInput,
  type ListAdminUsersQuery
} from "@systems-credit/contracts";
import { z } from "zod";

import type { CloudAuth } from "./cloud-auth";

const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(apiErrorCodes),
        message: z.string(),
        requestId: z.string()
      })
      .strict()
  })
  .strict();

export class UserManagementApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "UserManagementApiFailure";
  }
}

function genericFailure(): UserManagementApiFailure {
  return new UserManagementApiFailure(
    "USER_ADMIN_ACTION_FAILED",
    "ยังจัดการผู้ใช้ไม่ได้ กรุณาลองใหม่"
  );
}

async function errorFromResponse(
  response: Response
): Promise<UserManagementApiFailure> {
  const parsed = apiErrorSchema.safeParse(
    await response.clone().json().catch(() => null)
  );
  if (parsed.success) {
    return new UserManagementApiFailure(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.requestId
    );
  }
  if (response.status === 401) {
    return new UserManagementApiFailure(
      "UNAUTHENTICATED",
      "กรุณาเข้าสู่ระบบอีกครั้ง"
    );
  }
  return genericFailure();
}

export interface UserManagementApi {
  list(
    query: ListAdminUsersQuery
  ): Promise<AdminUserListResponse>;
  confirm(userId: string): Promise<AdminUserMutationResponse>;
  suspend(userId: string): Promise<AdminUserMutationResponse>;
  resume(userId: string): Promise<AdminUserMutationResponse>;
  sendPasswordReset(userId: string): Promise<void>;
  delete(
    userId: string,
    input: DeleteAdminUserInput
  ): Promise<void>;
}

export function createUserManagementApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): UserManagementApi {
  const requestFetch = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>
  ): Promise<T> {
    let session;
    try {
      session = await options.auth.getSession();
    } catch {
      throw genericFailure();
    }
    if (!session) {
      options.onUnauthenticated();
      throw new UserManagementApiFailure(
        "UNAUTHENTICATED",
        "กรุณาเข้าสู่ระบบอีกครั้ง"
      );
    }

    const send = (accessToken: string) =>
      requestFetch(path, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body
            ? { "content-type": "application/json" }
            : {}),
          authorization: `Bearer ${accessToken}`,
          ...init.headers
        }
      });

    let response: Response;
    try {
      response = await send(session.accessToken);
      if (response.status === 401) {
        session = await options.auth.refreshSession();
        if (!session) {
          options.onUnauthenticated();
          throw await errorFromResponse(response);
        }
        response = await send(session.accessToken);
      }
    } catch (error) {
      if (error instanceof UserManagementApiFailure) {
        throw error;
      }
      throw genericFailure();
    }

    if (!response.ok) {
      if (response.status === 401) {
        options.onUnauthenticated();
      }
      throw await errorFromResponse(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }

    const parsed = schema.safeParse(
      await response.json().catch(() => null)
    );
    if (!parsed.success) throw genericFailure();
    return parsed.data;
  }

  const mutation = (
    userId: string,
    action: "confirm" | "suspend" | "resume"
  ) =>
    request(
      `/v1/admin/users/${encodeURIComponent(userId)}/${action}`,
      { method: "POST" },
      adminUserMutationResponseSchema
    );

  return {
    list(query) {
      const parsed = listAdminUsersQuerySchema.parse(query);
      const parameters = new URLSearchParams();
      parameters.set("search", parsed.search);
      parameters.set("limit", String(parsed.limit));
      if (parsed.cursor) {
        parameters.set("cursor", parsed.cursor);
      }
      return request(
        `/v1/admin/users?${parameters.toString()}`,
        { method: "GET" },
        adminUserListResponseSchema
      );
    },

    confirm(userId) {
      return mutation(userId, "confirm");
    },

    suspend(userId) {
      return mutation(userId, "suspend");
    },

    resume(userId) {
      return mutation(userId, "resume");
    },

    sendPasswordReset(userId) {
      return request(
        `/v1/admin/users/${encodeURIComponent(userId)}/password-reset`,
        { method: "POST" },
        z.void()
      );
    },

    delete(userId, input) {
      return request(
        `/v1/admin/users/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          body: JSON.stringify(input)
        },
        z.void()
      );
    }
  };
}
