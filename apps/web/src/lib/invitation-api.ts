import {
  adminCapabilitiesSchema,
  adminInvitationListSchema,
  apiErrorCodes,
  createInvitationResponseSchema,
  inspectInvitationResponseSchema,
  redeemInvitationResponseSchema,
  type AdminCapabilities,
  type AdminInvitation,
  type ApiErrorCode,
  type CreateInvitationInput,
  type CreateInvitationResponse,
  type RedeemInvitationInput,
  type RedeemInvitationResponse
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

export class RemoteInvitationError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "RemoteInvitationError";
  }
}

async function errorFromResponse(response: Response) {
  const parsed = apiErrorSchema.safeParse(
    await response.clone().json().catch(() => null)
  );
  return parsed.success
    ? new RemoteInvitationError(
        parsed.data.error.code,
        response.status,
        parsed.data.error.message,
        parsed.data.error.requestId
      )
    : new RemoteInvitationError(
        response.status === 401
          ? "UNAUTHENTICATED"
          : "INTERNAL_ERROR",
        response.status,
        "INVITATION_REQUEST_FAILED"
      );
}

export interface PublicInvitationApi {
  inspect(
    token: string
  ): Promise<z.infer<typeof inspectInvitationResponseSchema>>;
  redeem(
    input: RedeemInvitationInput
  ): Promise<RedeemInvitationResponse>;
}

export interface AdminInvitationApi {
  capabilities(): Promise<AdminCapabilities>;
  list(): Promise<readonly AdminInvitation[]>;
  create(
    input: CreateInvitationInput
  ): Promise<CreateInvitationResponse>;
  replace(id: string): Promise<CreateInvitationResponse>;
  revoke(id: string): Promise<void>;
}

export function createPublicInvitationApi(options: {
  fetch?: typeof fetch;
} = {}): PublicInvitationApi {
  const requestFetch = options.fetch ?? fetch;

  async function post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await requestFetch(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return schema.parse(await response.json());
  }

  return {
    inspect(token) {
      return post(
        "/v1/public/invitations/inspect",
        { token },
        inspectInvitationResponseSchema
      );
    },
    redeem(input) {
      return post(
        "/v1/public/invitations/redeem",
        input,
        redeemInvitationResponseSchema
      );
    }
  };
}

export function createAdminInvitationApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): AdminInvitationApi {
  const requestFetch = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>
  ): Promise<T> {
    let session = await options.auth.getSession();
    if (!session) {
      options.onUnauthenticated();
      throw new RemoteInvitationError(
        "UNAUTHENTICATED",
        401,
        "AUTH_SESSION_REQUIRED"
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

    let response = await send(session.accessToken);
    if (response.status === 401) {
      session = await options.auth.refreshSession();
      if (!session) {
        options.onUnauthenticated();
        throw await errorFromResponse(response);
      }
      response = await send(session.accessToken);
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
    return schema.parse(await response.json());
  }

  const post = <T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>
  ) =>
    request(
      path,
      { method: "POST", body: JSON.stringify(body) },
      schema
    );

  return {
    capabilities() {
      return request(
        "/v1/admin/capabilities",
        { method: "GET" },
        adminCapabilitiesSchema
      );
    },

    async list() {
      const result = await request(
        "/v1/admin/invitations",
        { method: "GET" },
        adminInvitationListSchema
      );
      return result.invitations;
    },

    create(input) {
      return post(
        "/v1/admin/invitations",
        input,
        createInvitationResponseSchema
      );
    },

    replace(id) {
      return post(
        `/v1/admin/invitations/${encodeURIComponent(id)}/replace`,
        {},
        createInvitationResponseSchema
      );
    },

    revoke(id) {
      return request(
        `/v1/admin/invitations/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        z.void()
      );
    }
  };
}
