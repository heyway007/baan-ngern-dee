import type {
  CreateTransactionInput,
  DuplicateTransaction,
  PostedTransactionResponse,
  SlipDocumentKind
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
    | { allowed: true }
    | { allowed: false; reason: "user_hour" | "workspace_day" }
  >;
  confirm(
    actor: AuthSession,
    command: ConfirmSlipCommand
  ): Promise<
    | { status: "posted"; transaction: PostedTransactionResponse }
    | { status: "duplicate"; existingTransaction: DuplicateTransaction }
  >;
}
