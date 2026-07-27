import {
  adminInvitationSchema,
  type AdminInvitation
} from "@systems-credit/contracts";
import { z } from "zod";

import { ApiError } from "../api-error";
import type {
  ClaimedInvitation,
  InvitationIdentity,
  InvitationRepository
} from "./invitation-service";

export type SupabaseAdminConfig = Readonly<{
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}>;

type SupabaseErrorBody = Readonly<{
  code?: string;
  message?: string;
}>;

const rawInvitationSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().min(1),
    status: z.enum([
      "pending",
      "claimed",
      "ready",
      "busy",
      "redeemed",
      "expired",
      "revoked"
    ]),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    redeemedAt: z
      .string()
      .datetime({ offset: true })
      .optional(),
    revokedAt: z
      .string()
      .datetime({ offset: true })
      .optional()
  })
  .strict();

const invitationIdentitySchema = z
  .object({
    email: z.string().email(),
    displayName: z.string().min(1)
  })
  .strict();

const claimedInvitationSchema = invitationIdentitySchema.extend({
  id: z.string().uuid(),
  claimId: z.string().uuid()
});

function mapInvitationStatus(
  status: z.infer<typeof rawInvitationSchema>["status"]
) {
  if (status === "pending") return "ready" as const;
  if (status === "claimed") return "busy" as const;
  return status;
}

function normalizeInvitation(
  input: z.infer<typeof rawInvitationSchema>
): AdminInvitation {
  return adminInvitationSchema.parse({
    ...input,
    status: mapInvitationStatus(input.status)
  });
}

function databaseError(body: SupabaseErrorBody): ApiError {
  const messages = [
    "EMAIL_ALREADY_REGISTERED",
    "ACTIVE_INVITATION_EXISTS",
    "INVITATION_INVALID",
    "INVITATION_EXPIRED",
    "INVITATION_REDEEMED",
    "INVITATION_BUSY",
    "INVITATION_CREATE_FAILED"
  ] as const;
  const code = messages.find((candidate) =>
    body.message?.includes(candidate)
  );

  switch (code) {
    case "EMAIL_ALREADY_REGISTERED":
      return new ApiError(
        code,
        409,
        "อีเมลนี้มีบัญชีแล้ว"
      );
    case "ACTIVE_INVITATION_EXISTS":
      return new ApiError(
        code,
        409,
        "อีเมลนี้มีคำเชิญที่ยังใช้งานได้"
      );
    case "INVITATION_INVALID":
      return new ApiError(
        code,
        404,
        "ลิงก์เชิญไม่ถูกต้องหรือถูกยกเลิกแล้ว"
      );
    case "INVITATION_EXPIRED":
      return new ApiError(
        code,
        409,
        "ลิงก์เชิญหมดอายุแล้ว"
      );
    case "INVITATION_REDEEMED":
      return new ApiError(
        code,
        409,
        "ลิงก์เชิญนี้ถูกใช้แล้ว"
      );
    case "INVITATION_BUSY":
      return new ApiError(
        code,
        409,
        "คำเชิญกำลังถูกดำเนินการ กรุณาลองใหม่อีกครั้ง"
      );
    case "INVITATION_CREATE_FAILED":
      return new ApiError(
        code,
        500,
        "ยังสร้างคำเชิญไม่ได้ กรุณาลองใหม่"
      );
    default:
      return new ApiError(
        "INTERNAL_ERROR",
        500,
        "Supabase invitation request failed"
      );
  }
}

export function createSupabaseInvitationRepository(
  config: SupabaseAdminConfig
): InvitationRepository {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");

  async function rpc<T>(
    functionName: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>
  ): Promise<T> {
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
  }

  const oneInvitation = async (
    functionName: string,
    parameters: Record<string, unknown>
  ) =>
    normalizeInvitation(
      await rpc(functionName, parameters, rawInvitationSchema)
    );

  return {
    async list() {
      const rows = await rpc(
        "list_user_invitations",
        {},
        z.array(rawInvitationSchema)
      );
      return rows.map(normalizeInvitation);
    },

    create(input) {
      return oneInvitation("create_user_invitation", {
        p_email: input.email,
        p_display_name: input.displayName,
        p_token_hash: input.tokenHash,
        p_created_by: input.createdBy
      });
    },

    replace(input) {
      return oneInvitation("replace_user_invitation", {
        p_original_id: input.invitationId,
        p_token_hash: input.tokenHash,
        p_actor: input.actorUserId
      });
    },

    revoke(invitationId, actorUserId) {
      return rpc(
        "revoke_user_invitation",
        { p_id: invitationId, p_actor: actorUserId },
        z.void()
      );
    },

    inspect(tokenHash): Promise<InvitationIdentity> {
      return rpc(
        "inspect_user_invitation",
        { p_token_hash: tokenHash },
        invitationIdentitySchema
      );
    },

    claim(tokenHash): Promise<ClaimedInvitation> {
      return rpc(
        "claim_user_invitation",
        { p_token_hash: tokenHash },
        claimedInvitationSchema
      );
    },

    complete(invitationId, claimId, userId) {
      return rpc(
        "complete_user_invitation",
        {
          p_id: invitationId,
          p_claim_id: claimId,
          p_user_id: userId
        },
        z.void()
      );
    },

    release(invitationId, claimId) {
      return rpc(
        "release_user_invitation",
        { p_id: invitationId, p_claim_id: claimId },
        z.void()
      );
    }
  };
}
