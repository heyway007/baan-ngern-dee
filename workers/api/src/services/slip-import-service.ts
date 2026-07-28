import {
  type ConfirmSlipInput,
  type FinanceSnapshot,
  type PostedTransactionResponse,
  type SlipAiExtraction,
  type SlipAnalysisResponse,
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
  analyze(
    actor: AuthSession,
    command: AnalyzeSlipCommand
  ): Promise<SlipAnalysisResponse>;
  confirm(
    actor: AuthSession,
    input: ConfirmSlipInput
  ): Promise<PostedTransactionResponse>;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("th-TH")
    .replace(/\s+/g, "");
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
      const analysisToken = await dependencies.tokenCodec.issue({
        userId: actor.userId,
        workspaceId: command.workspaceId,
        imageSha256: serverHash,
        documentIdentitySha256: identity,
        documentKind: extraction.documentKind
      });
      return {
        status: "success",
        analysisToken,
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
    }
  };
}
