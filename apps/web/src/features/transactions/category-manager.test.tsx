import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CategoryManager } from "./category-manager";

describe("CategoryManager", () => {
  it("creates a custom category in the selected kind", async () => {
    const user = userEvent.setup();
    const createCategory = vi.fn().mockResolvedValue({
      id: crypto.randomUUID(),
      workspaceId: "52d3fbcb-c083-42dd-87d0-62a66e337fd0",
      slug: "custom",
      name: "สัตว์เลี้ยง",
      kind: "expense",
      isDefault: false,
      version: 1
    });
    const onChanged = vi.fn();
    render(
      <CategoryManager
        api={{ createCategory }}
        workspaceId="52d3fbcb-c083-42dd-87d0-62a66e337fd0"
        categories={[]}
        onChanged={onChanged}
      />
    );

    await user.type(screen.getByLabelText("ชื่อหมวดหมู่ใหม่"), "สัตว์เลี้ยง");
    await user.click(screen.getByRole("button", { name: "เพิ่มหมวดหมู่" }));

    expect(createCategory).toHaveBeenCalledWith({
      workspaceId: "52d3fbcb-c083-42dd-87d0-62a66e337fd0",
      name: "สัตว์เลี้ยง",
      kind: "expense"
    });
    expect(onChanged).toHaveBeenCalled();
  });
});
