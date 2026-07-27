import type { RecurringOccurrence } from "@systems-credit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecurringOccurrenceList } from "./recurring-occurrence-list";

const occurrence: RecurringOccurrence = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  templateId: "33333333-3333-4333-8333-333333333333",
  name: "ค่าเช่า",
  kind: "expense",
  period: "2026-07",
  scheduledDate: "2026-07-01",
  amount: "8000.00",
  currency: "THB",
  accountId: "44444444-4444-4444-8444-444444444444",
  categoryId: "55555555-5555-4555-8555-555555555555",
  status: "pending",
  version: 2
};

function renderList(options: {
  updateRecurringOccurrence?: ReturnType<typeof vi.fn>;
  skipRecurringOccurrence?: ReturnType<typeof vi.fn>;
  postRecurringOccurrence?: ReturnType<typeof vi.fn>;
  onChanged?: () => void | Promise<void>;
  readOnly?: boolean;
} = {}) {
  const updateRecurringOccurrence =
    options.updateRecurringOccurrence ??
    vi.fn().mockResolvedValue(occurrence);
  const skipRecurringOccurrence =
    options.skipRecurringOccurrence ??
    vi.fn().mockResolvedValue({
      ...occurrence,
      status: "skipped",
      version: 3
    });
  const postRecurringOccurrence =
    options.postRecurringOccurrence ??
    vi.fn().mockResolvedValue({
      occurrence: {
        ...occurrence,
        status: "posted",
        transactionId: crypto.randomUUID(),
        version: 3
      },
      transaction: {
        transactionId: crypto.randomUUID(),
        version: 1,
        state: "posted",
        accountBalances: []
      }
    });
  const onChanged = options.onChanged ?? vi.fn();
  render(
    <RecurringOccurrenceList
      api={{
        updateRecurringOccurrence,
        skipRecurringOccurrence,
        postRecurringOccurrence
      }}
      occurrences={[occurrence]}
      readOnly={options.readOnly}
      onChanged={onChanged}
    />
  );
  return {
    updateRecurringOccurrence,
    skipRecurringOccurrence,
    postRecurringOccurrence,
    onChanged
  };
}

describe("RecurringOccurrenceList", () => {
  it("updates the exact amount and date for this month", async () => {
    const user = userEvent.setup();
    const { updateRecurringOccurrence, onChanged } = renderList();

    await user.clear(screen.getByLabelText("ยอดของ ค่าเช่า"));
    await user.type(screen.getByLabelText("ยอดของ ค่าเช่า"), "8250.75");
    await user.clear(screen.getByLabelText("วันที่ของ ค่าเช่า"));
    await user.type(
      screen.getByLabelText("วันที่ของ ค่าเช่า"),
      "2026-07-03"
    );
    await user.click(
      screen.getByRole("button", {
        name: "บันทึกการแก้ไข ค่าเช่า"
      })
    );

    expect(updateRecurringOccurrence).toHaveBeenCalledWith(occurrence.id, {
      amount: "8250.75",
      scheduledDate: "2026-07-03",
      version: occurrence.version
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("reuses one mutation id when posting is retried", async () => {
    const user = userEvent.setup();
    const postRecurringOccurrence = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        occurrence: {
          ...occurrence,
          status: "posted",
          transactionId: crypto.randomUUID(),
          version: 3
        },
        transaction: {
          transactionId: crypto.randomUUID(),
          version: 1,
          state: "posted",
          accountBalances: []
        }
      });
    const onChanged = vi.fn();
    renderList({ postRecurringOccurrence, onChanged });

    await user.click(
      screen.getByRole("button", { name: "จ่ายแล้ว ค่าเช่า" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังบันทึกรายการไม่ได้"
    );
    await user.click(
      screen.getByRole("button", { name: "จ่ายแล้ว ค่าเช่า" })
    );

    expect(postRecurringOccurrence).toHaveBeenCalledTimes(2);
    expect(postRecurringOccurrence.mock.calls[0]![1]).toEqual(
      postRecurringOccurrence.mock.calls[1]![1]
    );
    expect(postRecurringOccurrence.mock.calls[0]![1]).toMatchObject({
      version: occurrence.version,
      clientMutationId: expect.any(String)
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("disables the posting action while the request is pending", async () => {
    const user = userEvent.setup();
    let resolvePost!: (value: unknown) => void;
    const postRecurringOccurrence = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );
    renderList({ postRecurringOccurrence });
    const button = screen.getByRole("button", {
      name: "จ่ายแล้ว ค่าเช่า"
    });

    await user.click(button);
    expect(button).toBeDisabled();
    resolvePost({
      occurrence: { ...occurrence, status: "posted" },
      transaction: {}
    });
  });

  it("skips only this occurrence with its current version", async () => {
    const user = userEvent.setup();
    const { skipRecurringOccurrence, onChanged } = renderList();

    await user.click(
      screen.getByRole("button", {
        name: "ข้ามเดือนนี้ ค่าเช่า"
      })
    );
    expect(skipRecurringOccurrence).toHaveBeenCalledWith(occurrence.id, {
      version: occurrence.version
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("renders past occurrences without edit, post, or skip controls", () => {
    renderList({ readOnly: true });

    expect(screen.getByText("ค่าเช่า")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("ยอดของ ค่าเช่า")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "จ่ายแล้ว ค่าเช่า" })
    ).not.toBeInTheDocument();
  });
});
