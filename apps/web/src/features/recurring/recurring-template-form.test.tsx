import type {
  Account,
  Category,
  RecurringOccurrence,
  RecurringTemplate
} from "@systems-credit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecurringTemplateForm } from "./recurring-template-form";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const thbAccountId = "22222222-2222-4222-8222-222222222222";
const usdAccountId = "33333333-3333-4333-8333-333333333333";
const salaryCategoryId = "44444444-4444-4444-8444-444444444444";
const housingCategoryId = "55555555-5555-4555-8555-555555555555";
const templateId = "66666666-6666-4666-8666-666666666666";

const accounts: Account[] = [
  {
    id: thbAccountId,
    workspaceId,
    name: "บัญชีหลัก",
    type: "bank",
    currency: "THB",
    version: 1
  },
  {
    id: usdAccountId,
    workspaceId,
    name: "บัญชีดอลลาร์",
    type: "bank",
    currency: "USD",
    version: 1
  }
];

const categories: Category[] = [
  {
    id: salaryCategoryId,
    workspaceId,
    slug: "salary",
    name: "เงินเดือน",
    kind: "income",
    isDefault: true,
    version: 1
  },
  {
    id: housingCategoryId,
    workspaceId,
    slug: "housing",
    name: "ที่อยู่อาศัย",
    kind: "expense",
    isDefault: true,
    version: 1
  }
];

function renderForm(
  options: Readonly<{
    createRecurringTemplate?: ReturnType<typeof vi.fn>;
    updateRecurringTemplate?: ReturnType<typeof vi.fn>;
    template?: RecurringTemplate;
    currentOccurrence?: RecurringOccurrence;
    onChanged?: () => void;
  }> = {}
) {
  const createRecurringTemplate =
    options.createRecurringTemplate ??
    vi.fn().mockResolvedValue({ id: templateId });
  const updateRecurringTemplate =
    options.updateRecurringTemplate ??
    vi.fn().mockResolvedValue({ id: templateId });
  render(
    <RecurringTemplateForm
      api={{ createRecurringTemplate, updateRecurringTemplate }}
      workspaceId={workspaceId}
      currentPeriod="2026-07"
      accounts={accounts}
      categories={categories}
      template={options.template}
      currentOccurrence={options.currentOccurrence}
      onChanged={options.onChanged ?? vi.fn()}
    />
  );
  return { createRecurringTemplate, updateRecurringTemplate };
}

describe("RecurringTemplateForm", () => {
  it("creates an income template with the original decimal string", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const { createRecurringTemplate } = renderForm({ onChanged });

    await user.selectOptions(
      screen.getByLabelText("ประเภทรายการประจำ"),
      "income"
    );
    await user.type(screen.getByLabelText("ชื่อรายการประจำ"), "เงินเดือน");
    await user.clear(screen.getByLabelText("จำนวนเงิน"));
    await user.type(screen.getByLabelText("จำนวนเงิน"), "35000.50");
    await user.clear(screen.getByLabelText("วันที่ของเดือน"));
    await user.type(screen.getByLabelText("วันที่ของเดือน"), "25");
    await user.click(
      screen.getByRole("button", { name: "เพิ่มรายการประจำ" })
    );

    expect(createRecurringTemplate).toHaveBeenCalledWith({
      workspaceId,
      name: "เงินเดือน",
      kind: "income",
      amount: "35000.50",
      currency: "THB",
      accountId: thbAccountId,
      categoryId: salaryCategoryId,
      dayOfMonth: 25,
      startMonth: "2026-07"
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("derives currency from the account and filters categories by kind", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(
      screen.getByRole("option", { name: "ที่อยู่อาศัย" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "เงินเดือน" })
    ).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("ประเภทรายการประจำ"),
      "income"
    );
    expect(
      screen.getByRole("option", { name: "เงินเดือน" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "ที่อยู่อาศัย" })
    ).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("บัญชี"),
      usdAccountId
    );
    expect(screen.getByText("สกุลเงิน USD")).toBeInTheDocument();
  });

  it.each(["0", "1,000"])(
    "blocks invalid money %s before calling the API",
    async (amount) => {
      const user = userEvent.setup();
      const { createRecurringTemplate } = renderForm();

      await user.type(screen.getByLabelText("ชื่อรายการประจำ"), "ค่าเช่า");
      await user.clear(screen.getByLabelText("จำนวนเงิน"));
      await user.type(screen.getByLabelText("จำนวนเงิน"), amount);
      await user.click(
        screen.getByRole("button", { name: "เพิ่มรายการประจำ" })
      );

      expect(createRecurringTemplate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "จำนวนเงินต้องมากกว่า 0"
      );
    }
  );

  it("confirms before overwriting a pending current occurrence", async () => {
    const user = userEvent.setup();
    const template: RecurringTemplate = {
      id: templateId,
      workspaceId,
      name: "ค่าเช่า",
      kind: "expense",
      amount: "8000.00",
      currency: "THB",
      accountId: thbAccountId,
      categoryId: housingCategoryId,
      dayOfMonth: 1,
      startMonth: "2026-01",
      status: "active",
      version: 4
    };
    const currentOccurrence: RecurringOccurrence = {
      id: "77777777-7777-4777-8777-777777777777",
      workspaceId,
      templateId,
      name: "ค่าเช่า",
      kind: "expense",
      period: "2026-07",
      scheduledDate: "2026-07-01",
      amount: "8000.00",
      currency: "THB",
      accountId: thbAccountId,
      categoryId: housingCategoryId,
      status: "pending",
      version: 2
    };
    const updateRecurringTemplate = vi.fn().mockResolvedValue(template);
    const onChanged = vi.fn();
    renderForm({
      template,
      currentOccurrence,
      updateRecurringTemplate,
      onChanged
    });

    await user.clear(screen.getByLabelText("จำนวนเงิน"));
    await user.type(screen.getByLabelText("จำนวนเงิน"), "8250.75");
    await user.click(
      screen.getByRole("button", { name: "บันทึกการแก้ไข" })
    );

    expect(updateRecurringTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "รายการรอของเดือนนี้จะถูกแทนที่"
    );

    await user.click(
      screen.getByRole("button", { name: "ยืนยันและบันทึก" })
    );
    expect(updateRecurringTemplate).toHaveBeenCalledWith(templateId, {
      name: "ค่าเช่า",
      kind: "expense",
      amount: "8250.75",
      currency: "THB",
      accountId: thbAccountId,
      categoryId: housingCategoryId,
      dayOfMonth: 1,
      startMonth: "2026-01",
      version: 4
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("renders a Thai API error and keeps the form available", async () => {
    const user = userEvent.setup();
    const createRecurringTemplate = vi
      .fn()
      .mockRejectedValue(new Error("offline"));
    renderForm({ createRecurringTemplate });

    await user.type(screen.getByLabelText("ชื่อรายการประจำ"), "ค่าเช่า");
    await user.clear(screen.getByLabelText("จำนวนเงิน"));
    await user.type(screen.getByLabelText("จำนวนเงิน"), "8000");
    await user.click(
      screen.getByRole("button", { name: "เพิ่มรายการประจำ" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังบันทึกรายการประจำไม่ได้"
    );
    expect(
      screen.getByRole("button", { name: "เพิ่มรายการประจำ" })
    ).toBeEnabled();
  });
});
