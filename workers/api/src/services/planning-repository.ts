import type {
  ArchiveSavingsGoalInput,
  CreateSavingsGoalInput,
  FinancialPlan,
  InitializeBudgetMonthInput,
  InitializeBudgetMonthResult,
  MonthlyBudgetAllocation,
  RemoveMonthlyBudgetInput,
  SavingsGoal,
  SetMonthlyBudgetInput,
  UpdateSavingsGoalInput
} from "@systems-credit/contracts";

import { ApiError } from "../api-error";
import type { AuthSession } from "../middleware/auth";

export type { FinancialPlan } from "@systems-credit/contracts";

export interface PlanningRepository {
  getPlan(
    actor: AuthSession,
    workspaceId: string,
    month: string
  ): Promise<FinancialPlan>;
  initializeMonth(
    actor: AuthSession,
    input: InitializeBudgetMonthInput
  ): Promise<InitializeBudgetMonthResult>;
  setBudget(
    actor: AuthSession,
    input: SetMonthlyBudgetInput
  ): Promise<MonthlyBudgetAllocation>;
  removeBudget(
    actor: AuthSession,
    allocationId: string,
    input: RemoveMonthlyBudgetInput
  ): Promise<MonthlyBudgetAllocation>;
  createGoal(
    actor: AuthSession,
    input: CreateSavingsGoalInput
  ): Promise<SavingsGoal>;
  updateGoal(
    actor: AuthSession,
    goalId: string,
    input: UpdateSavingsGoalInput
  ): Promise<SavingsGoal>;
  archiveGoal(
    actor: AuthSession,
    goalId: string,
    input: ArchiveSavingsGoalInput
  ): Promise<SavingsGoal>;
}

export function createMemoryPlanningRepository(): PlanningRepository {
  const unavailable = (): never => {
    throw new ApiError(
      "FORBIDDEN_WORKSPACE",
      403,
      "ไม่มีสิทธิ์เข้าถึงแผนการเงินนี้"
    );
  };
  return {
    async getPlan() {
      return unavailable();
    },
    async initializeMonth() {
      return unavailable();
    },
    async setBudget() {
      return unavailable();
    },
    async removeBudget() {
      return unavailable();
    },
    async createGoal() {
      return unavailable();
    },
    async updateGoal() {
      return unavailable();
    },
    async archiveGoal() {
      return unavailable();
    }
  };
}
