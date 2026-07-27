import { useState, type FormEvent } from "react";

import type {
  FinanceApi,
  WorkspaceCreationResult
} from "../../lib/finance-api";

type OnboardingPageProps = Readonly<{
  api: Pick<FinanceApi, "createPrivateWorkspace">;
  onComplete(workspace: WorkspaceCreationResult["workspace"]): void;
}>;

export function OnboardingPage({
  api,
  onComplete
}: OnboardingPageProps) {
  const [name, setName] = useState("การเงินของฉัน");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("กรุณาตั้งชื่อพื้นที่ส่วนตัว");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.createPrivateWorkspace({
        name: trimmedName,
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      });
      onComplete(result.workspace);
    } catch {
      setError(
        "ยังสร้างพื้นที่ไม่ได้ ข้อมูลของคุณยังไม่ถูกบันทึก กรุณาลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-copy" aria-labelledby="welcome-title">
        <span className="eyebrow">เริ่มต้นบนคลาวด์</span>
        <h1 id="welcome-title">
          เงินทุกก้อน
          <br />
          มีเรื่องราวของมัน
        </h1>
        <p>
          เริ่มจากพื้นที่ส่วนตัวของคุณ ตั้งค่าด้วยเงินบาทและเวลาไทย
          แล้วค่อยเพิ่มบัญชีที่ใช้อยู่จริง
        </p>
        <div className="privacy-note">
          <span aria-hidden="true">●</span>
          Cloud mode — ข้อมูลซิงก์ผ่านบัญชี Supabase ของคุณ
        </div>
      </section>

      <section className="setup-card" aria-labelledby="setup-title">
        <div className="step-indicator" aria-label="ขั้นตอนที่ 1 จาก 2">
          <span className="active" />
          <span />
        </div>
        <p className="step-label">ขั้นตอนที่ 1 จาก 2</p>
        <h2 id="setup-title">สร้างพื้นที่ส่วนตัว</h2>
        <p className="muted">
          คุณสามารถสร้างพื้นที่ครอบครัวเพิ่มภายหลังได้
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="workspace-name">ชื่อพื้นที่ส่วนตัว</label>
          <input
            id="workspace-name"
            autoComplete="organization"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />

          <div className="locked-settings" aria-label="ค่าเริ่มต้น">
            <div>
              <span>สกุลเงินหลัก</span>
              <strong>THB — บาทไทย</strong>
            </div>
            <div>
              <span>เขตเวลา</span>
              <strong>Asia/Bangkok</strong>
            </div>
          </div>

          {error ? <p role="alert" className="form-error">{error}</p> : null}

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "กำลังสร้าง…" : "สร้างพื้นที่"}
          </button>
        </form>
      </section>
    </main>
  );
}
