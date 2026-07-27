import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { CloudAuth } from "../../lib/cloud-auth";

type ResetPasswordPageProps = Readonly<{
  auth: Pick<CloudAuth, "updatePassword">;
  onComplete(): void;
}>;

export function ResetPasswordPage({
  auth,
  onComplete
}: ResetPasswordPageProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (password !== confirmation) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await auth.updatePassword(password);
      setSuccess(true);
    } catch {
      setError(
        "เปลี่ยนรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ กรุณาขอลิงก์ใหม่"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-center-shell">
      <section className="setup-card auth-reset-card">
        <div className="device-badge">
          <KeyRound size={18} aria-hidden="true" />
          ความปลอดภัยของบัญชี
        </div>
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <p className="muted">
          ใช้รหัสผ่านอย่างน้อย 8 ตัวอักษรที่คาดเดาได้ยาก
        </p>

        {success ? (
          <div className="auth-success-panel" role="status">
            <h2>เปลี่ยนรหัสผ่านแล้ว</h2>
            <p>คุณสามารถใช้รหัสผ่านใหม่กับบัญชีนี้ได้ทันที</p>
            <button
              type="button"
              className="primary-button"
              onClick={onComplete}
            >
              กลับเข้าสู่ระบบ
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor="new-password">รหัสผ่านใหม่</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              disabled={submitting}
              autoFocus
            />

            <label htmlFor="confirm-password">
              ยืนยันรหัสผ่านใหม่
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmation}
              onChange={(event) =>
                setConfirmation(event.target.value)
              }
              autoComplete="new-password"
              minLength={8}
              disabled={submitting}
            />

            {error ? (
              <p className="form-error" role="alert">{error}</p>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={submitting}
            >
              {submitting
                ? "กำลังบันทึก…"
                : "บันทึกรหัสผ่านใหม่"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
