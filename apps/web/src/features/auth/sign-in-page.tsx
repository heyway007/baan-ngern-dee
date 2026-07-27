import {
  ArrowRight,
  Cloud,
  MailCheck,
  ShieldCheck
} from "lucide-react";
import {
  useState,
  type FormEvent
} from "react";

import type {
  CloudAuth,
  CloudSession
} from "../../lib/cloud-auth";

type AuthActions = Pick<
  CloudAuth,
  "signIn" | "signUp" | "requestPasswordReset"
>;

type SignInPageProps = Readonly<{
  auth: AuthActions;
  onAuthenticated(session: CloudSession): void;
}>;

type AuthMode = "sign-in" | "sign-up" | "reset";

export function SignInPage({
  auth,
  onAuthenticated
}: SignInPageProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = displayName.trim();
    if (!normalizedEmail) {
      setError("กรุณากรอกอีเมล");
      return;
    }
    if (mode === "sign-up" && !normalizedName) {
      setError("กรุณากรอกชื่อที่ต้องการให้ระบบแสดง");
      return;
    }
    if (mode !== "reset" && password.length < 8) {
      setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      if (mode === "reset") {
        await auth.requestPasswordReset(
          normalizedEmail,
          `${window.location.origin}/reset-password`
        );
        setSuccess(
          "ส่งลิงก์แล้ว กรุณาตรวจสอบอีเมลเพื่อตั้งรหัสผ่านใหม่"
        );
        return;
      }
      if (mode === "sign-up") {
        const result = await auth.signUp({
          displayName: normalizedName,
          email: normalizedEmail,
          password,
          redirectTo: `${window.location.origin}/`
        });
        if (result === "confirmation_required") {
          setSuccess(
            "สร้างบัญชีแล้ว กรุณาตรวจสอบอีเมลและกดยืนยันก่อนเข้าสู่ระบบ"
          );
        } else {
          onAuthenticated(result);
        }
        return;
      }
      onAuthenticated(
        await auth.signIn({
          email: normalizedEmail,
          password
        })
      );
    } catch {
      setError(
        mode === "sign-in"
          ? "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน"
          : mode === "sign-up"
            ? "สมัครสมาชิกไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"
            : "ส่งลิงก์ไม่สำเร็จ กรุณาตรวจสอบอีเมลแล้วลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    mode === "sign-in"
      ? "เข้าสู่บ้านเงินดี"
      : mode === "sign-up"
        ? "สร้างบัญชีใหม่"
        : "ตั้งรหัสผ่านใหม่";

  return (
    <main className="sign-in-shell">
      <section className="sign-in-story" aria-labelledby="sign-in-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">฿</span>
          <span>บ้านเงินดี</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">CLOUD FINANCE</span>
          <h1 id="sign-in-title">
            เห็นภาพเงินทั้งหมด
            <br />
            ในที่เดียว
          </h1>
          <p>
            บันทึกรายรับ รายจ่าย บัญชี และหนี้ผ่อนอย่างเป็นระบบ
            พร้อมเข้าถึงข้อมูลเดิมได้จากทุกอุปกรณ์
          </p>
        </div>
        <div className="local-feature">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <strong>ข้อมูลแยกตามบัญชีผู้ใช้</strong>
            <span>ยืนยันตัวตนด้วย Supabase และเรียกข้อมูลผ่าน API ที่ปลอดภัย</span>
          </div>
        </div>
      </section>

      <section className="sign-in-panel" aria-labelledby="account-title">
        <div className="device-badge">
          {mode === "reset" ? (
            <MailCheck size={18} aria-hidden="true" />
          ) : (
            <Cloud size={18} aria-hidden="true" />
          )}
          {mode === "reset" ? "กู้คืนบัญชี" : "เชื่อมต่อระบบคลาวด์"}
        </div>

        {mode !== "reset" ? (
          <div className="auth-mode-switch" aria-label="รูปแบบบัญชี">
            <button
              type="button"
              aria-label="เลือกเข้าสู่ระบบ"
              className={mode === "sign-in" ? "active" : ""}
              aria-pressed={mode === "sign-in"}
              onClick={() => changeMode("sign-in")}
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              className={mode === "sign-up" ? "active" : ""}
              aria-pressed={mode === "sign-up"}
              onClick={() => changeMode("sign-up")}
            >
              สมัครสมาชิก
            </button>
          </div>
        ) : null}

        <h2 id="account-title">{title}</h2>
        <p className="muted">
          {mode === "sign-in"
            ? "ใช้บัญชีเดิมเพื่อซิงก์ข้อมูลการเงินของคุณ"
            : mode === "sign-up"
              ? "เริ่มพื้นที่การเงินส่วนตัวที่เข้าถึงได้ทุกอุปกรณ์"
              : "เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณ"}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {mode === "sign-up" ? (
            <>
              <label htmlFor="display-name">ชื่อที่แสดง</label>
              <input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="เช่น มิน"
                autoComplete="name"
                maxLength={80}
                disabled={submitting}
              />
            </>
          ) : null}

          <label htmlFor="email">อีเมล</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            disabled={submitting}
            autoFocus
          />

          {mode !== "reset" ? (
            <>
              <label htmlFor="password">รหัสผ่าน</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "sign-up"
                    ? "new-password"
                    : "current-password"
                }
                minLength={8}
                disabled={submitting}
              />
            </>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">{error}</p>
          ) : null}
          {success ? (
            <p className="form-success" role="status">{success}</p>
          ) : null}

          <button
            type="submit"
            className="primary-button"
            disabled={submitting}
          >
            {submitting
              ? mode === "sign-in"
                ? "กำลังเข้าสู่ระบบ…"
                : mode === "sign-up"
                  ? "กำลังสร้างบัญชี…"
                  : "กำลังส่งลิงก์…"
              : mode === "sign-in"
                ? "เข้าสู่ระบบ"
                : mode === "sign-up"
                  ? "สร้างบัญชี"
                  : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>

        <button
          type="button"
          className="text-button"
          onClick={() =>
            changeMode(mode === "reset" ? "sign-in" : "reset")
          }
          disabled={submitting}
        >
          {mode === "reset" ? "กลับไปเข้าสู่ระบบ" : "ลืมรหัสผ่าน"}
        </button>

        <p className="privacy-footnote">
          รหัสผ่านถูกจัดการโดย Supabase Auth และไม่ถูกส่งผ่าน Finance API
        </p>
      </section>
    </main>
  );
}
