import Decimal from "decimal.js";

import { minorDigits, type CurrencyCode } from "./currency";

export type Money = Readonly<{
  amount: string;
  currency: CurrencyCode;
}>;

function parseExactDecimal(value: Decimal.Value): Decimal {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) {
      throw new Error("INVALID_MONEY_AMOUNT");
    }
    return decimal;
  } catch {
    throw new Error("INVALID_MONEY_AMOUNT");
  }
}

export function parseMoney(input: Money): Decimal {
  minorDigits(input.currency);
  return parseExactDecimal(input.amount);
}

export function roundMoney(
  value: Decimal.Value,
  currency: CurrencyCode
): string {
  const digits = minorDigits(currency);
  return parseExactDecimal(value)
    .toDecimalPlaces(digits, Decimal.ROUND_HALF_UP)
    .toFixed(digits);
}

export function sumMoney(items: readonly Money[]): Money {
  if (items.length === 0) {
    throw new Error("MONEY_ITEMS_REQUIRED");
  }

  const currency = items[0].currency;
  const total = items.reduce((sum, item) => {
    if (item.currency !== currency) {
      throw new Error("CURRENCY_MISMATCH");
    }
    return sum.plus(parseMoney(item));
  }, new Decimal(0));

  return {
    amount: roundMoney(total, currency),
    currency
  };
}

export function allocateMoney(
  total: Money,
  weights: readonly string[]
): Money[] {
  if (weights.length === 0) {
    throw new Error("ALLOCATION_WEIGHTS_REQUIRED");
  }

  let parsedWeights: Decimal[];
  try {
    parsedWeights = weights.map((weight) => parseExactDecimal(weight));
  } catch {
    throw new Error("ALLOCATION_WEIGHT_INVALID");
  }

  if (parsedWeights.some((weight) => !weight.greaterThan(0))) {
    throw new Error("ALLOCATION_WEIGHT_INVALID");
  }

  const totalValue = parseMoney(total);
  const weightTotal = parsedWeights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0)
  );
  const allocated: Money[] = [];
  let allocatedValue = new Decimal(0);

  parsedWeights.forEach((weight, index) => {
    const isFinal = index === parsedWeights.length - 1;
    const amount = isFinal
      ? totalValue.minus(allocatedValue)
      : new Decimal(roundMoney(totalValue.times(weight).div(weightTotal), total.currency));

    allocated.push({
      amount: roundMoney(amount, total.currency),
      currency: total.currency
    });
    allocatedValue = allocatedValue.plus(amount);
  });

  return allocated;
}
