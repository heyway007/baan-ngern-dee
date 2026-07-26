import { useState, type FormEvent } from "react";
import { ArrowRight, Laptop, ShieldCheck } from "lucide-react";

type SignInPageProps = Readonly<{
  onSignIn(displayName: string): void;
}>;

export function SignInPage({ onSignIn }: SignInPageProps) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setError("กรุณาใส่ชื่อที่ต้องการให้ระบบแสดง");
      return;
    }

    setError("");
    onSignIn(name);
  }

  return (
    <main className="sign-in-shell">
      <section className="sign-in-story" aria-labelledby="sign-in-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">฿</span>
          <span>บ้านเงินดี</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">LOCAL-FIRST FINANCE</span>
          <h1 id="sign-in-title">
            เห็นภาพเงินทั้งหมด
            <br />
            ในที่เดียว
          </h1>
          <p>
            เริ่มบันทึกรายรับ รายจ่าย บัญชี และหนี้ผ่อนได้บนเครื่องนี้
            ก่อนเชื่อมต่อ Supabase ในขั้นถัดไป
          </p>
        </div>
        <div className="local-feature">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <strong>ข้อมูลเริ่มต้นอยู่ในเบราว์เซอร์นี้</strong>
            <span>ยังไม่มีการส่งข้อมูลขึ้นระบบออนไลน์</span>
          </div>
        </div>
      </section>

      <section className="sign-in-panel" aria-labelledby="local-session-title">
        <div className="device-badge">
          <Laptop size={18} aria-hidden="true" />
          ใช้งานเฉพาะเครื่องนี้
        </div>
        <h2 id="local-session-title">เริ่มพื้นที่การเงินของคุณ</h2>
        <p className="muted">
          ชื่อนี้ใช้เพื่อปรับประสบการณ์บนหน้าจอเท่านั้น
        </p>

        <div className="local-warning" role="note">
          นี่ไม่ใช่การล็อกอินสำหรับระบบออนไลน์ และยังไม่สามารถซิงก์ข้อมูลข้ามเครื่องได้
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="display-name">ชื่อที่แสดง</label>
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="เช่น มิน"
            autoComplete="name"
            maxLength={80}
            autoFocus
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit" className="primary-button">
            เริ่มใช้งานบนเครื่องนี้
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>

        <p className="privacy-footnote">
          เมื่อเชื่อม Supabase ภายหลัง ระบบจะมีบัญชีผู้ใช้และสำรองข้อมูลจริง
        </p>
      </section>
    </main>
  );
}
