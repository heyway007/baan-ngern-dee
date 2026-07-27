import type { RecurringTemplate } from "@systems-credit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecurringTemplateManager } from "./recurring-template-manager";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function template(
  id: string,
  name: string,
  status: RecurringTemplate["status"],
  version: number
): RecurringTemplate {
  return {
    id,
    workspaceId,
    name,
    kind: name === "เงินเดือน" ? "income" : "expense",
    amount: "8000.00",
    currency: "THB",
    accountId: "22222222-2222-4222-8222-222222222222",
    categoryId: "33333333-3333-4333-8333-333333333333",
    dayOfMonth: 1,
    startMonth: "2026-01",
    status,
    version
  };
}

const active = template(
  "44444444-4444-4444-8444-444444444444",
  "ค่าเช่า",
  "active",
  3
);
const paused = template(
  "55555555-5555-4555-8555-555555555555",
  "เงินเดือน",
  "paused",
  7
);
const cancelled = template(
  "66666666-6666-4666-8666-666666666666",
  "สมาชิกฟิตเนส",
  "cancelled",
  2
);

function renderManager(options: {
  templates?: RecurringTemplate[];
  pauseRecurringTemplate?: ReturnType<typeof vi.fn>;
  resumeRecurringTemplate?: ReturnType<typeof vi.fn>;
  cancelRecurringTemplate?: ReturnType<typeof vi.fn>;
  onChanged?: () => void;
} = {}) {
  const pauseRecurringTemplate =
    options.pauseRecurringTemplate ?? vi.fn().mockResolvedValue(active);
  const resumeRecurringTemplate =
    options.resumeRecurringTemplate ?? vi.fn().mockResolvedValue(paused);
  const cancelRecurringTemplate =
    options.cancelRecurringTemplate ?? vi.fn().mockResolvedValue(cancelled);
  const onChanged = options.onChanged ?? vi.fn();
  render(
    <RecurringTemplateManager
      api={{
        pauseRecurringTemplate,
        resumeRecurringTemplate,
        cancelRecurringTemplate
      }}
      templates={options.templates ?? [active, paused, cancelled]}
      onChanged={onChanged}
    />
  );
  return {
    pauseRecurringTemplate,
    resumeRecurringTemplate,
    cancelRecurringTemplate,
    onChanged
  };
}

describe("RecurringTemplateManager", () => {
  it("pauses and resumes templates with their current versions", async () => {
    const user = userEvent.setup();
    const {
      pauseRecurringTemplate,
      resumeRecurringTemplate,
      onChanged
    } = renderManager();

    await user.click(
      screen.getByRole("button", { name: "พัก ค่าเช่า" })
    );
    expect(pauseRecurringTemplate).toHaveBeenCalledWith(active.id, {
      version: 3
    });

    await user.click(
      screen.getByRole("button", { name: "ใช้งานต่อ เงินเดือน" })
    );
    expect(resumeRecurringTemplate).toHaveBeenCalledWith(paused.id, {
      version: 7
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("requires an in-page confirmation before permanent cancellation", async () => {
    const user = userEvent.setup();
    const { cancelRecurringTemplate, onChanged } = renderManager();

    await user.click(
      screen.getByRole("button", { name: "ยกเลิก ค่าเช่า" })
    );
    expect(cancelRecurringTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "ยกเลิกรายการประจำถาวร"
    );

    await user.click(
      screen.getByRole("button", {
        name: "ยกเลิกรายการถาวร"
      })
    );
    expect(cancelRecurringTemplate).toHaveBeenCalledWith(active.id, {
      version: 3
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("does not expose lifecycle actions for a cancelled template", () => {
    renderManager({ templates: [cancelled] });

    expect(
      screen.queryByRole("button", {
        name: `ยกเลิก ${cancelled.name}`
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `ใช้งานต่อ ${cancelled.name}`
      })
    ).not.toBeInTheDocument();
    expect(screen.getByText("ยกเลิกแล้ว")).toBeInTheDocument();
  });

  it("shows an error without reporting a successful change", async () => {
    const user = userEvent.setup();
    const pauseRecurringTemplate = vi
      .fn()
      .mockRejectedValue(new Error("offline"));
    const onChanged = vi.fn();
    renderManager({
      templates: [active],
      pauseRecurringTemplate,
      onChanged
    });

    await user.click(
      screen.getByRole("button", { name: "พัก ค่าเช่า" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังเปลี่ยนสถานะรายการไม่ได้"
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
