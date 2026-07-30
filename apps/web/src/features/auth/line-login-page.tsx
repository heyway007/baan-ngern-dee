import { useEffect, useRef, useState, type JSX } from "react";

import type { CloudAuth } from "../../lib/cloud-auth";
import {
  rememberLineDestination,
  type LineDestination
} from "./line-entry";

type LineLoginPageProps = Readonly<{
  auth: Pick<CloudAuth, "startLineSignIn">;
  destination: LineDestination;
  destinationStorage: Pick<Storage, "setItem">;
  callbackUrl: string;
}>;

export function LineLoginPage({
  auth,
  destination,
  destinationStorage,
  callbackUrl
}: LineLoginPageProps): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const startedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (startedAttempt.current === attempt) {
      return;
    }
    startedAttempt.current = attempt;
    setFailed(false);

    void (async () => {
      try {
        rememberLineDestination(destinationStorage, destination);
        await auth.startLineSignIn(callbackUrl);
      } catch {
        setFailed(true);
      }
    })();
  }, [attempt, auth, callbackUrl, destination, destinationStorage]);

  return (
    <main className="line-entry-shell">
      <section className="line-entry-card" aria-labelledby="line-login-title">
        <span className="eyebrow">LINE</span>
        <h1 id="line-login-title">เข้าสู่บ้านเงินดีด้วย LINE</h1>
        {failed ? (
          <>
            <p role="alert">ยังเข้าสู่ระบบด้วย LINE ไม่สำเร็จ</p>
            <div className="line-entry-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => setAttempt((current) => current + 1)}
              >
                ลองอีกครั้ง
              </button>
            </div>
          </>
        ) : (
          <p role="status">กำลังพาเข้าสู่บ้านเงินดี</p>
        )}
      </section>
    </main>
  );
}

type LineLoginFailurePageProps = Readonly<{
  destination: LineDestination;
}>;

export function LineLoginFailurePage({
  destination
}: LineLoginFailurePageProps): JSX.Element {
  return (
    <main className="line-entry-shell">
      <section className="line-entry-card" aria-labelledby="line-login-failure-title">
        <span className="eyebrow">LINE</span>
        <h1 id="line-login-failure-title">เข้าสู่ระบบด้วย LINE ไม่สำเร็จ</h1>
        <p className="muted">กรุณาลองเข้าสู่ระบบอีกครั้ง</p>
        <div className="line-entry-actions">
          <a
            className="primary-button"
            href={`/line?next=${encodeURIComponent(destination)}`}
          >
            ลองเข้าสู่ระบบด้วย LINE อีกครั้ง
          </a>
          <a className="secondary-button" href="/sign-in">
            เข้าสู่ระบบด้วยอีเมล
          </a>
        </div>
      </section>
    </main>
  );
}
