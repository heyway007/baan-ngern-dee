import Decimal from "decimal.js";

import { allocateMoney, parseMoney, roundMoney } from "./money";

export type PlanningCategory = Readonly<{
  id: string;
  name: string;
}>;

export type PlanningAllocationFact = Readonly<{
  categoryId: string;
  month: string;
  amount: string;
}>;

export type PlanningExpenseFact = Readonly<{
  categoryId: string;
  month: string;
  baseAmount: string;
}>;

export type BudgetPlanInput = Readonly<{
  selectedMonth: string;
  currency: string;
  categories: readonly PlanningCategory[];
  allocations: readonly PlanningAllocationFact[];
  expenses: readonly PlanningExpenseFact[];
}>;

export type BudgetCalculationCategory = Readonly<{
  categoryId: string;
  categoryName: string;
  isBudgeted: boolean;
  baseBudget: string;
  priorCarry: string;
  available: string;
  spent: string;
  remaining: string;
}>;

export type BudgetCalculation = Readonly<{
  totals: Readonly<{
    baseBudget: string;
    priorCarry: string;
    available: string;
    spent: string;
    remaining: string;
  }>;
  categories: readonly BudgetCalculationCategory[];
}>;

function money(value: string, currency: string): Decimal {
  return parseMoney({ amount: value, currency });
}

function sumValues(
  values: readonly string[],
  currency: string
): Decimal {
  return values.reduce(
    (total, value) => total.plus(money(value, currency)),
    new Decimal(0)
  );
}

export function calculateBudgetPlan(
  input: BudgetPlanInput
): BudgetCalculation {
  const categoryNames = new Map(
    input.categories.map((category) => [category.id, category.name])
  );
  const categoryIds = new Set(
    input.allocations
      .filter((allocation) => allocation.month <= input.selectedMonth)
      .map((allocation) => allocation.categoryId)
  );
  for (const expense of input.expenses) {
    if (expense.month === input.selectedMonth) {
      categoryIds.add(expense.categoryId);
    }
  }

  const categories = [...categoryIds].map((categoryId) => {
    const allocations = input.allocations.filter(
      (allocation) =>
        allocation.categoryId === categoryId &&
        allocation.month <= input.selectedMonth
    );
    const firstBudgetMonth = allocations
      .map(({ month }) => month)
      .sort()[0];
    const baseBudget = sumValues(
      allocations
        .filter(({ month }) => month === input.selectedMonth)
        .map(({ amount }) => amount),
      input.currency
    );
    const priorAllocations = firstBudgetMonth
      ? allocations.filter(({ month }) => month < input.selectedMonth)
      : [];
    const priorExpenses = firstBudgetMonth
      ? input.expenses.filter(
          (expense) =>
            expense.categoryId === categoryId &&
            expense.month >= firstBudgetMonth &&
            expense.month < input.selectedMonth
        )
      : [];
    const priorCarry = sumValues(
      priorAllocations.map(({ amount }) => amount),
      input.currency
    ).minus(
      sumValues(
        priorExpenses.map(({ baseAmount }) => baseAmount),
        input.currency
      )
    );
    const spent = sumValues(
      input.expenses
        .filter(
          (expense) =>
            expense.categoryId === categoryId &&
            expense.month === input.selectedMonth
        )
        .map(({ baseAmount }) => baseAmount),
      input.currency
    );
    const available = baseBudget.plus(priorCarry);

    return {
      categoryId,
      categoryName: categoryNames.get(categoryId) ?? "ไม่พบหมวดหมู่",
      isBudgeted: baseBudget.greaterThan(0),
      baseBudget: roundMoney(baseBudget, input.currency),
      priorCarry: roundMoney(priorCarry, input.currency),
      available: roundMoney(available, input.currency),
      spent: roundMoney(spent, input.currency),
      remaining: roundMoney(available.minus(spent), input.currency)
    };
  }).sort(
    (left, right) =>
      Number(right.isBudgeted) - Number(left.isBudgeted) ||
      left.categoryName.localeCompare(right.categoryName, "th")
  );

  const total = (field: keyof Omit<
    BudgetCalculationCategory,
    "categoryId" | "categoryName" | "isBudgeted"
  >) =>
    roundMoney(
      sumValues(categories.map((category) => category[field]), input.currency),
      input.currency
    );

  return {
    categories,
    totals: {
      baseBudget: total("baseBudget"),
      priorCarry: total("priorCarry"),
      available: total("available"),
      spent: total("spent"),
      remaining: total("remaining")
    }
  };
}

export type SplitBaseAllocationInput = Readonly<{
  transactionAmount: string;
  baseAmount: string;
  currency: string;
  splits: readonly Readonly<{
    categoryId: string;
    amount: string;
  }>[];
}>;

export type CategoryExpense = Readonly<{
  categoryId: string;
  baseAmount: string;
}>;

export function allocateSplitBaseAmount(
  input: SplitBaseAllocationInput
): CategoryExpense[] {
  const transactionAmount = money(
    input.transactionAmount,
    input.currency
  );
  const splitTotal = sumValues(
    input.splits.map(({ amount }) => amount),
    input.currency
  );
  if (
    input.splits.length === 0 ||
    !splitTotal.equals(transactionAmount)
  ) {
    throw new Error("INVALID_PLANNING_SPLITS");
  }

  const allocated = allocateMoney(
    { amount: input.baseAmount, currency: input.currency },
    input.splits.map(({ amount }) => amount)
  );
  return input.splits.map((split, index) => ({
    categoryId: split.categoryId,
    baseAmount: allocated[index]!.amount
  }));
}

export type SavingsProgressInput = Readonly<{
  balance: string;
  targetAmount: string;
  currency: string;
}>;

export type SavingsProgress = Readonly<{
  currentAmount: string;
  percent: number;
  reached: boolean;
}>;

export function calculateSavingsProgress(
  input: SavingsProgressInput
): SavingsProgress {
  const balance = money(input.balance, input.currency);
  const target = money(input.targetAmount, input.currency);
  if (!target.greaterThan(0)) {
    throw new Error("INVALID_SAVINGS_TARGET");
  }
  const current = Decimal.max(balance, 0);

  return {
    currentAmount: roundMoney(current, input.currency),
    percent: Math.min(
      100,
      current.div(target).mul(100).toDecimalPlaces(2).toNumber()
    ),
    reached: current.greaterThanOrEqualTo(target)
  };
}
