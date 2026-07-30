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

import {
  CloudAuthFailure,
  type CloudAuth,
  type CloudAuthErrorCode,
  type CloudSession
} from "../../lib/cloud-auth";
import { TurnstileWidget } from "./turnstile-widget";

type AuthActions = Pick<
  CloudAuth,
  "signIn" | "signUp" | "requestPasswordReset"
>;

type SignInPageProps = Readonly<{
  auth: AuthActions;
  turnstileSiteKey: string;
  onAuthenticated(session: CloudSession): void;
}>;

type AuthMode = "sign-in" | "sign-up" | "reset";

const cloudAuthMessages: Record<CloudAuthErrorCode, string> = {
  AUTH_EMAIL_EXISTS:
    "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือกดลืมรหัสผ่าน",
  AUTH_EMAIL_NOT_CONFIRMED:
    "บัญชีนี้ยังไม่ยืนยัน กรุณาให้ผู้ดูแลระบบยืนยันบัญชีให้",
  AUTH_INVALID_CREDENTIALS: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  AUTH_USER_SUSPENDED:
    "บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ",
  AUTH_WEAK_PASSWORD:
    "รหัสผ่านไม่ผ่านนโยบายความปลอดภัย กรุณาใช้รหัสที่เดายากขึ้น",
  AUTH_CAPTCHA_FAILED:
    "การตรวจสอบความปลอดภัยไม่สำเร็จ กรุณาลองใหม่",
  AUTH_RATE_LIMITED:
    "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  AUTH_NETWORK_UNAVAILABLE:
    "ยังเชื่อมต่อระบบบัญชีไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่",
  AUTH_SIGNUP_SESSION_REQUIRED:
    "สร้างบัญชีแล้วแต่ยังเข้าใช้งานไม่ได้ กรุณาให้ผู้ดูแลตรวจการตั้งค่า Confirm Email",
  AUTH_UNKNOWN:
    "ระบบบัญชีขัดข้องชั่วคราว กรุณาลองใหม่"
};

function authErrorMessage(
  caught: unknown,
  mode: AuthMode
): string {
  if (caught instanceof CloudAuthFailure) {
    return cloudAuthMessages[caught.code];
  }
  return mode === "sign-in"
    ? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่"
    : mode === "sign-up"
      ? "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่"
      : "ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่";
}

export function SignInPage({
  auth,
  turnstileSiteKey,
  onAuthenticated
}: SignInPageProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
    setCaptchaToken("");
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
    if (mode === "sign-up" && password !== confirmPassword) {
      setError("รหัสผ่านไม่ตรงกัน");
      return;
    }
    if (mode === "sign-up" && !captchaToken) {
      setError("กรุณาผ่านการตรวจสอบความปลอดภัย");
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
          captchaToken
        });
        onAuthenticated(result);
        return;
      }
      onAuthenticated(
        await auth.signIn({
          email: normalizedEmail,
          password
        })
      );
    } catch (caught) {
      setError(authErrorMessage(caught, mode));
    } finally {
      setSubmitting(false);
      if (mode !== "reset") {
        setPassword("");
      }
      if (mode === "sign-up") {
        setConfirmPassword("");
        setCaptchaToken("");
        setTurnstileResetKey((value) => value + 1);
      }
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

        {mode !== "reset" ? (
          <div className="line-login-options">
            <a
              className="line-login-button"
              href="/line?next=/overview"
            >
              <span
                className="line-login-mark"
                aria-hidden="true"
              >
                LINE
              </span>
              <span>เข้าสู่ระบบด้วย LINE</span>
            </a>
            <div className="auth-divider" aria-hidden="true">
              <span>หรือเข้าสู่ระบบด้วยอีเมล</span>
            </div>
          </div>
        ) : null}

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

          {mode === "sign-up" ? (
            <>
              <label htmlFor="confirm-password">
                ยืนยันรหัสผ่าน
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                autoComplete="new-password"
                minLength={8}
                disabled={submitting}
              />
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                onToken={setCaptchaToken}
                resetKey={turnstileResetKey}
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
