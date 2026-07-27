import Decimal from "decimal.js";

import type {
  InstallmentInterestMethod,
  InstallmentScheduleRow,
  ManualInstallmentRowInput
} from "@systems-credit/contracts";

export type { InstallmentScheduleRow } from "@systems-credit/contracts";

import {
  parseMoney,
  roundMoney
} from "./money";
import type { CurrencyCode } from "./currency";

export type InstallmentScheduleInput = Readonly<{
  principal: string;
  financedFees: string;
  currency: CurrencyCode;
  interestMethod: Exclude<InstallmentInterestMethod, "manual">;
  annualRate: string;
  periods: number;
  firstDueDate: string;
}>;

export type ManualScheduleInput = Readonly<{
  principal: string;
  currency: CurrencyCode;
  rows: ManualInstallmentRowInput[];
}>;

export type InstallmentPaymentAllocationInput = Readonly<{
  currency: CurrencyCode;
  amount: string;
  scheduledPrincipal: string;
  scheduledInterest: string;
  scheduledFees: string;
  scheduledPenalty: string;
  paidPrincipal: string;
  paidInterest: string;
  paidFees: string;
  paidPenalty: string;
}>;

type InstallmentPaymentComponents = Readonly<{
  penalty: string;
  fees: string;
  interest: string;
  principal: string;
  total: string;
}>;

export type InstallmentPaymentAllocation = Readonly<{
  allocation: InstallmentPaymentComponents;
  remaining: InstallmentPaymentComponents;
  reportableExpense: string;
  status: "partially_paid" | "paid";
}>;

function money(value: string, currency: CurrencyCode) {
  return parseMoney({ amount: value, currency });
}

function assertFinancialDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("INSTALLMENT_DATE_INVALID");
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("INSTALLMENT_DATE_INVALID");
  }
  return { year, month, day };
}

function dueDateAt(firstDueDate: string, offset: number) {
  const first = assertFinancialDate(firstDueDate);
  const monthIndex = first.month - 1 + offset;
  const year = first.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(first.day, lastDay);
  return [
    year.toString().padStart(4, "0"),
    (month + 1).toString().padStart(2, "0"),
    day.toString().padStart(2, "0")
  ].join("-");
}

function allocateEvenly(
  total: Decimal,
  periods: number,
  currency: CurrencyCode
) {
  const rows: string[] = [];
  let allocated = new Decimal(0);
  for (let index = 0; index < periods; index += 1) {
    const isFinal = index === periods - 1;
    const part = isFinal
      ? total.minus(allocated)
      : new Decimal(roundMoney(total.div(periods), currency));
    const rounded = roundMoney(part, currency);
    rows.push(rounded);
    allocated = allocated.plus(rounded);
  }
  return rows;
}

function totalOf(
  principal: string,
  interest: string,
  fees: string,
  currency: CurrencyCode
) {
  return roundMoney(
    money(principal, currency)
      .plus(money(interest, currency))
      .plus(money(fees, currency)),
    currency
  );
}

function validateCalculatedInput(input: InstallmentScheduleInput) {
  const principal = money(input.principal, input.currency);
  const fees = money(input.financedFees, input.currency);
  let annualRate: Decimal;
  try {
    annualRate = new Decimal(input.annualRate);
  } catch {
    throw new Error("INSTALLMENT_RATE_INVALID");
  }

  if (!principal.greaterThan(0)) {
    throw new Error("INSTALLMENT_PRINCIPAL_INVALID");
  }
  if (fees.isNegative()) {
    throw new Error("INSTALLMENT_FEES_INVALID");
  }
  if (!annualRate.isFinite() || annualRate.isNegative()) {
    throw new Error("INSTALLMENT_RATE_INVALID");
  }
  if (!Number.isInteger(input.periods) || input.periods < 1) {
    throw new Error("INSTALLMENT_PERIODS_INVALID");
  }
  assertFinancialDate(input.firstDueDate);
  return { principal, fees, annualRate };
}

function generateEvenSchedule(
  input: InstallmentScheduleInput,
  totalInterest: Decimal
): InstallmentScheduleRow[] {
  const principal = money(input.principal, input.currency);
  const fees = money(input.financedFees, input.currency);
  const principalParts = allocateEvenly(
    principal,
    input.periods,
    input.currency
  );
  const interestParts = allocateEvenly(
    totalInterest,
    input.periods,
    input.currency
  );
  const feeParts = allocateEvenly(
    fees,
    input.periods,
    input.currency
  );
  let opening = principal;

  return principalParts.map((principalPart, index) => {
    const closing = opening.minus(
      money(principalPart, input.currency)
    );
    const row: InstallmentScheduleRow = {
      sequence: index + 1,
      dueDate: dueDateAt(input.firstDueDate, index),
      openingPrincipal: roundMoney(opening, input.currency),
      principal: principalPart,
      interest: interestParts[index]!,
      fees: feeParts[index]!,
      total: totalOf(
        principalPart,
        interestParts[index]!,
        feeParts[index]!,
        input.currency
      ),
      closingPrincipal: roundMoney(closing, input.currency)
    };
    opening = closing;
    return row;
  });
}

function generateReducingSchedule(
  input: InstallmentScheduleInput,
  principal: Decimal,
  fees: Decimal,
  annualRate: Decimal
): InstallmentScheduleRow[] {
  const monthlyRate = annualRate.div(100).div(12);
  if (monthlyRate.isZero()) {
    return generateEvenSchedule(input, new Decimal(0));
  }

  const growth = monthlyRate.plus(1).pow(input.periods);
  const payment = principal
    .times(monthlyRate)
    .times(growth)
    .div(growth.minus(1));
  const feeParts = allocateEvenly(
    fees,
    input.periods,
    input.currency
  );
  const rows: InstallmentScheduleRow[] = [];
  let opening = principal;

  for (let index = 0; index < input.periods; index += 1) {
    const isFinal = index === input.periods - 1;
    const interest = roundMoney(
      opening.times(monthlyRate),
      input.currency
    );
    let principalPart = isFinal
      ? roundMoney(opening, input.currency)
      : roundMoney(
          payment.minus(money(interest, input.currency)),
          input.currency
        );
    if (money(principalPart, input.currency).greaterThan(opening)) {
      principalPart = roundMoney(opening, input.currency);
    }
    const closing = opening.minus(
      money(principalPart, input.currency)
    );
    const feesPart = feeParts[index]!;
    rows.push({
      sequence: index + 1,
      dueDate: dueDateAt(input.firstDueDate, index),
      openingPrincipal: roundMoney(opening, input.currency),
      principal: principalPart,
      interest,
      fees: feesPart,
      total: totalOf(
        principalPart,
        interest,
        feesPart,
        input.currency
      ),
      closingPrincipal: roundMoney(closing, input.currency)
    });
    opening = closing;
  }

  return rows;
}

export function generateInstallmentSchedule(
  input: InstallmentScheduleInput
): InstallmentScheduleRow[] {
  const { principal, fees, annualRate } =
    validateCalculatedInput(input);

  if (input.interestMethod === "zero") {
    return generateEvenSchedule(input, new Decimal(0));
  }
  if (input.interestMethod === "flat") {
    const totalInterest = principal
      .times(annualRate)
      .div(100)
      .times(input.periods)
      .div(12);
    return generateEvenSchedule(input, totalInterest);
  }
  return generateReducingSchedule(
    input,
    principal,
    fees,
    annualRate
  );
}

export function validateManualSchedule(
  input: ManualScheduleInput
): void {
  const principal = money(input.principal, input.currency);
  if (!principal.greaterThan(0) || input.rows.length === 0) {
    throw new Error("INSTALLMENT_MANUAL_SCHEDULE_INVALID");
  }

  let priorDate = "";
  let allocatedPrincipal = new Decimal(0);
  for (const row of input.rows) {
    assertFinancialDate(row.dueDate);
    if (row.dueDate <= priorDate) {
      throw new Error("INSTALLMENT_DATES_INVALID");
    }
    const rowPrincipal = money(row.principal, input.currency);
    const interest = money(row.interest, input.currency);
    const fees = money(row.fees, input.currency);
    if (
      !rowPrincipal.greaterThan(0) ||
      interest.isNegative() ||
      fees.isNegative()
    ) {
      throw new Error("INSTALLMENT_COMPONENT_INVALID");
    }
    allocatedPrincipal = allocatedPrincipal.plus(rowPrincipal);
    priorDate = row.dueDate;
  }

  if (
    roundMoney(allocatedPrincipal, input.currency) !==
    roundMoney(principal, input.currency)
  ) {
    throw new Error("INSTALLMENT_PRINCIPAL_MISMATCH");
  }
}

export function generateManualInstallmentSchedule(
  input: ManualScheduleInput
): InstallmentScheduleRow[] {
  validateManualSchedule(input);

  let opening = money(input.principal, input.currency);
  return input.rows.map((row, index) => {
    const principal = roundMoney(
      money(row.principal, input.currency),
      input.currency
    );
    const interest = roundMoney(
      money(row.interest, input.currency),
      input.currency
    );
    const fees = roundMoney(
      money(row.fees, input.currency),
      input.currency
    );
    const closing = opening.minus(money(principal, input.currency));
    const scheduleRow: InstallmentScheduleRow = {
      sequence: index + 1,
      dueDate: row.dueDate,
      openingPrincipal: roundMoney(opening, input.currency),
      principal,
      interest,
      fees,
      total: totalOf(principal, interest, fees, input.currency),
      closingPrincipal: roundMoney(closing, input.currency)
    };
    opening = closing;
    return scheduleRow;
  });
}

export function allocateInstallmentPayment(
  input: InstallmentPaymentAllocationInput
): InstallmentPaymentAllocation {
  const amount = money(input.amount, input.currency);
  if (!amount.greaterThan(0)) {
    throw new Error("INSTALLMENT_PAYMENT_AMOUNT_INVALID");
  }

  const components = [
    ["penalty", input.scheduledPenalty, input.paidPenalty],
    ["fees", input.scheduledFees, input.paidFees],
    ["interest", input.scheduledInterest, input.paidInterest],
    ["principal", input.scheduledPrincipal, input.paidPrincipal]
  ] as const;
  const remainingByComponent = components.map(
    ([name, scheduledValue, paidValue]) => {
      const scheduled = money(scheduledValue, input.currency);
      const paid = money(paidValue, input.currency);
      if (
        scheduled.isNegative() ||
        paid.isNegative() ||
        paid.greaterThan(scheduled)
      ) {
        throw new Error("INSTALLMENT_PAYMENT_STATE_INVALID");
      }
      return {
        name,
        value: scheduled.minus(paid)
      };
    }
  );
  const totalRemaining = remainingByComponent.reduce(
    (total, component) => total.plus(component.value),
    new Decimal(0)
  );
  if (amount.greaterThan(totalRemaining)) {
    throw new Error("INSTALLMENT_PAYMENT_EXCEEDS_REMAINING");
  }

  let unallocated = amount;
  const allocated = new Map<string, Decimal>();
  for (const component of remainingByComponent) {
    const value = Decimal.min(component.value, unallocated);
    allocated.set(component.name, value);
    unallocated = unallocated.minus(value);
  }

  const componentValue = (name: string) =>
    allocated.get(name) ?? new Decimal(0);
  const penalty = componentValue("penalty");
  const fees = componentValue("fees");
  const interest = componentValue("interest");
  const principal = componentValue("principal");
  const remainingValue = (name: string) =>
    remainingByComponent.find((component) => component.name === name)!
      .value.minus(componentValue(name));
  const remainingTotal = totalRemaining.minus(amount);

  return {
    allocation: {
      penalty: roundMoney(penalty, input.currency),
      fees: roundMoney(fees, input.currency),
      interest: roundMoney(interest, input.currency),
      principal: roundMoney(principal, input.currency),
      total: roundMoney(amount, input.currency)
    },
    remaining: {
      penalty: roundMoney(remainingValue("penalty"), input.currency),
      fees: roundMoney(remainingValue("fees"), input.currency),
      interest: roundMoney(remainingValue("interest"), input.currency),
      principal: roundMoney(remainingValue("principal"), input.currency),
      total: roundMoney(remainingTotal, input.currency)
    },
    reportableExpense: roundMoney(
      penalty.plus(fees).plus(interest),
      input.currency
    ),
    status: remainingTotal.isZero() ? "paid" : "partially_paid"
  };
}
