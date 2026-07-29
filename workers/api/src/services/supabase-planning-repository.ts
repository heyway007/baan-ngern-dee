import {
  financialPlanSchema,
  initializeBudgetMonthResultSchema,
  monthlyBudgetAllocationSchema,
  savingsGoalSchema
} from "@systems-credit/contracts";

import type { PlanningRepository } from "./planning-repository";
import {
  SupabaseRestClient,
  type SupabaseConfig
} from "./supabase-client";

export function createSupabasePlanningRepository(
  config: SupabaseConfig
): PlanningRepository {
  const client = new SupabaseRestClient(config);
  return {
    async getPlan(actor, workspaceId, month) {
      return financialPlanSchema.parse(
        await client.rpc(actor, "get_financial_plan", {
          p_workspace_id: workspaceId,
          p_month: month
        })
      );
    },
    async initializeMonth(actor, input) {
      return initializeBudgetMonthResultSchema.parse(
        await client.rpc(actor, "initialize_budget_month", {
          p_input: input
        })
      );
    },
    async setBudget(actor, input) {
      return monthlyBudgetAllocationSchema.parse(
        await client.rpc(actor, "set_monthly_budget", {
          p_input: input
        })
      );
    },
    async removeBudget(actor, allocationId, input) {
      return monthlyBudgetAllocationSchema.parse(
        await client.rpc(actor, "remove_monthly_budget", {
          p_id: allocationId,
          p_expected_version: input.version
        })
      );
    },
    async createGoal(actor, input) {
      return savingsGoalSchema.parse(
        await client.rpc(actor, "create_savings_goal", {
          p_input: input
        })
      );
    },
    async updateGoal(actor, goalId, input) {
      return savingsGoalSchema.parse(
        await client.rpc(actor, "update_savings_goal", {
          p_id: goalId,
          p_input: input
        })
      );
    },
    async archiveGoal(actor, goalId, input) {
      return savingsGoalSchema.parse(
        await client.rpc(actor, "archive_savings_goal", {
          p_id: goalId,
          p_expected_version: input.version
        })
      );
    }
  };
}
