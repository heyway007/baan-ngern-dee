import { useEffect, useRef, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import type { CloudSession } from "../../lib/cloud-auth";
import type { FinanceApi } from "../../lib/finance-api";
import {
  clearLineDestination,
  lineWorkspaceName,
  type LineDestination
} from "./line-entry";

type LineWorkspacePageProps = Readonly<{
  session: CloudSession;
  hasWorkspace: boolean;
  api: Pick<FinanceApi, "createPrivateWorkspace">;
  destination: LineDestination;
  destinationStorage: Pick<Storage, "removeItem">;
  onWorkspaceChanged(): Promise<void>;
}>;

export function LineWorkspacePage({
  session,
  hasWorkspace,
  api,
  destination,
  destinationStorage,
  onWorkspaceChanged
}: LineWorkspacePageProps): JSX.Element {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const navigated = useRef(false);
  const hasWorkspaceRef = useRef(hasWorkspace);
  hasWorkspaceRef.current = hasWorkspace;

  useEffect(() => {
    if (hasWorkspace) {
      if (!navigated.current) {
        navigated.current = true;
        clearLineDestination(destinationStorage);
        navigate(destination, { replace: true });
      }
      return;
    }
    if (started.current) {
      return;
    }
    started.current = true;

    void (async () => {
      try {
        await api.createPrivateWorkspace({
          name: lineWorkspaceName(session.displayName),
          baseCurrency: "THB",
          timeZone: "Asia/Bangkok"
        });
      } catch {
        try {
          await onWorkspaceChanged();
        } catch {
          // The controlled Thai retry state is set below.
        }
        if (!hasWorkspaceRef.current) {
          setFailed(true);
        }
        return;
      }

      try {
        await onWorkspaceChanged();
      } catch {
        // Workspace creation succeeded; wait for a later authoritative refresh.
      }
    })();
  }, [
    api,
    attempt,
    destination,
    destinationStorage,
    hasWorkspace,
    navigate,
    onWorkspaceChanged,
    session.displayName
  ]);

  function retry() {
    started.current = false;
    setFailed(false);
    setAttempt((current) => current + 1);
  }

  return (
    <main className="line-entry-shell">
      <section className="line-entry-card" aria-labelledby="line-workspace-title">
        <span className="eyebrow">LINE</span>
        <h1 id="line-workspace-title">กำลังเตรียมบ้านเงินดีของคุณ</h1>
        {failed ? (
          <>
            <p role="alert">ยังสร้างพื้นที่ส่วนตัวไม่สำเร็จ</p>
            <div className="line-entry-actions">
              <button type="button" className="primary-button" onClick={retry}>
                ลองอีกครั้ง
              </button>
            </div>
          </>
        ) : (
          <p role="status">กำลังสร้างพื้นที่ส่วนตัว</p>
        )}
      </section>
    </main>
  );
}
