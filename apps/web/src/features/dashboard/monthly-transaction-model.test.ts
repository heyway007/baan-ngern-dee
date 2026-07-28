import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";
import { describe, expect, it } from "vitest";

import {
  buildMonthlyTransactionModel,
  shiftFinancialMonth
} from "./monthly-transaction-model";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const categoryId = "30000000-0000-4000-8000-000000000003";

const account: Account = {
  id: accountId,
  workspaceId,
  name: "à¸šà¸±à¸ญà¸Šà¸µà¸«à¸¥à¸±à¸",
  type: "bank",
  currency: "THB",
  version: 1
};

const category: Category = {
  id: categoryId,
  workspaceId,
  slug: "salary",
  name: "à¹€à¸‡à¸´à¸™à¹€à¸”à¸·à¸­à¸™",
  kind: "income",
  isDefault: true,
  version: 1
};

function transaction(
  overrides: Partial<FinanceTransaction> = {}
): FinanceTransaction {
  return {
    id: "40000000-0000-4000-8000-000000000004",
    workspaceId,
    accountId,
    type: "income",
    amount: "100.00",
    currency: "THB",
    financialDate: "2026-07-01",
    categoryId,
    tagIds: [],
    state: "posted",
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("buildMonthlyTransactionModel", () => {
  it("filters posted THB rows, sorts newest first, and calculates exact totals", () => {
    const model = buildMonthlyTransactionModel({
      month: "2026-07",
      transactions: [
        transaction({
          id: "40000000-0000-4000-8000-000000000004",
          amount: "1000.10",
          financialDate: "2026-07-01"
        }),
        transaction({
          id: "50000000-0000-4000-8000-000000000005",
          type: "expense",
          amount: "250.05",
          financialDate: "2026-07-03"
        }),
        transaction({
          id: "60000000-0000-4000-8000-000000000006",
          amount: "0.20",
          financialDate: "2026-07-05"
        }),
        transaction({
          id: "70000000-0000-4000-8000-000000000007",
          amount: "999.99",
          financialDate: "2026-06-30"
        }),
        transaction({
          id: "80000000-0000-4000-8000-000000000008",
          amount: "999.99",
          currency: "USD"
        }),
        transaction({
          id: "90000000-0000-4000-8000-000000000009",
          amount: "999.99",
          state: "void"
        })
      ],
      accounts: [account],
      categories: [category]
    });

    expect(model.rows.map((row) => row.id)).toEqual([
      "60000000-0000-4000-8000-000000000006",
      "50000000-0000-4000-8000-000000000005",
      "40000000-0000-4000-8000-000000000004"
    ]);
    expect(model.income).toBe("1000.30");
    expect(model.expense).toBe("250.05");
    expect(model.net).toBe("750.25");
  });

  it("resolves note, category, split-category, account, and fallback labels", () => {
    const missingCategoryId = "a0000000-0000-4000-8000-000000000010";
    const missingAccountId = "b0000000-0000-4000-8000-000000000011";
    const splitCategoryId = "c0000000-0000-4000-8000-000000000012";
    const splitCategory: Category = {
      ...category,
      id: splitCategoryId,
      slug: "food",
      name: "à¸­à¸²à¸«à¸²à¸£",
      kind: "expense"
    };
    const model = buildMonthlyTransactionModel({
      month: "2026-07",
      transactions: [
        transaction({
          id: "d0000000-0000-4000-8000-000000000013",
          note: "  à¸šà¸±à¸™à¸—à¸¶à¸  ",
          financialDate: "2026-07-05"
        }),
        transaction({
          id: "e0000000-0000-4000-8000-000000000014",
          note: "   ",
          financialDate: "2026-07-04"
        }),
        transaction({
          id: "f0000000-0000-4000-8000-000000000015",
          type: "expense",
          categoryId: undefined,
          splits: [{ categoryId: splitCategoryId, amount: "100.00" }],
          financialDate: "2026-07-03"
        }),
        transaction({
          id: "a1000000-0000-4000-8000-000000000016",
          categoryId: missingCategoryId,
          accountId: missingAccountId,
          financialDate: "2026-07-02"
        })
      ],
      accounts: [account],
      categories: [category, splitCategory]
    });

    expect(model.rows.map((row) => ({
      itemLabel: row.itemLabel,
      categoryLabel: row.categoryLabel,
      accountLabel: row.accountLabel
    }))).toEqual([
      {
        itemLabel: "à¸šà¸±à¸™à¸—à¸¶à¸",
        categoryLabel: "à¹€à¸‡à¸´à¸™à¹€à¸”à¸·à¸­à¸™",
        accountLabel: "à¸šà¸±à¸ญà¸Šà¸µà¸«à¸¥à¸±à¸"
      },
      {
        itemLabel: "à¹€à¸‡à¸´à¸™à¹€à¸”à¸·à¸­à¸™",
        categoryLabel: "à¹€à¸‡à¸´à¸™à¹€à¸”à¸·à¸­à¸™",
        accountLabel: "à¸šà¸±à¸ญà¸Šà¸µà¸«à¸¥à¸±à¸"
      },
      {
        itemLabel: "à¸£à¸²à¸¢à¸ˆà¹ˆà¸²à¸¢",
        categoryLabel: "à¹à¸šà¹ˆà¸‡à¸«à¸¥à¸²à¸¢à¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆ",
        accountLabel: "à¸šà¸±à¸ญà¸Šà¸µà¸«à¸¥à¸±à¸"
      },
      {
        itemLabel: "à¸£à¸²à¸¢à¸£à¸±à¸š",
        categoryLabel: "à¹„à¸¡à¹ˆà¸žà¸šà¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆ",
        accountLabel: "à¹„à¸¡à¹ˆà¸žà¸šà¸šà¸±à¸ญà¸Šà¸µ"
      }
    ]);
  });

  it("calculates cumulative monthly net chronologically before presenting newest first", () => {
    const model = buildMonthlyTransactionModel({
      month: "2026-07",
      transactions: [
        transaction({
          id: "b1000000-0000-4000-8000-000000000017",
          type: "income",
          amount: "1000.10",
          financialDate: "2026-07-01"
        }),
        transaction({
          id: "c1000000-0000-4000-8000-000000000018",
          type: "expense",
          amount: "250.05",
          financialDate: "2026-07-03"
        }),
        transaction({
          id: "d1000000-0000-4000-8000-000000000019",
          type: "income",
          amount: "0.20",
          financialDate: "2026-07-05"
        })
      ],
      accounts: [account],
      categories: [category]
    });

    expect(model.rows.map((row) => row.cumulativeNet)).toEqual([
      "750.25",
      "750.05",
      "1000.10"
    ]);
  });
});

describe("shiftFinancialMonth", () => {
  it.each([
    ["2026-01", -1, "2025-12"],
    ["2026-12", 1, "2027-01"]
  ] as const)("shifts %s by %s month to %s", (month, offset, expected) => {
    expect(shiftFinancialMonth(month, offset)).toBe(expected);
  });
});
