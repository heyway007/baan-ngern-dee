import type { RecurringOccurrence } from "@systems-credit/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecurringSummary } from "./recurring-summary";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function occurrence(
  id: string,
  kind: "income" | "expense",
  amount: string,
  currency: string
): RecurringOccurrence {
  return {
    id,
    workspaceId,
    templateId: crypto.randomUUID(),
    name: kind === "income" ? "เงินเดือน" : "ค่าเช่า",
    kind,
    period: "2026-07",
    scheduledDate: "2026-07-01",
    amount,
    currency,
    accountId: crypto.randomUUID(),
    categoryId: crypto.randomUUID(),
    status: "pending",
    version: 1
  };
}

describe("RecurringSummary", () => {
  it("renders projected totals separately for every currency", () => {
    render(
      <RecurringSummary
        occurrences={[
          occurrence(crypto.randomUUID(), "income", "35000.50", "THB"),
          occurrence(crypto.randomUUID(), "expense", "8000.25", "THB"),
          occurrence(crypto.randomUUID(), "income", "1200.00", "USD"),
          occurrence(crypto.randomUUID(), "expense", "200.50", "USD")
        ]}
      />
    );

    const thb = within(screen.getByLabelText("สรุป THB"));
    expect(thb.getByText("฿35,000.50")).toBeInTheDocument();
    expect(thb.getByText("฿8,000.25")).toBeInTheDocument();
    expect(thb.getByText("฿27,000.25")).toBeInTheDocument();

    const usd = within(screen.getByLabelText("สรุป USD"));
    expect(usd.getByText("USD 1,200.00")).toBeInTheDocument();
    expect(usd.getByText("USD 200.50")).toBeInTheDocument();
    expect(usd.getByText("USD 999.50")).toBeInTheDocument();
  });

  it("shows an empty projection when the month has no items", () => {
    render(<RecurringSummary occurrences={[]} />);
    expect(screen.getByText("เดือนนี้ยังไม่มีรายการประจำ")).toBeInTheDocument();
  });
});
