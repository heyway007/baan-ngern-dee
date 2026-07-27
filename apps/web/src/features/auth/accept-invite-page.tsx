import type {
  InspectInvitationResponse
} from "@systems-credit/contracts";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useState
} from "react";

import type {
  CloudAuth,
  CloudSession
} from "../../lib/cloud-auth";
import {
  RemoteInvitationError,
  type PublicInvitationApi
} from "../../lib/invitation-api";

type AcceptInvitePageProps = Readonly<{
  api: PublicInvitationApi;
  auth: Pick<CloudAuth, "signIn">;
  onAuthenticated(session: CloudSession): void;
}>;

function readInvitationToken() {
  return new URLSearchParams(
    window.location.hash.replace(/^#/, "")
  ).get("token") ?? "";
}

function clearInvitationToken() {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`
  );
}

function inspectErrorMessage(error: unknown) {
  if (error instanceof RemoteInvitationError) {
    if (error.code === "INVITATION_EXPIRED") {
      return "ลิงก์คำเชิญหมดอายุแล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ";
    }
    if (error.code === "INVITATION_REDEEMED") {
      return "ลิงก์คำเชิญนี้ถูกใช้แล้ว";
    }
    if (error.code === "INVITATION_BUSY") {
      return "ลิงก์คำเชิญกำลังถูกใช้งาน กรุณารอสักครู่แล้วลองใหม่";
    }
  }
  return "ลิงก์คำเชิญไม่ถูกต้องหรือไม่สามารถใช้งานได้";
}

function redeemErrorMessage(error: unknown) {
  if (error instanceof RemoteInvitationError) {
    if (error.code === "PASSWORD_POLICY_FAILED") {
      return "รหัสผ่านยังไม่ผ่านเงื่อนไขความปลอดภัย กรุณาใช้รหัสผ่านที่คาดเดาได้ยากขึ้น";
    }
    if (error.code === "EMAIL_ALREADY_REGISTERED") {
      return "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิม";
    }
    return inspectErrorMessage(error);
  }
  return "ยังสร้างบัญชีไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
}

export function AcceptInvitePage({
  api,
  auth,
  onAuthenticated
}: AcceptInvitePageProps) {
  const [token] = useState(readInvitationToken);
  const [invitation, setInvitation] =
    useState<InspectInvitationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    clearInvitationToken();
    if (!token) {
      setError("ลิงก์คำเชิญไม่ถูกต้องหรือไม่สามารถใช้งานได้");
      setLoading(false);
      return;
    }

    let active = true;
    void api
      .inspect(token)
      .then((result) => {
        if (active) {
          setInvitation(result);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(inspectErrorMessage(caught));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api, token]);

  async function acceptInvitation(
    event: FormEvent<HTMLFormElement>
  ) {
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
      const result = await api.redeem({ token, password });
      try {
        const session = await auth.signIn({
          email: result.email,
          password
        });
        onAuthenticated(session);
      } catch {
        setError(
          "สร้างบัญชีแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่สำเร็จ กรุณาไปหน้าเข้าสู่ระบบและใช้รหัสผ่านที่เพิ่งตั้ง"
        );
      }
    } catch (caught) {
      setError(redeemErrorMessage(caught));
    } finally {
      setPassword("");
      setConfirmation("");
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-center-shell invitation-accept-shell">
      <section className="setup-card invitation-accept-card">
        <div className="device-badge">
          <ShieldCheck size={18} aria-hidden="true" />
          คำเชิญที่ปลอดภัย
        </div>
        <h1>ตั้งรหัสผ่านเพื่อเริ่มใช้งาน</h1>
        <p className="muted">
          ลิงก์นี้ใช้ได้ครั้งเดียว และบัญชีของคุณจะมีพื้นที่การเงินส่วนตัว
        </p>

        {loading ? (
          <p role="status">กำลังตรวจสอบคำเชิญ…</p>
        ) : invitation ? (
          <>
            <div className="invitation-recipient">
              <span className="avatar" aria-hidden="true">
                {invitation.displayName.slice(0, 1)}
              </span>
              <span>
                <strong>{invitation.displayName}</strong>
                <small>{invitation.maskedEmail}</small>
              </span>
            </div>

            <form onSubmit={acceptInvitation} noValidate>
              <label htmlFor="invitation-password">รหัสผ่าน</label>
              <input
                id="invitation-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                disabled={submitting}
                autoFocus
              />

              <label htmlFor="invitation-confirmation">
                ยืนยันรหัสผ่าน
              </label>
              <input
                id="invitation-confirmation"
                type="password"
                value={confirmation}
                onChange={(event) =>
                  setConfirmation(event.target.value)
                }
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                disabled={submitting}
              />

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="primary-button"
                disabled={submitting}
              >
                <KeyRound size={18} aria-hidden="true" />
                {submitting
                  ? "กำลังสร้างบัญชี…"
                  : "สร้างบัญชีและเข้าสู่ระบบ"}
              </button>
            </form>
          </>
        ) : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
