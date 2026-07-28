import {
  accountBalanceSchema,
  apiErrorCodes,
  financeSnapshotSchema,
  materializeRecurringPeriodResultSchema,
  postedTransactionResponseSchema,
  postRecurringOccurrenceResultSchema,
  recurringOccurrenceSchema,
  recurringPeriodSchema,
  recurringTemplateSchema,
  type ApiErrorCode,
  type FinanceSnapshot
} from "@systems-credit/contracts";
import { z } from "zod";

import type { CloudAuth } from "./cloud-auth";
import type {
  AccountCreationResult,
  FinanceApi,
  InstallmentContractCreationResult,
  InstallmentPaymentResult,
  InstallmentPayoffResult,
  WorkspaceCreationResult
} from "./finance-api";

const uuidSchema = z.string().uuid();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const moneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workspaceSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    kind: z.enum(["private", "family"]),
    baseCurrency: currencySchema,
    timeZone: z.string(),
    role: z.enum(["owner", "editor", "viewer"]),
    version: z.number().int().positive()
  })
  .strict();

const categorySchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    parentId: uuidSchema.optional(),
    slug: z.string(),
    name: z.string(),
    kind: z.enum(["income", "expense"]),
    isDefault: z.boolean(),
    version: z.number().int().positive()
  })
  .strict();

const accountSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string(),
    type: z.enum([
      "cash",
      "bank",
      "ewallet",
      "credit_card",
      "loan",
      "asset"
    ]),
    currency: currencySchema,
    institution: z.string().optional(),
    version: z.number().int().positive()
  })
  .strict();

const workspaceCreationSchema: z.ZodType<WorkspaceCreationResult> = z
  .object({
    workspace: workspaceSchema,
    categories: z.array(categorySchema)
  })
  .strict();

const accountCreationSchema: z.ZodType<AccountCreationResult> = z
  .object({
    account: accountSchema,
    openingTransaction: z
      .object({
        transactionId: uuidSchema,
        state: z.literal("posted"),
        version: z.literal(1)
      })
      .strict()
      .optional(),
    accountBalance: accountBalanceSchema
  })
  .strict();

const scheduleRowSchema = z
  .object({
    sequence: z.number().int().positive(),
    dueDate: dateSchema,
    openingPrincipal: moneySchema,
    principal: moneySchema,
    interest: moneySchema,
    fees: moneySchema,
    total: moneySchema,
    closingPrincipal: moneySchema
  })
  .strict();

const installmentContractCreationSchema: z.ZodType<
  InstallmentContractCreationResult
> = z
  .object({
    contract: z
      .object({
        id: uuidSchema,
        workspaceId: uuidSchema,
        name: z.string(),
        kind: z.enum(["purchase", "debt"]),
        creditor: z.string().optional(),
        originalPrincipal: moneySchema,
        downPayment: moneySchema,
        financedPrincipal: moneySchema,
        financedFees: moneySchema,
        currency: currencySchema,
        interestMethod: z.enum(["zero", "flat", "reducing", "manual"]),
        annualRate: moneySchema,
        periods: z.number().int().positive(),
        firstDueDate: dateSchema,
        fundingAccountId: uuidSchema.optional(),
        expenseCategoryId: uuidSchema.optional(),
        interestCategoryId: uuidSchema.optional(),
        status: z.literal("active"),
        version: z.literal(1)
      })
      .strict(),
    schedule: z.array(scheduleRowSchema)
  })
  .strict();

const installmentPaymentSchema: z.ZodType<InstallmentPaymentResult> = z
  .object({
    paymentId: uuidSchema,
    allocation: z
      .object({
        penalty: moneySchema,
        fees: moneySchema,
        interest: moneySchema,
        principal: moneySchema,
        total: moneySchema
      })
      .strict(),
    reportableExpense: moneySchema,
    scheduleStatus: z.enum(["partially_paid", "paid"]),
    contractStatus: z.enum(["active", "paid_off"]),
    accountBalance: accountBalanceSchema,
    expenseTransactionId: uuidSchema.optional()
  })
  .passthrough();

const installmentPayoffSchema: z.ZodType<InstallmentPayoffResult> = z
  .object({
    payoffId: uuidSchema,
    action: z.enum(["extra_principal", "payoff"]),
    strategy: z.enum(["reduce_payment", "shorten_term"]).optional(),
    principalPayment: moneySchema,
    interestDue: moneySchema,
    feesDue: moneySchema,
    totalCashRequired: moneySchema,
    remainingPrincipal: moneySchema,
    interestSaved: moneySchema,
    contractStatus: z.enum(["active", "paid_off"]),
    accountBalance: accountBalanceSchema,
    expenseTransactionId: uuidSchema.optional()
  })
  .passthrough();

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

export class RemoteFinanceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "RemoteFinanceError";
  }
}

export type RemoteFinanceApi = FinanceApi &
  Readonly<{
    getSnapshot(): Promise<FinanceSnapshot>;
  }>;

export function createRemoteFinanceApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): RemoteFinanceApi {
  const requestFetch = options.fetch ?? fetch;
  let latestSnapshot: FinanceSnapshot | null = null;

  async function errorFromResponse(response: Response) {
    const parsed = apiErrorSchema.safeParse(
      await response.clone().json().catch(() => null)
    );
    return parsed.success
      ? new RemoteFinanceError(
          parsed.data.error.code,
          response.status,
          parsed.data.error.message,
          parsed.data.error.requestId
        )
      : new RemoteFinanceError(
          response.status === 401
            ? "UNAUTHENTICATED"
            : "INTERNAL_ERROR",
          response.status,
          "REMOTE_REQUEST_FAILED"
        );
  }

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>
  ): Promise<T> {
    let cloudSession = await options.auth.getSession();
    if (!cloudSession) {
      options.onUnauthenticated();
      throw new RemoteFinanceError(
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
          ...(init.body ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${accessToken}`,
          ...init.headers
        }
      });

    let response = await send(cloudSession.accessToken);
    if (response.status === 401) {
      cloudSession = await options.auth.refreshSession();
      if (!cloudSession) {
        options.onUnauthenticated();
        throw await errorFromResponse(response);
      }
      response = await send(cloudSession.accessToken);
    }

    if (!response.ok) {
      const error = await errorFromResponse(response);
      if (response.status === 401) {
        options.onUnauthenticated();
      }
      throw error;
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

  const patch = <T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>
  ) =>
    request(
      path,
      { method: "PATCH", body: JSON.stringify(body) },
      schema
    );

  function contractVersion(contractId: string) {
    const version = latestSnapshot?.installmentContracts.find(
      (contract) => contract.id === contractId
    )?.version;
    if (!version) {
      throw new Error("INSTALLMENT_SNAPSHOT_REQUIRED");
    }
    return version;
  }

  return {
    async getSnapshot() {
      const snapshot = await request(
        "/v1/snapshot",
        { method: "GET" },
        financeSnapshotSchema
      );
      latestSnapshot = snapshot;
      return snapshot;
    },

    createPrivateWorkspace(input) {
      return post(
        "/v1/workspaces/private",
        input,
        workspaceCreationSchema
      );
    },

    createAccount(input) {
      return post("/v1/accounts", input, accountCreationSchema);
    },

    async createCategory(input) {
      const result = await post(
        "/v1/categories",
        input,
        z.object({ category: categorySchema }).strict()
      );
      return result.category;
    },

    postTransaction(input) {
      return post(
        "/v1/transactions",
        input,
        postedTransactionResponseSchema
      );
    },

    voidTransaction(transactionId, input) {
      return post(
        `/v1/transactions/${encodeURIComponent(transactionId)}/void`,
        input,
        postedTransactionResponseSchema
      );
    },

    createInstallmentContract(input, clientMutationId) {
      return post(
        "/v1/installments",
        {
          ...input,
          clientMutationId:
            clientMutationId ?? crypto.randomUUID()
        },
        installmentContractCreationSchema
      );
    },

    postInstallmentPayment(input) {
      return post(
        `/v1/installments/${input.contractId}/payments`,
        {
          ...input,
          expectedVersion: contractVersion(input.contractId)
        },
        installmentPaymentSchema
      );
    },

    postInstallmentPayoff(input) {
      return post(
        `/v1/installments/${input.contractId}/payoff`,
        {
          ...input,
          expectedVersion: contractVersion(input.contractId)
        },
        installmentPayoffSchema
      );
    },

    createRecurringTemplate(input) {
      return post(
        "/v1/recurring-templates",
        input,
        recurringTemplateSchema
      );
    },

    updateRecurringTemplate(templateId, input) {
      return patch(
        `/v1/recurring-templates/${encodeURIComponent(templateId)}`,
        input,
        recurringTemplateSchema
      );
    },

    pauseRecurringTemplate(templateId, input) {
      return post(
        `/v1/recurring-templates/${encodeURIComponent(templateId)}/pause`,
        input,
        recurringTemplateSchema
      );
    },

    resumeRecurringTemplate(templateId, input) {
      return post(
        `/v1/recurring-templates/${encodeURIComponent(templateId)}/resume`,
        input,
        recurringTemplateSchema
      );
    },

    cancelRecurringTemplate(templateId, input) {
      return post(
        `/v1/recurring-templates/${encodeURIComponent(templateId)}/cancel`,
        input,
        recurringTemplateSchema
      );
    },

    materializeRecurringPeriod(input) {
      return post(
        "/v1/recurring-periods/materialize",
        input,
        materializeRecurringPeriodResultSchema
      );
    },

    getRecurringPeriod(workspaceId, period) {
      const encodedPeriod = encodeURIComponent(period);
      const encodedWorkspaceId = encodeURIComponent(workspaceId);
      return request(
        `/v1/recurring-periods/${encodedPeriod}?workspaceId=${encodedWorkspaceId}`,
        { method: "GET" },
        recurringPeriodSchema
      );
    },

    updateRecurringOccurrence(occurrenceId, input) {
      return patch(
        `/v1/recurring-occurrences/${encodeURIComponent(occurrenceId)}`,
        input,
        recurringOccurrenceSchema
      );
    },

    skipRecurringOccurrence(occurrenceId, input) {
      return post(
        `/v1/recurring-occurrences/${encodeURIComponent(occurrenceId)}/skip`,
        input,
        recurringOccurrenceSchema
      );
    },

    postRecurringOccurrence(occurrenceId, input) {
      return post(
        `/v1/recurring-occurrences/${encodeURIComponent(occurrenceId)}/post`,
        input,
        postRecurringOccurrenceResultSchema
      );
    }
  };
}
