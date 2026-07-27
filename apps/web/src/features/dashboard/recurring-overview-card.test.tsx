import type { RecurringOccurrence } from "@systems-credit/contracts";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RecurringOverviewCard } from "./recurring-overview-card";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function occurrence(
  kind: "income" | "expense",
  amount: string,
  currency: string,
  status: "pending" | "posted" = "pending"
): RecurringOccurrence {
  const transactionId =
    status === "posted" ? crypto.randomUUID() : undefined;
  return {
    id: crypto.randomUUID(),
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
    status,
    ...(transactionId ? { transactionId } : {}),
    version: 1
  };
}

describe("RecurringOverviewCard", () => {
  it("shows pending expenses and remaining money per currency", () => {
    render(
      <MemoryRouter>
        <RecurringOverviewCard
          occurrences={[
            occurrence("income", "35000.50", "THB"),
            occurrence("expense", "8000.25", "THB"),
            occurrence("income", "1200.00", "USD"),
            occurrence("expense", "200.50", "USD")
          ]}
        />
      </MemoryRouter>
    );

    const thb = within(screen.getByLabelText("ประมาณการ THB"));
    expect(thb.getByText("฿8,000.25")).toBeInTheDocument();
    expect(thb.getByText("฿27,000.25")).toBeInTheDocument();

    const usd = within(screen.getByLabelText("ประมาณการ USD"));
    expect(usd.getByText("USD 200.50")).toBeInTheDocument();
    expect(usd.getByText("USD 999.50")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "จัดการรายการประจำ" })
    ).toHaveAttribute("href", "/recurring");
  });
});
