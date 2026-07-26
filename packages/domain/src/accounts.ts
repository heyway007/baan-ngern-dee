export type AccountType =
  | "cash"
  | "bank"
  | "ewallet"
  | "credit_card"
  | "loan"
  | "asset";

export type AccountKind = Readonly<{
  normalBalance: "debit" | "credit";
  liquid: boolean;
  liability: boolean;
}>;

const accountKinds: Readonly<Record<AccountType, AccountKind>> = {
  cash: {
    normalBalance: "debit",
    liquid: true,
    liability: false
  },
  bank: {
    normalBalance: "debit",
    liquid: true,
    liability: false
  },
  ewallet: {
    normalBalance: "debit",
    liquid: true,
    liability: false
  },
  credit_card: {
    normalBalance: "credit",
    liquid: false,
    liability: true
  },
  loan: {
    normalBalance: "credit",
    liquid: false,
    liability: true
  },
  asset: {
    normalBalance: "debit",
    liquid: false,
    liability: false
  }
};

export function normalizeAccountKind(type: AccountType): AccountKind {
  return accountKinds[type];
}
