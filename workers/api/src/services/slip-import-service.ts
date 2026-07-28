import {
  type ConfirmSlipBatchInput,
  type ConfirmSlipBatchResult,
  type ConfirmSlipInput,
  type CreateTransactionInput,
  type FinanceSnapshot,
  type PostedTransactionResponse,
  type SlipAiExtraction,
  type SlipAnalysisResponse,
  type SlipQuotaState,
  type SlipTransactionDraft
} from "@systems-credit/contracts";

import { ApiError } from "../api-error";
import type { AuthSession } from "../middleware/auth";
import type { FinanceRepository } from "./finance-repository";
import type { SlipAnalysisTokenCodec } from "./slip-analysis-token";
import { buildDocumentIdentity } from "./slip-identity";
import { sha256Hex, validateSlipImage } from "./slip-image";
import type { SlipImportRepository } from "./slip-import-repository";
import {
  SlipVisionUnavailableError,
  type SlipVisionExtractor
} from "./slip-vision-extractor";

export type AnalyzeSlipCommand = Readonly<{
  workspaceId: string;
  bytes: Uint8Array;
  claimedMime: string;
  imageSha256: string;
}>;

export interface SlipImportService {
  getQuota(
    actor: AuthSession,
    workspaceId: string
  ): Promise<SlipQuotaState>;
  analyze(
    actor: AuthSession,
    command: AnalyzeSlipCommand
  ): Promise<SlipAnalysisResponse>;
  confirm(
    actor: AuthSession,
    input: ConfirmSlipInput
  ): Promise<PostedTransactionResponse>;
  confirmBatch(
    actor: AuthSession,
    input: ConfirmSlipBatchInput
  ): Promise<ConfirmSlipBatchResult>;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("th-TH")
    .replace(/\s+/g, "");
}

function canonicalTransaction(
  transaction: CreateTransactionInput
): CreateTransactionInput {
  return {
    workspaceId: transaction.workspaceId,
    accountId: transaction.accountId,
    type: transaction.type,
    amount: transaction.amount,
    currency: transaction.currency,
    financialDate: transaction.financialDate,
    ...(transaction.categoryId
      ? { categoryId: transaction.categoryId }
      : {}),
    ...(transaction.merchantId
      ? { merchantId: transaction.merchantId }
      : {}),
    ...(transaction.note ? { note: transaction.note } : {}),
    tagIds: [...transaction.tagIds],
    ...(transaction.splits
      ? {
          splits: transaction.splits.map((split) => ({
            categoryId: split.categoryId,
            amount: split.amount,
            ...(split.note ? { note: split.note } : {})
          }))
        }
      : {}),
    clientMutationId: transaction.clientMutationId
  };
}

function draftFrom(
  extraction: SlipAiExtraction,
  snapshot: FinanceSnapshot
): SlipTransactionDraft {
  const type = extraction.suggestedType ?? "expense";
  const review = new Set<SlipTransactionDraft["fieldsNeedingReview"][number]>();
  if (!extraction.suggestedType || extraction.confidence.suggestedType < 0.7) {
    review.add("type");
  }
  if (!extraction.amount || extraction.confidence.amount < 0.7) {
    review.add("amount");
  }
  if (!extraction.financialDate || extraction.confidence.financialDate < 0.7) {
    review.add("financialDate");
  }
  const institution = extraction.institution
    ? normalize(extraction.institution)
    : "";
  const matchingAccounts = institution
    ? snapshot.accounts.filter((account) =>
        normalize(`${account.institution ?? ""}${account.name}`)
          .includes(institution)
      )
    : [];
  const account = matchingAccounts.length === 1
    ? matchingAccounts[0]
    : snapshot.accounts[0];
  if (matchingAccounts.length !== 1) review.add("account");

  const categories = snapshot.categories.filter(
    (category) => category.kind === type
  );
  const merchant = extraction.merchant
    ? normalize(extraction.merchant)
    : "";
  const matchedCategory = merchant
    ? categories.find((category) =>
        merchant.includes(normalize(category.name))
      )
    : undefined;
  const category = matchedCategory ?? categories[0];
  if (!matchedCategory) review.add("category");

  const note = [
    extraction.merchant && `ร้านค้า: ${extraction.merchant}`,
    extraction.sender && `ผู้โอน: ${extraction.sender}`,
    extraction.recipient && `ผู้รับ: ${extraction.recipient}`,
    extraction.reference && `อ้างอิง: ${extraction.reference}`
  ].filter(Boolean).join(" · ").slice(0, 500);

  return {
    type,
    ...(extraction.amount ? { amount: extraction.amount } : {}),
    currency: extraction.currency ?? snapshot.workspace?.baseCurrency ?? "THB",
    ...(extraction.financialDate
      ? { financialDate: extraction.financialDate }
      : {}),
    ...(account ? { accountId: account.id } : {}),
    ...(category ? { categoryId: category.id } : {}),
    ...(note ? { note } : {}),
    ...(extraction.reference ? { reference: extraction.reference } : {}),
    fieldsNeedingReview: Array.from(review)
  };
}

export function createSlipImportService(dependencies: {
  repository: SlipImportRepository;
  financeRepository: Pick<FinanceRepository, "getSnapshot">;
  extractor: SlipVisionExtractor;
  tokenCodec: SlipAnalysisTokenCodec;
}): SlipImportService {
  return {
    getQuota(actor, workspaceId) {
      return dependencies.repository.getQuota(actor, workspaceId);
    },
    async analyze(actor, command) {
      let image;
      try {
        image = validateSlipImage(command.bytes, command.claimedMime);
      } catch {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "รูปต้องเป็น JPG, PNG หรือ WebP และมีขนาดไม่เกิน 5 MB"
        );
      }
      const serverHash = await sha256Hex(image.bytes);
      if (serverHash !== command.imageSha256) {
        throw new ApiError("VALIDATION_FAILED", 400, "ลายนิ้วมือรูปไม่ตรงกัน");
      }
      const snapshot = await dependencies.financeRepository.getSnapshot(actor);
      if (snapshot.workspace?.id !== command.workspaceId) {
        throw new ApiError("FORBIDDEN_WORKSPACE", 403, "ไม่มีสิทธิ์ในพื้นที่นี้");
      }
      const duplicate = await dependencies.repository.findDuplicate(
        actor,
        command.workspaceId,
        serverHash,
        null
      );
      if (duplicate) return { status: "duplicate", existingTransaction: duplicate };

      const quota = await dependencies.repository.consumeQuota(
        actor,
        command.workspaceId
      );
      if (!quota.allowed) {
        throw new ApiError(
          "RATE_LIMITED",
          429,
          "ใช้การอ่านสลิปครบตามจำนวนชั่วคราวแล้ว กรุณาลองใหม่ภายหลัง"
        );
      }
      let extraction;
      try {
        extraction = await dependencies.extractor.extract(image);
      } catch (error) {
        if (error instanceof SlipVisionUnavailableError) {
          throw new ApiError(
            "AI_UNAVAILABLE",
            503,
            "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง",
            { slipVisionCategory: error.category }
          );
        }
        throw error;
      }
      if (extraction.documentKind === "unsupported") {
        return { status: "unsupported" };
      }
      const identity = await buildDocumentIdentity(extraction);
      if (identity) {
        const identityDuplicate = await dependencies.repository.findDuplicate(
          actor,
          command.workspaceId,
          serverHash,
          identity
        );
        if (identityDuplicate) {
          return {
            status: "duplicate",
            existingTransaction: identityDuplicate
          };
        }
      }
      const issued = await dependencies.tokenCodec.issue({
        userId: actor.userId,
        workspaceId: command.workspaceId,
        imageSha256: serverHash,
        documentIdentitySha256: identity,
        documentKind: extraction.documentKind
      });
      return {
        status: "success",
        analysisToken: issued.token,
        analysisExpiresAt: issued.expiresAt,
        documentKind: extraction.documentKind,
        draft: draftFrom(extraction, snapshot)
      };
    },
    async confirm(actor, input) {
      const claims = await dependencies.tokenCodec.verify(
        input.analysisToken,
        { userId: actor.userId, workspaceId: input.transaction.workspaceId }
      ).catch(() => {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ผลอ่านสลิปหมดอายุ กรุณาอ่านรูปอีกครั้ง"
        );
      });
      const result = await dependencies.repository.confirm(actor, {
        workspaceId: claims.workspaceId,
        imageSha256: claims.imageSha256,
        documentIdentitySha256: claims.documentIdentitySha256,
        documentKind: claims.documentKind,
        transaction: input.transaction
      });
      if (result.status === "duplicate") {
        throw new ApiError(
          "DUPLICATE_DOCUMENT",
          409,
          "สลิปหรือใบเสร็จนี้ถูกบันทึกแล้ว"
        );
      }
      return result.transaction;
    },
    async confirmBatch(actor, input) {
      const verified: Array<{
        item: ConfirmSlipBatchInput["items"][number];
        claims: Awaited<ReturnType<SlipAnalysisTokenCodec["verify"]>>;
      }> = [];
      const issues: Extract<
        ConfirmSlipBatchResult,
        { status: "blocked" }
      >["issues"] = [];

      for (const item of input.items) {
        try {
          const claims = await dependencies.tokenCodec.verify(
            item.analysisToken,
            { userId: actor.userId, workspaceId: input.workspaceId }
          );
          verified.push({ item, claims });
        } catch (error) {
          issues.push({
            itemId: item.itemId,
            code: error instanceof Error &&
              error.message === "TOKEN_EXPIRED"
              ? "expired_analysis"
              : "invalid_analysis"
          });
        }
      }
      if (issues.length > 0) return { status: "blocked", issues };

      const imageHashes = new Set<string>();
      const documentIdentities = new Set<string>();
      for (const entry of verified) {
        const repeatedImage = imageHashes.has(entry.claims.imageSha256);
        const identity = entry.claims.documentIdentitySha256;
        const repeatedIdentity = identity !== null &&
          documentIdentities.has(identity);
        if (repeatedImage || repeatedIdentity) {
          issues.push({ itemId: entry.item.itemId, code: "duplicate" });
        }
        imageHashes.add(entry.claims.imageSha256);
        if (identity !== null) documentIdentities.add(identity);
      }
      if (issues.length > 0) return { status: "blocked", issues };

      const items = verified.map(({ item, claims }) => ({
        itemId: item.itemId,
        imageSha256: claims.imageSha256,
        documentIdentitySha256: claims.documentIdentitySha256,
        documentKind: claims.documentKind,
        transaction: canonicalTransaction(item.transaction)
      }));
      const requestSha256 = await sha256Hex(
        new TextEncoder().encode(JSON.stringify(items))
      );
      return dependencies.repository.confirmBatch(actor, {
        workspaceId: input.workspaceId,
        batchMutationId: input.batchMutationId,
        requestSha256,
        items
      });
    }
  };
}
