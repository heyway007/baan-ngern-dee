import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { SlipImportDialog } from "./slip-import-dialog";

describe("SlipImportDialog", () => {
  it("lets mobile users choose an existing image or open the camera", () => {
    render(
      <SlipImportDialog
        api={{} as FinanceApi}
        workspaceId="11111111-1111-4111-8111-111111111111"
        accounts={[]}
        categories={[]}
        onClose={vi.fn()}
        onPosted={vi.fn()}
        onManual={vi.fn()}
      />
    );

    const galleryInput = screen.getByLabelText("เลือกจากคลังภาพ");
    const cameraInput = screen.getByLabelText("ถ่ายรูปใหม่");

    expect(galleryInput).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp"
    );
    expect(galleryInput).not.toHaveAttribute("capture");
    expect(cameraInput).toHaveAttribute("capture", "environment");
  });
});
