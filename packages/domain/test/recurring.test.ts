import type { RecurringOccurrence } from "@systems-credit/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveRecurringDate,
  summarizeRecurringOccurrences
} from "../src";

const baseOccurrence: RecurringOccurrence = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  templateId: "30000000-0000-4000-8000-000000000003",
  name: "รายการประจำ",
  kind: "income",
  period: "2026-07",
  scheduledDate: "2026-07-25",
  amount: "1.00",
  currency: "THB",
  accountId: "40000000-0000-4000-8000-000000000004",
  categoryId: "50000000-0000-4000-8000-000000000005",
  status: "pending",
  version: 1
};

function occurrence(
  values: Partial<RecurringOccurrence>
): RecurringOccurrence {
  return { ...baseOccurrence, ...values };
}

describe("recurring date resolution", () => {
  it("clamps day 31 to leap and non-leap February", () => {
    expect(resolveRecurringDate("2028-02", 31)).toBe("2028-02-29");
    expect(resolveRecurringDate("2027-02", 31)).toBe("2027-02-28");
  });

  it("keeps valid days and clamps other short months", () => {
    expect(resolveRecurringDate("2026-07", 25)).toBe("2026-07-25");
    expect(resolveRecurringDate("2026-04", 31)).toBe("2026-04-30");
  });

  it("rejects malformed periods and out-of-range days", () => {
    expect(() => resolveRecurringDate("2026-7", 1)).toThrow(
      "INVALID_RECURRING_PERIOD"
    );
    expect(() => resolveRecurringDate("2026-07", 0)).toThrow(
      "INVALID_RECURRING_DAY"
    );
  });
});

describe("recurring summaries", () => {
  it("keeps currencies separate, calculates exact totals, and excludes skipped items", () => {
    const summaries = summarizeRecurringOccurrences([
      occurrence({
        name: "เงินเดือน",
        amount: "35000.50"
      }),
      occurrence({
        id: "60000000-0000-4000-8000-000000000006",
        name: "ค่าเช่า",
        kind: "expense",
        amount: "8000.25",
        status: "posted",
        transactionId: "70000000-0000-4000-8000-000000000007",
        version: 2
      }),
      occurrence({
        id: "80000000-0000-4000-8000-000000000008",
        name: "ข้าม",
        kind: "expense",
        amount: "900.00",
        status: "skipped",
        version: 2
      }),
      occurrence({
        id: "90000000-0000-4000-8000-000000000009",
        name: "USD income",
        amount: "100.10",
        currency: "USD"
      }),
      occurrence({
        id: "a0000000-0000-4000-8000-00000000000a",
        name: "USD fee",
        kind: "expense",
        amount: "0.20",
        currency: "USD"
      })
    ]);

    expect(summaries).toEqual([
      {
        currency: "THB",
        income: "35000.50",
        expense: "8000.25",
        remaining: "27000.25",
        pendingIncome: "35000.50",
        pendingExpense: "0.00",
        postedIncome: "0.00",
        postedExpense: "8000.25",
        pendingCount: 1
      },
      {
        currency: "USD",
        income: "100.10",
        expense: "0.20",
        remaining: "99.90",
        pendingIncome: "100.10",
        pendingExpense: "0.20",
        postedIncome: "0.00",
        postedExpense: "0.00",
        pendingCount: 2
      }
    ]);
  });
});
