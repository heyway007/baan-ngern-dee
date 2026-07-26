import {
  parseMoney,
  roundMoney,
  type Money
} from "./money";

export type TransferEffectInput = Readonly<{
  source: Money;
  destination: Money;
  fee: Money;
}>;

export type TransferReportEffect = Readonly<{
  income: string;
  expense: string;
  cashFlow: string;
}>;

export function transferReportEffect(
  input: TransferEffectInput
): TransferReportEffect {
  if (input.fee.currency !== input.source.currency) {
    throw new Error("TRANSFER_FEE_CURRENCY_MISMATCH");
  }

  const fee = roundMoney(input.fee.amount, input.fee.currency);
  return {
    income: roundMoney("0", input.source.currency),
    expense: fee,
    cashFlow: roundMoney(
      parseMoney(input.fee).negated(),
      input.fee.currency
    )
  };
}
