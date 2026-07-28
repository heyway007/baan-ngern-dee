import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Images, LoaderCircle, X } from "lucide-react";

import type {
  Account,
  Category,
  SlipAnalysisResponse
} from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
import { RemoteFinanceError } from "../../lib/remote-finance-api";
import {
  prepareSlipImage,
  type PreparedSlipImage
} from "./slip-image";
import { TransactionForm } from "./transaction-form";

type Props = Readonly<{
  api: FinanceApi;
  workspaceId: string;
  accounts: Account[];
  categories: Category[];
  onClose(): void;
  onPosted(): void;
  onManual(): void;
}>;

export function SlipImportDialog({
  api,
  workspaceId,
  accounts,
  categories,
  onClose,
  onPosted,
  onManual
}: Props) {
  const [image, setImage] = useState<PreparedSlipImage | null>(null);
  const [result, setResult] = useState<SlipAnalysisResponse | null>(null);
  const [status, setStatus] =
    useState<"selecting" | "ready" | "analyzing" | "error">("selecting");
  const [error, setError] = useState("");
  const imageRef = useRef<PreparedSlipImage | null>(null);

  useEffect(() => {
    imageRef.current = image;
  }, [image]);
  useEffect(() => () => imageRef.current?.dispose(), []);

  function disposeImage() {
    imageRef.current?.dispose();
    imageRef.current = null;
    setImage(null);
  }

  async function selectFile(file?: File) {
    if (!file) return;
    disposeImage();
    setResult(null);
    setError("");
    try {
      const prepared = await prepareSlipImage(file);
      imageRef.current = prepared;
      setImage(prepared);
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(
        reason instanceof Error ? reason.message : "เตรียมรูปไม่สำเร็จ"
      );
    }
  }

  async function analyze() {
    if (!image || status === "analyzing") return;
    setStatus("analyzing");
    setError("");
    try {
      const response = await api.analyzeSlip({
        workspaceId,
        clientMutationId: crypto.randomUUID(),
        imageSha256: image.sha256,
        image: image.blob
      });
      setResult(response);
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      if (reason instanceof RemoteFinanceError) {
        setError(
          reason.code === "RATE_LIMITED"
            ? "ใช้การอ่านสลิปครบชั่วคราวแล้ว กรุณาลองใหม่ภายหลัง"
            : "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง"
        );
      } else {
        setError("ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง");
      }
    }
  }

  function close() {
    if (status === "analyzing") return;
    disposeImage();
    onClose();
  }

  return (
    <div className="slip-dialog-backdrop" role="presentation">
      <section
        className="slip-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slip-dialog-title"
      >
        <div className="slip-dialog-heading">
          <div>
            <span className="eyebrow">เพิ่มรายการจากรูป</span>
            <h2 id="slip-dialog-title">อ่านสลิปหรือใบเสร็จ</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="ปิดหน้าต่างอ่านสลิป"
            onClick={close}
            disabled={status === "analyzing"}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <p className="slip-privacy-note">
          รูปจะถูกส่งให้ Cloudflare AI เพื่ออ่านข้อมูล
          ระบบจะไม่เก็บรูปไว้หลังประมวลผล
        </p>

        {!result ? (
          <>
            <div className="slip-file-picker-options">
              <label className="slip-file-picker">
                <Images size={24} aria-hidden="true" />
                <strong>เลือกจากคลังภาพ</strong>
                <span>เลือกรูปสลิปหรือใบเสร็จที่มีอยู่</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="เลือกจากคลังภาพ"
                  onChange={(event) => void selectFile(event.target.files?.[0])}
                  disabled={status === "analyzing"}
                />
              </label>
              <label className="slip-file-picker">
                <Camera size={24} aria-hidden="true" />
                <strong>ถ่ายรูปใหม่</strong>
                <span>เปิดกล้องหลังเพื่อถ่ายเอกสาร</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  aria-label="ถ่ายรูปใหม่"
                  onChange={(event) => void selectFile(event.target.files?.[0])}
                  disabled={status === "analyzing"}
                />
              </label>
            </div>
            <p className="slip-file-help">
              รองรับ JPG, PNG, WebP ไม่เกิน 5 MB
            </p>
            {image ? (
              <img
                className="slip-preview"
                src={image.previewUrl}
                alt="ตัวอย่างสลิปหรือใบเสร็จที่เลือก"
              />
            ) : null}
            {status === "analyzing" ? (
              <div className="slip-progress" role="status">
                <LoaderCircle className="spin" aria-hidden="true" />
                <div>
                  <strong>กำลังตรวจสลิปซ้ำ</strong>
                  <span>กำลังอ่านยอดและรายละเอียด</span>
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="form-error" role="alert">{error}</p>
            ) : null}
            <div className="slip-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  disposeImage();
                  onManual();
                }}
                disabled={status === "analyzing"}
              >
                กรอกเอง
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void analyze()}
                disabled={!image || status === "analyzing"}
              >
                อ่านข้อมูลจากรูป
              </button>
            </div>
          </>
        ) : null}

        {result?.status === "unsupported" ? (
          <div className="slip-result-message">
            <AlertTriangle aria-hidden="true" />
            <h3>ยังอ่านเอกสารนี้ไม่ได้</h3>
            <p>กรุณาใช้สลิปธนาคารไทยหรือใบเสร็จร้านค้าที่เห็นข้อมูลชัดเจน</p>
            <button type="button" className="primary-button" onClick={onManual}>
              กรอกข้อมูลเอง
            </button>
          </div>
        ) : null}

        {result?.status === "duplicate" ? (
          <div className="slip-result-message duplicate">
            <AlertTriangle aria-hidden="true" />
            <h3>รายการนี้ถูกบันทึกแล้ว</h3>
            <p>
              {result.existingTransaction.financialDate} · ฿
              {result.existingTransaction.amount}
            </p>
            {result.existingTransaction.note ? (
              <p>{result.existingTransaction.note}</p>
            ) : null}
            <button type="button" className="secondary-button" onClick={close}>
              กลับ
            </button>
          </div>
        ) : null}

        {result?.status === "success" ? (
          <div className="slip-review">
            <p className="slip-review-intro">
              ตรวจสอบข้อมูลที่อ่านได้ก่อนบันทึก โดยเฉพาะช่องที่มีคำเตือน
            </p>
            <TransactionForm
              api={api}
              workspaceId={workspaceId}
              accounts={accounts}
              categories={categories}
              initialDraft={result.draft}
              analysisToken={result.analysisToken}
              onPosted={() => {
                disposeImage();
                onPosted();
              }}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
