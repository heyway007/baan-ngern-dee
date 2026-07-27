import type {
  AdminInvitation,
  InvitationStatus
} from "@systems-credit/contracts";
import {
  Copy,
  Link2,
  RefreshCw,
  Trash2,
  UserRoundPlus,
  X
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState
} from "react";

import {
  RemoteInvitationError,
  type AdminInvitationApi
} from "../../lib/invitation-api";

const statusLabels = {
  ready: "พร้อมใช้",
  busy: "กำลังดำเนินการ",
  redeemed: "ใช้แล้ว",
  expired: "หมดอายุ",
  revoked: "ยกเลิก"
} satisfies Record<InvitationStatus, string>;

function invitationError(error: unknown): string {
  if (error instanceof RemoteInvitationError) {
    return error.message;
  }
  return "ยังจัดการคำเชิญไม่ได้ กรุณาลองใหม่";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function InvitationsPage({
  api
}: Readonly<{ api: AdminInvitationApi }>) {
  const [invitations, setInvitations] = useState<
    readonly AdminInvitation[]
  >([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvitations(await api.list());
    } catch (caught) {
      setError(invitationError(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  async function createInvitation(event: FormEvent) {
    event.preventDefault();
    setPendingAction("create");
    setError(null);
    setCopied(false);
    try {
      const result = await api.create({ displayName, email });
      setCreatedLink(result.invitationUrl);
      setInvitations((current) => [
        result.invitation,
        ...current.filter(
          (item) => item.id !== result.invitation.id
        )
      ]);
      setDisplayName("");
      setEmail("");
    } catch (caught) {
      setError(invitationError(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function replaceInvitation(invitation: AdminInvitation) {
    setPendingAction(`replace:${invitation.id}`);
    setError(null);
    setCopied(false);
    try {
      const result = await api.replace(invitation.id);
      setCreatedLink(result.invitationUrl);
      setInvitations((current) => [
        result.invitation,
        ...current.map((item) =>
          item.id === invitation.id
            ? { ...item, status: "revoked" as const }
            : item
        )
      ]);
    } catch (caught) {
      setError(invitationError(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function revokeInvitation(invitation: AdminInvitation) {
    if (
      !window.confirm(
        `ยกเลิกคำเชิญของ ${invitation.displayName} ใช่ไหม`
      )
    ) {
      return;
    }
    setPendingAction(`revoke:${invitation.id}`);
    setError(null);
    try {
      await api.revoke(invitation.id);
      setInvitations((current) =>
        current.map((item) =>
          item.id === invitation.id
            ? { ...item, status: "revoked" as const }
            : item
        )
      );
    } catch (caught) {
      setError(invitationError(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function copyLink() {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink);
    setCopied(true);
  }

  return (
    <main className="page-content invitation-admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUPER ADMIN</span>
          <h1>คำเชิญผู้ใช้</h1>
          <p>
            สร้างลิงก์ใช้ครั้งเดียว อายุ 24 ชั่วโมง
            เพื่อให้ผู้รับตั้งรหัสผ่านของตัวเอง
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void loadInvitations()}
          disabled={loading}
        >
          <RefreshCw size={18} aria-hidden="true" />
          โหลดใหม่
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="invitation-admin-grid">
        <section className="content-card invitation-create-card">
          <div className="section-heading">
            <UserRoundPlus aria-hidden="true" />
            <div>
              <h2>สร้างลิงก์ใหม่</h2>
              <p>ระบุชื่อและอีเมลของผู้รับให้ตรงกัน</p>
            </div>
          </div>
          <form
            className="form-grid"
            onSubmit={(event) => void createInvitation(event)}
          >
            <label htmlFor="invitation-display-name">
              ชื่อผู้รับ
            </label>
            <input
              id="invitation-display-name"
              value={displayName}
              onChange={(event) =>
                setDisplayName(event.target.value)
              }
              maxLength={80}
              required
              autoComplete="name"
            />

            <label htmlFor="invitation-email">
              อีเมลผู้รับ
            </label>
            <input
              id="invitation-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />

            <button
              type="submit"
              className="primary-button"
              disabled={pendingAction !== null}
            >
              <Link2 size={18} aria-hidden="true" />
              {pendingAction === "create"
                ? "กำลังสร้าง..."
                : "สร้างลิงก์เชิญ"}
            </button>
          </form>
        </section>

        {createdLink ? (
          <section
            className="content-card invitation-link-panel"
            role="status"
          >
            <button
              type="button"
              className="icon-button"
              aria-label="ปิดลิงก์เชิญ"
              onClick={() => setCreatedLink(null)}
            >
              <X aria-hidden="true" />
            </button>
            <span className="eyebrow">ลิงก์พร้อมส่ง</span>
            <h2>คัดลอกก่อนปิดหน้าต่างนี้</h2>
            <p>
              ลิงก์นี้จะแสดงครั้งเดียว กรุณาคัดลอกก่อนปิด
            </p>
            <code>{createdLink}</code>
            <button
              type="button"
              className="primary-button"
              onClick={() => void copyLink()}
            >
              <Copy size={18} aria-hidden="true" />
              {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
            </button>
          </section>
        ) : null}
      </div>

      <section className="content-card invitation-history">
        <div className="section-heading">
          <div>
            <h2>ประวัติคำเชิญ</h2>
            <p>
              ระบบไม่สามารถเปิดลิงก์เดิมจากประวัติได้
              เพราะไม่ได้เก็บโทเคนจริง
            </p>
          </div>
        </div>

        {loading ? (
          <p role="status">กำลังโหลดคำเชิญ...</p>
        ) : invitations.length === 0 ? (
          <p className="empty-copy">ยังไม่มีคำเชิญ</p>
        ) : (
          <div className="invitation-list">
            {invitations.map((invitation) => {
              const eligible =
                invitation.status === "ready" ||
                invitation.status === "expired";
              return (
                <article
                  className="invitation-row"
                  key={invitation.id}
                >
                  <div>
                    <strong>{invitation.displayName}</strong>
                    <span>{invitation.email}</span>
                  </div>
                  <div className="invitation-dates">
                    <span>
                      สร้าง {formatDate(invitation.createdAt)}
                    </span>
                    <span>
                      หมดอายุ {formatDate(invitation.expiresAt)}
                    </span>
                  </div>
                  <span
                    className={`invitation-status ${invitation.status}`}
                  >
                    {statusLabels[invitation.status]}
                  </span>
                  {eligible ? (
                    <div className="invitation-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`สร้างลิงก์ใหม่ให้ ${invitation.displayName}`}
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void replaceInvitation(invitation)
                        }
                      >
                        <RefreshCw
                          size={17}
                          aria-hidden="true"
                        />
                        สร้างใหม่
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        aria-label={`ยกเลิกคำเชิญ ${invitation.displayName}`}
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void revokeInvitation(invitation)
                        }
                      >
                        <Trash2
                          size={17}
                          aria-hidden="true"
                        />
                        ยกเลิก
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
