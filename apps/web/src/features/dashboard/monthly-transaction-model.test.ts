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
  name: "บัญชีหลัก",
  type: "bank",
  currency: "THB",
  version: 1
};

const category: Category = {
  id: categoryId,
  workspaceId,
  slug: "salary",
  name: "เงินเดือน",
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
      name: "อาหาร",
      kind: "expense"
    };
    const model = buildMonthlyTransactionModel({
      month: "2026-07",
      transactions: [
        transaction({
          id: "d0000000-0000-4000-8000-000000000013",
          note: "  บันทึก  ",
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
        }),
        transaction({
          id: "a2000000-0000-4000-8000-000000000020",
          categoryId: undefined,
          financialDate: "2026-07-01"
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
        itemLabel: "บันทึก",
        categoryLabel: "เงินเดือน",
        accountLabel: "บัญชีหลัก"
      },
      {
        itemLabel: "เงินเดือน",
        categoryLabel: "เงินเดือน",
        accountLabel: "บัญชีหลัก"
      },
      {
        itemLabel: "รายจ่าย",
        categoryLabel: "แบ่งหลายหมวดหมู่",
        accountLabel: "บัญชีหลัก"
      },
      {
        itemLabel: "รายรับ",
        categoryLabel: "ไม่พบหมวดหมู่",
        accountLabel: "ไม่พบบัญชี"
      },
      {
        itemLabel: "รายรับ",
        categoryLabel: "—",
        accountLabel: "บัญชีหลัก"
      }
    ]);
  });

  it("does not require ES2023 copy-array methods or mutate input order", () => {
    const transactions = [
      transaction({
        id: "aa000000-0000-4000-8000-000000000001",
        financialDate: "2026-07-02"
      }),
      transaction({
        id: "aa000000-0000-4000-8000-000000000002",
        financialDate: "2026-07-01"
      })
    ];
    const originalIds = transactions.map(({ id }) => id);
    const toSortedDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toSorted"
    );
    const toReversedDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toReversed"
    );

    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(Array.prototype, "toReversed", {
      configurable: true,
      value: undefined
    });

    try {
      let rowIds: string[] = [];
      expect(() => {
        rowIds = buildMonthlyTransactionModel({
          month: "2026-07",
          transactions,
          accounts: [account],
          categories: [category]
        }).rows.map(({ id }) => id);
      }).not.toThrow();
      expect(rowIds).toEqual([
        "aa000000-0000-4000-8000-000000000001",
        "aa000000-0000-4000-8000-000000000002"
      ]);
      expect(transactions.map(({ id }) => id)).toEqual(originalIds);
    } finally {
      if (toSortedDescriptor) {
        Object.defineProperty(
          Array.prototype,
          "toSorted",
          toSortedDescriptor
        );
      } else {
        delete (Array.prototype as { toSorted?: unknown }).toSorted;
      }
      if (toReversedDescriptor) {
        Object.defineProperty(
          Array.prototype,
          "toReversed",
          toReversedDescriptor
        );
      } else {
        delete (Array.prototype as { toReversed?: unknown }).toReversed;
      }
    }
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

  it("uses createdAt then id to order same-date rows and cumulative values", () => {
    const model = buildMonthlyTransactionModel({
      month: "2026-07",
      transactions: [
        transaction({
          id: "cc000000-0000-4000-8000-000000000003",
          amount: "5.00",
          financialDate: "2026-07-08",
          createdAt: "2026-07-08T09:00:00.000Z"
        }),
        transaction({
          id: "aa000000-0000-4000-8000-000000000001",
          amount: "100.00",
          financialDate: "2026-07-08",
          createdAt: "2026-07-08T08:00:00.000Z"
        }),
        transaction({
          id: "bb000000-0000-4000-8000-000000000002",
          type: "expense",
          amount: "30.00",
          financialDate: "2026-07-08",
          createdAt: "2026-07-08T09:00:00.000Z"
        })
      ],
      accounts: [account],
      categories: [category]
    });

    expect(
      model.rows.map(({ id, cumulativeNet }) => ({ id, cumulativeNet }))
    ).toEqual([
      {
        id: "cc000000-0000-4000-8000-000000000003",
        cumulativeNet: "75.00"
      },
      {
        id: "bb000000-0000-4000-8000-000000000002",
        cumulativeNet: "70.00"
      },
      {
        id: "aa000000-0000-4000-8000-000000000001",
        cumulativeNet: "100.00"
      }
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
