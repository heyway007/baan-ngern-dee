import type {
  CreateTransactionInput,
  DuplicateTransaction,
  PostedTransactionResponse,
  SlipDocumentKind,
  SlipQuotaState
} from "@systems-credit/contracts";

import type { AuthSession } from "../middleware/auth";

export type ConfirmSlipCommand = Readonly<{
  workspaceId: string;
  imageSha256: string;
  documentIdentitySha256: string | null;
  documentKind: SlipDocumentKind;
  transaction: CreateTransactionInput;
}>;

export interface SlipImportRepository {
  getQuota(
    actor: AuthSession,
    workspaceId: string
  ): Promise<SlipQuotaState>;
  findDuplicate(
    actor: AuthSession,
    workspaceId: string,
    imageSha256: string,
    documentIdentitySha256: string | null
  ): Promise<DuplicateTransaction | null>;
  consumeQuota(
    actor: AuthSession,
    workspaceId: string
  ): Promise<
    | { allowed: true; used: number; limit: 30 }
    | {
        allowed: false;
        reason: "workspace_day";
        used: 30;
        limit: 30;
      }
  >;
  confirm(
    actor: AuthSession,
    command: ConfirmSlipCommand
  ): Promise<
    | { status: "posted"; transaction: PostedTransactionResponse }
    | { status: "duplicate"; existingTransaction: DuplicateTransaction }
  >;
}
