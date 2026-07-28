import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, Category } from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
import { RemoteFinanceError } from "../../lib/remote-finance-api";
import { SlipImportDialog } from "./slip-import-dialog";
import {
  prepareSlipImage,
  type PreparedSlipImage
} from "./slip-image";

vi.mock("./slip-image", async () => {
  const actual = await vi.importActual<typeof import("./slip-image")>(
    "./slip-image"
  );
  return { ...actual, prepareSlipImage: vi.fn() };
});

const workspaceId = "11111111-1111-4111-8111-111111111111";
const account: Account = {
  id: "22222222-2222-4222-8222-222222222222",
  workspaceId,
  name: "เงินสด",
  type: "cash",
  currency: "THB",
  version: 1
};
const category: Category = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId,
  slug: "food",
  name: "อาหาร",
  kind: "expense",
  isDefault: true,
  version: 1
};

function prepared(fileName: string, sha256 = fileName.padEnd(64, "0")) {
  return {
    blob: new Blob(["image"], { type: "image/jpeg" }),
    mime: "image/jpeg",
    sha256: sha256.slice(0, 64),
    previewUrl: `blob:${fileName}`,
    dispose: vi.fn()
  } satisfies PreparedSlipImage;
}

function success(amount = "60.00") {
  return {
    status: "success" as const,
    analysisToken: "a".repeat(40),
    analysisExpiresAt: "2026-07-29T03:30:00.000Z",
    documentKind: "receipt" as const,
    draft: {
      type: "expense" as const,
      amount,
      currency: "THB",
      financialDate: "2026-07-27",
      accountId: account.id,
      categoryId: category.id,
      fieldsNeedingReview: []
    }
  };
}

function api(overrides: Partial<FinanceApi> = {}) {
  return {
    getSlipQuota: vi.fn().mockResolvedValue({ used: 0, limit: 30 }),
    analyzeSlip: vi.fn().mockResolvedValue(success()),
    confirmSlipBatch: vi.fn(),
    ...overrides
  } as unknown as FinanceApi;
}

function renderDialog(
  financeApi: FinanceApi,
  callbacks: {
    onClose?: ReturnType<typeof vi.fn>;
    onPosted?: ReturnType<typeof vi.fn>;
    onManual?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const onClose = callbacks.onClose ?? vi.fn();
  const onPosted = callbacks.onPosted ?? vi.fn();
  const onManual = callbacks.onManual ?? vi.fn();
  render(
    <SlipImportDialog
      api={financeApi}
      workspaceId={workspaceId}
      accounts={[account]}
      categories={[category]}
      onClose={onClose}
      onPosted={onPosted}
      onManual={onManual}
    />
  );
  return { onClose, onPosted, onManual };
}

describe("SlipImportDialog", () => {
  beforeEach(() => {
    vi.mocked(prepareSlipImage).mockReset();
    vi.mocked(prepareSlipImage).mockImplementation(async (file) =>
      prepared(file.name)
    );
  });

  it("continues updating rows under React Strict Mode", async () => {
    const user = userEvent.setup();
    let used = 0;
    const financeApi = api({
      getSlipQuota: vi.fn(async () => ({ used, limit: 30 })),
      analyzeSlip: vi.fn(async () => {
        used = 1;
        return success();
      })
    });
    render(
      <StrictMode>
        <SlipImportDialog
          api={financeApi}
          workspaceId={workspaceId}
          accounts={[account]}
          categories={[category]}
          onClose={vi.fn()}
          onPosted={vi.fn()}
          onManual={vi.fn()}
        />
      </StrictMode>
    );

    await user.upload(
      screen.getByLabelText("เลือกจากคลังภาพ"),
      new File(["image"], "strict.jpg", { type: "image/jpeg" })
    );
    expect(await screen.findByText("พร้อมบันทึก")).toBeInTheDocument();
    expect(screen.getByText("วันนี้ใช้ 1/30 รูป")).toBeInTheDocument();
  });

  it("selects up to ten gallery files while keeping camera single-file", async () => {
    const user = userEvent.setup();
    const financeApi = api();
    renderDialog(financeApi);
    const galleryInput = screen.getByLabelText("เลือกจากคลังภาพ");
    const cameraInput = screen.getByLabelText("ถ่ายรูปใหม่");

    expect(galleryInput).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp"
    );
    expect(galleryInput).toHaveAttribute("multiple");
    expect(galleryInput).not.toHaveAttribute("capture");
    expect(cameraInput).toHaveAttribute("capture", "environment");
    expect(cameraInput).not.toHaveAttribute("multiple");

    const tooMany = Array.from({ length: 11 }, (_, index) =>
      new File(["image"], `${index}.jpg`, { type: "image/jpeg" })
    );
    await user.upload(galleryInput, tooMany);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เลือกได้ไม่เกิน 10 รูป"
    );
    expect(prepareSlipImage).not.toHaveBeenCalled();
    expect(financeApi.analyzeSlip).not.toHaveBeenCalled();
  });

  it("keeps file order, skips a local duplicate, and analyzes automatically", async () => {
    const user = userEvent.setup();
    vi.mocked(prepareSlipImage).mockImplementation(async (file) =>
      prepared(file.name, "1".repeat(64))
    );
    const financeApi = api({
      analyzeSlip: vi.fn().mockResolvedValue({ status: "unsupported" })
    });
    renderDialog(financeApi);

    await user.upload(screen.getByLabelText("เลือกจากคลังภาพ"), [
      new File(["first"], "first.jpg", { type: "image/jpeg" }),
      new File(["copy"], "copy.jpg", { type: "image/jpeg" })
    ]);

    expect(await screen.findByText("first.jpg")).toBeInTheDocument();
    expect(screen.getByText("copy.jpg")).toBeInTheDocument();
    await waitFor(() =>
      expect(financeApi.analyzeSlip).toHaveBeenCalledTimes(1)
    );
    expect(screen.getByText("รายการซ้ำ")).toBeInTheDocument();
  });

  it("runs at most two analyses concurrently", async () => {
    const user = userEvent.setup();
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const analyzeSlip = vi.fn().mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { status: "unsupported" as const };
    });
    renderDialog(api({ analyzeSlip }));

    await user.upload(screen.getByLabelText("เลือกจากคลังภาพ"), [
      new File(["0"], "0.jpg", { type: "image/jpeg" }),
      new File(["1"], "1.jpg", { type: "image/jpeg" }),
      new File(["2"], "2.jpg", { type: "image/jpeg" }),
      new File(["3"], "3.jpg", { type: "image/jpeg" })
    ]);
    await waitFor(() => expect(analyzeSlip).toHaveBeenCalledTimes(2));
    while (releases.length > 0 || analyzeSlip.mock.calls.length < 4) {
      releases.shift()?.();
      await Promise.resolve();
    }
    await waitFor(() => expect(screen.getAllByText(
      "ไม่รองรับเอกสาร"
    )).toHaveLength(4));
    expect(maximumActive).toBe(2);
  });

  it("retries a failed row with its retained prepared image", async () => {
    const user = userEvent.setup();
    const image = prepared("retry.jpg");
    vi.mocked(prepareSlipImage).mockResolvedValue(image);
    const analyzeSlip = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(success());
    renderDialog(api({ analyzeSlip }));

    await user.upload(
      screen.getByLabelText("เลือกจากคลังภาพ"),
      new File(["image"], "retry.jpg", { type: "image/jpeg" })
    );
    await user.click(
      await screen.findByRole("button", { name: "ลองใหม่ retry.jpg" })
    );
    await waitFor(() => expect(analyzeSlip).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("พร้อมบันทึก")).toBeInTheDocument();
    expect(prepareSlipImage).toHaveBeenCalledOnce();
    expect(image.dispose).not.toHaveBeenCalled();
  });

  it("explains that transient AI failures were retried without using quota", async () => {
    const user = userEvent.setup();
    const analyzeSlip = vi.fn().mockRejectedValue(
      new RemoteFinanceError(
        "AI_UNAVAILABLE",
        503,
        "AI unavailable"
      )
    );
    renderDialog(api({ analyzeSlip }));

    await user.upload(
      screen.getByLabelText("เลือกจากคลังภาพ"),
      new File(["image"], "unstable.jpg", { type: "image/jpeg" })
    );

    expect(await screen.findByText(
      "AI ขัดข้องชั่วคราว ระบบลองให้แล้ว 3 ครั้งและไม่หักโควตา กรุณาลองใหม่"
    )).toBeInTheDocument();
    expect(screen.getByText("วันนี้ใช้ 0/30 รูป")).toBeInTheDocument();
  });

  it("refreshes the server quota after a completed analysis", async () => {
    const user = userEvent.setup();
    const getSlipQuota = vi.fn()
      .mockResolvedValueOnce({ used: 7, limit: 30 })
      .mockResolvedValueOnce({ used: 8, limit: 30 });
    renderDialog(api({ getSlipQuota }));

    expect(await screen.findByText("วันนี้ใช้ 7/30 รูป")).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("เลือกจากคลังภาพ"),
      new File(["image"], "counted.jpg", { type: "image/jpeg" })
    );

    await waitFor(() => expect(getSlipQuota).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("วันนี้ใช้ 8/30 รูป")).toBeInTheDocument();
  });

  it("confirms ready rows atomically and disposes every preview", async () => {
    const user = userEvent.setup();
    const images = [prepared("first.jpg"), prepared("second.jpg")];
    vi.mocked(prepareSlipImage)
      .mockResolvedValueOnce(images[0]!)
      .mockResolvedValueOnce(images[1]!);
    const confirmSlipBatch = vi.fn().mockImplementation(async (input) => ({
      status: "posted" as const,
      items: input.items.map((item: { itemId: string }) => ({
        itemId: item.itemId,
        transaction: {
          transactionId: crypto.randomUUID(),
          version: 1,
          state: "posted" as const,
          accountBalances: []
        }
      }))
    }));
    const callbacks = {
      onPosted: vi.fn(),
      onClose: vi.fn(),
      onManual: vi.fn()
    };
    const financeApi = api({ confirmSlipBatch });
    renderDialog(financeApi, callbacks);

    await user.upload(screen.getByLabelText("เลือกจากคลังภาพ"), [
      new File(["first"], "first.jpg", { type: "image/jpeg" }),
      new File(["second"], "second.jpg", { type: "image/jpeg" })
    ]);
    await user.click(
      await screen.findByRole("button", { name: "บันทึก 2 รายการ" })
    );

    await waitFor(() => expect(confirmSlipBatch).toHaveBeenCalledOnce());
    const input = confirmSlipBatch.mock.calls[0]![0];
    expect(input.items).toHaveLength(2);
    expect(new Set(input.items.map(
      (item: { itemId: string }) => item.itemId
    )).size).toBe(2);
    expect(callbacks.onPosted).toHaveBeenCalledOnce();
    expect(images[0]!.dispose).toHaveBeenCalledOnce();
    expect(images[1]!.dispose).toHaveBeenCalledOnce();
  });

  it("focuses a blocked row and confirms before closing a non-empty queue", async () => {
    const user = userEvent.setup();
    const confirmSlipBatch = vi.fn().mockImplementation(async (input) => ({
      status: "blocked" as const,
      issues: [{
        itemId: input.items[0].itemId,
        code: "invalid_account" as const
      }]
    }));
    const onClose = vi.fn();
    renderDialog(api({ confirmSlipBatch }), { onClose });
    await user.upload(
      screen.getByLabelText("เลือกจากคลังภาพ"),
      new File(["image"], "blocked.jpg", { type: "image/jpeg" })
    );
    await user.click(
      await screen.findByRole("button", { name: "บันทึก 1 รายการ" })
    );
    await waitFor(() =>
      expect(screen.getByLabelText("รายการ blocked.jpg")).toHaveFocus()
    );

    const confirmClose = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(
      screen.getByRole("button", { name: "ปิดหน้าต่างอ่านสลิป" })
    );
    expect(onClose).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "ปิดหน้าต่างอ่านสลิป" })
    );
    expect(onClose).toHaveBeenCalledOnce();
    confirmClose.mockRestore();
  });
});
