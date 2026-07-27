import { z } from "zod";

import { ApiError } from "../api-error";
import type { InvitationAuthAdmin } from "./invitation-service";
import type { SupabaseAdminConfig } from "./supabase-invitation-repository";

const createdUserSchema = z
  .object({
    id: z.string().uuid()
  })
  .passthrough();

type AuthAdminError = Readonly<{
  code?: string;
  error_code?: string;
  message?: string;
}>;

function authAdminError(body: AuthAdminError): ApiError {
  const combined = `${body.code ?? ""} ${
    body.error_code ?? ""
  } ${body.message ?? ""}`.toLowerCase();
  if (
    combined.includes("email_exists") ||
    combined.includes("already registered") ||
    combined.includes("already been registered")
  ) {
    return new ApiError(
      "EMAIL_ALREADY_REGISTERED",
      409,
      "อีเมลนี้มีบัญชีแล้ว"
    );
  }
  if (
    combined.includes("weak_password") ||
    combined.includes("password")
  ) {
    return new ApiError(
      "PASSWORD_POLICY_FAILED",
      400,
      "รหัสผ่านไม่ผ่านเงื่อนไข"
    );
  }
  return new ApiError(
    "INVITATION_CREATE_FAILED",
    500,
    "ยังสร้างบัญชีไม่ได้ กรุณาลองใหม่"
  );
}

export function createSupabaseAuthAdmin(
  config: SupabaseAdminConfig
): InvitationAuthAdmin {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");

  return {
    async createUser(input) {
      const response = await requestFetch.call(
        globalThis,
        `${baseUrl}/auth/v1/admin/users`,
        {
          method: "POST",
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            email_confirm: true,
            user_metadata: {
              display_name: input.displayName
            },
            app_metadata: {
              baan_ngern_dee_invitation_id:
                input.invitationId,
              baan_ngern_dee_invitation_claim_id:
                input.claimId
            }
          })
        }
      );
      if (!response.ok) {
        const body = await response
          .json<AuthAdminError>()
          .catch(() => ({}));
        throw authAdminError(body);
      }
      const user = createdUserSchema.parse(
        await response.json()
      );
      return { userId: user.id };
    }
  };
}
