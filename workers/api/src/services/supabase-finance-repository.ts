import {
  financeSnapshotSchema,
  materializeRecurringPeriodResultSchema,
  postRecurringOccurrenceResultSchema,
  recurringOccurrenceSchema,
  recurringPeriodSchema,
  recurringTemplateSchema,
  type Account,
  type Category,
  type PostedTransferResponse,
  type Workspace
} from "@systems-credit/contracts";
import { z } from "zod";
import {
  generateInstallmentSchedule,
  generateManualInstallmentSchedule,
  parseMoney,
  roundMoney,
  simulateInstallmentPayoff
} from "@systems-credit/domain";

import { ApiError } from "../api-error";
import type { AuthSession } from "../middleware/auth";
import type {
  FinanceRepository,
  InstallmentContractResult,
  InstallmentPayoffResponse,
  InstallmentPaymentResponse
} from "./finance-repository";
import {
  SupabaseRestClient,
  type SupabaseConfig
} from "./supabase-client";

type WorkspaceRow = Readonly<{
  id: string;
  name: string;
  kind: "private" | "family";
  base_currency: string;
  timezone: string;
  version: number;
}>;

type CategoryRow = Readonly<{
  id: string;
  workspace_id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  kind: "income" | "expense";
  is_default: boolean;
  version: number;
}>;

type InstallmentContractRow = Readonly<{
  interest_method: "zero" | "flat" | "reducing" | "manual";
  annual_rate: string;
  currency: string;
  version: number;
}>;

type InstallmentScheduleRow = Readonly<{
  sequence: number;
  due_date: string;
  scheduled_principal: string;
  scheduled_interest: string;
  scheduled_fees: string;
  scheduled_penalty: string;
  paid_principal: string;
  paid_interest: string;
  paid_fees: string;
  paid_penalty: string;
  status: string;
}>;

type CloudMutationResult<T> = Readonly<{
  response: T;
  replayed: boolean;
}>;

const recurringPostMutationResultSchema = z
  .object({
    response: postRecurringOccurrenceResultSchema,
    replayed: z.boolean()
  })
  .strict();

function categoryFromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    isDefault: row.is_default,
    version: row.version
  };
}

async function mutationExists(
  client: SupabaseRestClient,
  actor: AuthSession,
  table: string,
  clientMutationId: string
) {
  const rows = await client.request<Array<{ id: string }>>(
    actor,
    `${table}?select=id&client_mutation_id=eq.${encodeURIComponent(
      clientMutationId
    )}&limit=1`
  );
  return rows.length > 0;
}

export function createSupabaseFinanceRepository(
  config: SupabaseConfig
): FinanceRepository {
  const client = new SupabaseRestClient(config);

  return {
    async getSnapshot(actor) {
      const body = await client.rpc<unknown>(
        actor,
        "get_finance_snapshot",
        {}
      );
      return financeSnapshotSchema.parse(body);
    },

    async createPrivateWorkspace(actor, input) {
      const rows = await client.rpc<WorkspaceRow[]>(
        actor,
        "create_private_workspace",
        {
          p_name: input.name,
          p_base_currency: input.baseCurrency,
          p_timezone: input.timeZone
        }
      );
      const row = rows[0]!;
      const categories = await client.request<CategoryRow[]>(
        actor,
        `categories?select=id,workspace_id,parent_id,slug,name,kind,is_default,version&workspace_id=eq.${row.id}&order=kind.asc,name.asc`
      );
      const workspace: Workspace = {
        id: row.id,
        name: row.name,
        kind: row.kind,
        baseCurrency: row.base_currency,
        timeZone: row.timezone,
        role: "owner",
        version: row.version
      };
      return {
        workspace,
        categories: categories.map(categoryFromRow)
      };
    },

    async createCategory(actor, input) {
      const id = crypto.randomUUID();
      const rows = await client.request<CategoryRow[]>(
        actor,
        "categories?select=id,workspace_id,parent_id,slug,name,kind,is_default,version",
        {
          method: "POST",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({
            id,
            workspace_id: input.workspaceId,
            parent_id: input.parentId ?? null,
            slug: `custom-${id}`,
            name: input.name,
            kind: input.kind,
            is_default: false,
            created_by: actor.userId
          })
        }
      );
      return categoryFromRow(rows[0]!);
    },

    createAccount(actor, input) {
      return client.rpc(actor, "create_account_with_opening_balance", {
        p_input: input
      });
    },

    postTransaction(actor, input) {
      return client.rpc(actor, "post_transaction", {
        p_input: input
      });
    },

    voidTransaction(actor, transactionId, input) {
      return client.rpc(actor, "void_transaction", {
        p_transaction_id: transactionId,
        p_version: input.version,
        p_reason: input.reason
      });
    },

    async postTransfer(actor, input) {
      const replayed = await mutationExists(
        client,
        actor,
        "transfers",
        input.clientMutationId
      );
      const response = await client.rpc<PostedTransferResponse>(
        actor,
        "post_transfer",
        { p_input: input }
      );
      return { response, replayed };
    },

    async createInstallmentContract(
      actor,
      input,
      clientMutationId
    ) {
      const original = parseMoney({
        amount: input.originalPrincipal,
        currency: input.currency
      });
      const downPayment = parseMoney({
        amount: input.downPayment,
        currency: input.currency
      });
      const financedPrincipal = roundMoney(
        original.minus(downPayment),
        input.currency
      );
      const schedule =
        input.interestMethod === "manual"
          ? generateManualInstallmentSchedule({
              principal: financedPrincipal,
              currency: input.currency,
              rows: input.manualRows ?? []
            })
          : generateInstallmentSchedule({
              principal: financedPrincipal,
              financedFees: input.financedFees,
              currency: input.currency,
              interestMethod: input.interestMethod,
              annualRate: input.annualRate,
              periods: input.periods,
              firstDueDate: input.firstDueDate
            });
      return client.rpc<
        CloudMutationResult<InstallmentContractResult>
      >(actor, "create_installment_contract", {
        p_input: {
          ...input,
          financedPrincipal,
          schedule,
          clientMutationId
        }
      });
    },

    async postInstallmentPayment(actor, input) {
      return client.rpc<
        CloudMutationResult<InstallmentPaymentResponse>
      >(actor, "post_installment_payment", { p_input: input });
    },

    async postInstallmentPayoff(actor, input) {
      const replayed = await mutationExists(
        client,
        actor,
        "installment_payoffs",
        input.clientMutationId
      );
      if (replayed) {
        return client.rpc<
          CloudMutationResult<InstallmentPayoffResponse>
        >(actor, "post_installment_payoff", { p_input: input });
      }
      const contracts = await client.request<
        InstallmentContractRow[]
      >(
        actor,
        `installment_contracts?select=interest_method,annual_rate,currency,version&id=eq.${input.contractId}&workspace_id=eq.${input.workspaceId}&limit=1`
      );
      const contract = contracts[0];
      if (!contract) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงสัญญานี้"
        );
      }
      const rows = await client.request<InstallmentScheduleRow[]>(
        actor,
        `installment_schedule_rows?select=sequence,due_date,scheduled_principal,scheduled_interest,scheduled_fees,scheduled_penalty,paid_principal,paid_interest,paid_fees,paid_penalty,status&contract_id=eq.${input.contractId}&status=not.in.(paid,cancelled,waived)&order=sequence.asc`
      );
      const replayThroughRpc = () =>
        client.rpc<
          CloudMutationResult<InstallmentPayoffResponse>
        >(actor, "post_installment_payoff", { p_input: input });
      if (rows.length === 0) {
        return replayThroughRpc();
      }
      const remaining = (scheduled: string, paid: string) =>
        roundMoney(
          parseMoney({
            amount: scheduled,
            currency: input.currency
          }).minus(
            parseMoney({
              amount: paid,
              currency: input.currency
            })
          ),
          input.currency
        );
      let simulation: ReturnType<
        typeof simulateInstallmentPayoff
      >;
      try {
        simulation = simulateInstallmentPayoff({
          action: input.action,
          ...(input.strategy ? { strategy: input.strategy } : {}),
          ...(input.extraPrincipal
            ? { extraPrincipal: input.extraPrincipal }
            : {}),
          currency: input.currency,
          interestMethod: contract.interest_method,
          annualRate: contract.annual_rate,
          paymentDate: input.financialDate,
          remainingPrincipal: input.expectedRemainingPrincipal,
          quotedInterest: input.quotedInterest,
          quotedFees: input.quotedFees,
          unpaidRows: rows.map((row) => ({
            sequence: row.sequence,
            dueDate: row.due_date,
            principal: remaining(
              row.scheduled_principal,
              row.paid_principal
            ),
            interest: remaining(
              row.scheduled_interest,
              row.paid_interest
            ),
            fees: remaining(row.scheduled_fees, row.paid_fees),
            penalty: remaining(
              row.scheduled_penalty,
              row.paid_penalty
            )
          }))
        });
      } catch {
        return replayThroughRpc();
      }
      return client.rpc<
        CloudMutationResult<InstallmentPayoffResponse>
      >(actor, "post_installment_payoff", {
          p_input: {
            ...input,
            principalPayment: simulation.principalPayment,
            totalCashRequired: simulation.totalCashRequired,
            remainingPrincipal: simulation.remainingPrincipal,
            interestSaved: simulation.interestSaved,
            regeneratedRows: simulation.regeneratedRows
          }
      });
    },

    async createRecurringTemplate(actor, input) {
      return recurringTemplateSchema.parse(
        await client.rpc(actor, "create_recurring_template", {
          p_input: input
        })
      );
    },

    async updateRecurringTemplate(actor, templateId, input) {
      return recurringTemplateSchema.parse(
        await client.rpc(actor, "update_recurring_template", {
          p_id: templateId,
          p_input: input
        })
      );
    },

    async setRecurringTemplateStatus(
      actor,
      templateId,
      status,
      version
    ) {
      return recurringTemplateSchema.parse(
        await client.rpc(
          actor,
          "set_recurring_template_status",
          {
            p_id: templateId,
            p_expected_version: version,
            p_status: status
          }
        )
      );
    },

    async materializeRecurringPeriod(actor, input) {
      return materializeRecurringPeriodResultSchema.parse(
        await client.rpc(actor, "materialize_recurring_period", {
          p_input: input
        })
      );
    },

    async getRecurringPeriod(actor, workspaceId, period) {
      return recurringPeriodSchema.parse(
        await client.rpc(actor, "get_recurring_period", {
          p_workspace_id: workspaceId,
          p_period: period
        })
      );
    },

    async updateRecurringOccurrence(actor, occurrenceId, input) {
      return recurringOccurrenceSchema.parse(
        await client.rpc(actor, "update_recurring_occurrence", {
          p_id: occurrenceId,
          p_input: input
        })
      );
    },

    async skipRecurringOccurrence(actor, occurrenceId, version) {
      return recurringOccurrenceSchema.parse(
        await client.rpc(actor, "skip_recurring_occurrence", {
          p_id: occurrenceId,
          p_expected_version: version
        })
      );
    },

    async postRecurringOccurrence(actor, occurrenceId, input) {
      return recurringPostMutationResultSchema.parse(
        await client.rpc(actor, "post_recurring_occurrence", {
          p_id: occurrenceId,
          p_input: input
        })
      );
    }
  };
}
