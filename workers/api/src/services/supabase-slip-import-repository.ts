import {
  duplicateTransactionSchema,
  postedTransactionResponseSchema
} from "@systems-credit/contracts";
import { z } from "zod";

import type { SlipImportRepository } from "./slip-import-repository";
import {
  SupabaseRestClient,
  type SupabaseConfig
} from "./supabase-client";

const quotaSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      reason: z.enum(["user_hour", "workspace_day"])
    })
    .strict()
]);
const confirmationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("posted"),
      transaction: postedTransactionResponseSchema
    })
    .strict(),
  z
    .object({
      status: z.literal("duplicate"),
      existingTransaction: duplicateTransactionSchema
    })
    .strict()
]);

export function createSupabaseSlipImportRepository(
  config: SupabaseConfig
): SlipImportRepository {
  const client = new SupabaseRestClient(config);
  return {
    async findDuplicate(
      actor,
      workspaceId,
      imageSha256,
      documentIdentitySha256
    ) {
      const result = await client.rpc<unknown>(
        actor,
        "find_financial_document_duplicate",
        {
          p_workspace_id: workspaceId,
          p_image_sha256: imageSha256,
          p_document_identity_sha256: documentIdentitySha256
        }
      );
      return result === null ? null : duplicateTransactionSchema.parse(result);
    },
    async consumeQuota(actor, workspaceId) {
      return quotaSchema.parse(
        await client.rpc(actor, "consume_slip_analysis_quota", {
          p_workspace_id: workspaceId
        })
      );
    },
    async confirm(actor, command) {
      return confirmationSchema.parse(
        await client.rpc(actor, "confirm_financial_document_import", {
          p_input: command
        })
      );
    }
  };
}
