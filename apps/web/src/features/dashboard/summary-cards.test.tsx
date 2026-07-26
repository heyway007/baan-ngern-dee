import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LocalTransaction } from "../../lib/local-finance-api";
import { SummaryCards } from "./summary-cards";

function transaction(
  type: "income" | "expense",
  amount: string,
  financialDate = "2026-07-12"
): LocalTransaction {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    type,
    amount,
    currency: "THB",
    financialDate,
    categoryId: crypto.randomUUID(),
    tagIds: [],
    state: "posted",
    version: 1,
    createdAt: "2026-07-12T00:00:00.000Z"
  };
}

describe("SummaryCards", () => {
  it("totals only the selected month with exact decimal arithmetic", () => {
    render(
      <SummaryCards
        month="2026-07"
        transactions={[
          transaction("income", "1000.10"),
          transaction("income", "0.20"),
          transaction("expense", "250.05"),
          transaction("expense", "999.99", "2026-06-30")
        ]}
      />
    );

    expect(
      within(screen.getByTestId("monthly-income")).getByText("฿1,000.30")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("monthly-expense")).getByText("฿250.05")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("monthly-net")).getByText("฿750.25")
    ).toBeInTheDocument();
  });
});
