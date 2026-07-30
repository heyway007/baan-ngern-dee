import type {
  AdminUser,
  AdminUserStatus
} from "@systems-credit/contracts";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState
} from "react";

import {
  UserManagementApiFailure,
  type UserManagementApi
} from "../../lib/user-management-api";

type PageState = Readonly<{
  search: string;
  cursor?: string;
}>;

const statusLabels: Record<AdminUserStatus, string> = {
  unconfirmed: "ยังไม่ยืนยัน",
  active: "ใช้งานอยู่",
  suspended: "ระงับ",
  deletion_pending: "กำลังลบ"
};

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function managementError(error: unknown): string {
  if (
    error instanceof UserManagementApiFailure &&
    error.code === "USER_SHARED_DATA_CONFLICT"
  ) {
    return "ยังลบบัญชีนี้ไม่ได้ กรุณาโอนความเป็นเจ้าของ สมาชิก หรือประวัติในพื้นที่ครอบครัว/พื้นที่ที่ใช้ร่วมกันก่อน";
  }
  if (error instanceof UserManagementApiFailure) {
    return error.message;
  }
  return "ยังจัดการผู้ใช้ไม่ได้ กรุณาลองใหม่";
}

function deletionConfirmation(user: AdminUser): string {
  return user.email ?? user.userId;
}

function deletionConfirmationMatches(
  user: AdminUser,
  value: string
): boolean {
  return user.email
    ? value.trim().toLowerCase() === user.email
    : value.trim() === user.userId;
}

export function UsersPage({
  api,
  signedInUserId,
  protectedUserId = signedInUserId
}: Readonly<{
  api: UserManagementApi;
  signedInUserId: string;
  protectedUserId?: string;
}>) {
  const [searchInput, setSearchInput] = useState("");
  const [pageState, setPageState] = useState<PageState>({
    search: ""
  });
  const [cursorStack, setCursorStack] = useState<
    Array<string | undefined>
  >([]);
  const [users, setUsers] = useState<readonly AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AdminUser | null>(null);
  const [typedConfirmation, setTypedConfirmation] =
    useState("");

  const loadUsers = useCallback(
    async (state: PageState) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.list({
          search: state.search,
          limit: 25,
          ...(state.cursor ? { cursor: state.cursor } : {})
        });
        setUsers(result.users);
        setNextCursor(result.nextCursor);
      } catch (caught) {
        setError(managementError(caught));
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void loadUsers(pageState);
  }, [loadUsers, pageState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = searchInput.trim().toLowerCase();
      if (normalized === pageState.search) return;
      setCursorStack([]);
      setPageState({ search: normalized });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [pageState.search, searchInput]);

  async function runMutation(
    key: string,
    action: () => Promise<unknown>,
    successMessage: string
  ) {
    setPendingAction(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await loadUsers(pageState);
    } catch (caught) {
      setError(managementError(caught));
    } finally {
      setPendingAction(null);
    }
  }

  function openDelete(user: AdminUser) {
    setTypedConfirmation("");
    setDeleteTarget(user);
    setError(null);
    setNotice(null);
  }

  async function permanentlyDelete() {
    if (
      !deleteTarget ||
      !deletionConfirmationMatches(
        deleteTarget,
        typedConfirmation
      )
    ) {
      return;
    }
    const target = deleteTarget;
    setPendingAction(`delete:${target.userId}`);
    setError(null);
    setNotice(null);
    try {
      await api.delete(target.userId, {
        confirmation: deletionConfirmation(target),
        clientMutationId: crypto.randomUUID()
      });
      setDeleteTarget(null);
      setTypedConfirmation("");
      setCursorStack([]);
      const firstPage = { search: pageState.search };
      setPageState(firstPage);
      setNotice("ลบบัญชีผู้ใช้แล้ว");
      await loadUsers(firstPage);
    } catch (caught) {
      setError(managementError(caught));
    } finally {
      setPendingAction(null);
    }
  }

  function nextPage() {
    if (!nextCursor) return;
    setCursorStack((current) => [
      ...current,
      pageState.cursor
    ]);
    setPageState({
      search: pageState.search,
      cursor: nextCursor
    });
  }

  function previousPage() {
    const previous = cursorStack.at(-1);
    setCursorStack((current) => current.slice(0, -1));
    setPageState({
      search: pageState.search,
      ...(previous ? { cursor: previous } : {})
    });
  }

  const controlsDisabled = pendingAction !== null;

  return (
    <main className="page-content admin-users-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUPER ADMIN</span>
          <h1>จัดการผู้ใช้</h1>
          <p>
            ตรวจสอบบัญชี ยืนยัน ระงับ เปิดใช้งาน
            ส่งอีเมลรีเซ็ตรหัสผ่าน และลบบัญชีอย่างปลอดภัย
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void loadUsers(pageState)}
          disabled={loading || controlsDisabled}
        >
          <RefreshCw size={18} aria-hidden="true" />
          โหลดใหม่
        </button>
      </div>

      <section className="content-card admin-users-toolbar">
        <label htmlFor="admin-user-search">
          ค้นหาชื่อ อีเมล หรือรหัสผู้ใช้
        </label>
        <div className="admin-users-search">
          <Search size={18} aria-hidden="true" />
          <input
            id="admin-user-search"
            type="search"
            value={searchInput}
            onChange={(event) =>
              setSearchInput(event.target.value)
            }
            placeholder="เช่น friend@example.com"
            disabled={controlsDisabled}
          />
        </div>
      </section>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="form-success admin-users-notice"
          role="status"
          aria-label={notice}
        >
          {notice}
        </p>
      ) : null}

      <section className="content-card admin-users-list-card">
        {loading ? (
          <p role="status" aria-label="กำลังโหลดผู้ใช้">
            กำลังโหลดผู้ใช้...
          </p>
        ) : users.length === 0 ? (
          <p className="empty-copy">
            ไม่พบผู้ใช้ที่ตรงกับคำค้น
          </p>
        ) : (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>ผู้ใช้</th>
                  <th>สถานะ</th>
                  <th>เข้าใช้ล่าสุด</th>
                  <th>พื้นที่ส่วนตัว</th>
                  <th>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const protectedAccount =
                    user.userId === signedInUserId ||
                    user.userId === protectedUserId;
                  return (
                    <tr
                      className="admin-users-row"
                      key={user.userId}
                    >
                      <td data-label="ผู้ใช้">
                        <strong>{user.displayName}</strong>
                        {user.email ? (
                          <small>{user.email}</small>
                        ) : (
                          <>
                            <small>บัญชี LINE</small>
                            <small>{user.userId}</small>
                          </>
                        )}
                      </td>
                      <td data-label="สถานะ">
                        <span
                          className={`user-status user-status-${user.status}`}
                        >
                          {statusLabels[user.status]}
                        </span>
                      </td>
                      <td data-label="เข้าใช้ล่าสุด">
                        {formatDate(user.lastSignInAt)}
                      </td>
                      <td data-label="พื้นที่ส่วนตัว">
                        {user.privateWorkspaceCount}
                      </td>
                      <td data-label="การจัดการ">
                        <div className="admin-users-actions">
                          {user.email &&
                          user.status === "unconfirmed" ? (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="ยืนยันบัญชี"
                              title="ยืนยันบัญชี"
                              disabled={controlsDisabled}
                              onClick={() =>
                                void runMutation(
                                  `confirm:${user.userId}`,
                                  () => api.confirm(user.userId),
                                  "ยืนยันบัญชีแล้ว"
                                )
                              }
                            >
                              <CheckCircle2 aria-hidden="true" />
                            </button>
                          ) : null}
                          {user.status === "active" ||
                          user.status === "unconfirmed" ? (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="ระงับบัญชี"
                              title="ระงับบัญชี"
                              disabled={
                                controlsDisabled ||
                                protectedAccount
                              }
                              onClick={() =>
                                void runMutation(
                                  `suspend:${user.userId}`,
                                  () => api.suspend(user.userId),
                                  "ระงับบัญชีแล้ว"
                                )
                              }
                            >
                              <Ban aria-hidden="true" />
                            </button>
                          ) : null}
                          {user.status === "suspended" ? (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="เปิดใช้งาน"
                              title="เปิดใช้งาน"
                              disabled={
                                controlsDisabled ||
                                protectedAccount
                              }
                              onClick={() =>
                                void runMutation(
                                  `resume:${user.userId}`,
                                  () => api.resume(user.userId),
                                  "เปิดใช้งานบัญชีแล้ว"
                                )
                              }
                            >
                              <RotateCcw aria-hidden="true" />
                            </button>
                          ) : null}
                          {user.email &&
                          !user.deletionPending ? (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="ส่งรีเซ็ตรหัสผ่าน"
                              title="ส่งรีเซ็ตรหัสผ่าน"
                              disabled={controlsDisabled}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `ส่งอีเมลรีเซ็ตรหัสผ่านให้ ${user.email} ใช่ไหม`
                                  )
                                ) {
                                  void runMutation(
                                    `reset:${user.userId}`,
                                    () =>
                                      api.sendPasswordReset(
                                        user.userId
                                      ),
                                    "ส่งอีเมลรีเซ็ตรหัสผ่านแล้ว"
                                  );
                                }
                              }}
                            >
                              <KeyRound aria-hidden="true" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="icon-button danger-icon-button"
                            aria-label="ลบบัญชีถาวร"
                            title={
                              protectedAccount
                                ? "บัญชีนี้ได้รับการป้องกัน"
                                : "ลบบัญชีถาวร"
                            }
                            disabled={
                              controlsDisabled ||
                              protectedAccount ||
                              user.deletionPending
                            }
                            onClick={() => openDelete(user)}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-users-pagination">
          <button
            type="button"
            className="ghost-button"
            onClick={previousPage}
            disabled={
              cursorStack.length === 0 ||
              loading ||
              controlsDisabled
            }
          >
            <ChevronLeft size={18} aria-hidden="true" />
            หน้าก่อน
          </button>
          <span>หน้า {cursorStack.length + 1}</span>
          <button
            type="button"
            className="ghost-button"
            aria-label="หน้าถัดไป"
            onClick={nextPage}
            disabled={!nextCursor || loading || controlsDisabled}
          >
            หน้าถัดไป
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      {deleteTarget ? (
        <div
          className="danger-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            deleteTarget.email
              ? `ลบบัญชี ${deleteTarget.email}`
              : `ลบบัญชี LINE ${deleteTarget.userId}`
          }
        >
          <section className="danger-confirm-card">
            <button
              type="button"
              className="icon-button danger-confirm-close"
              aria-label="ปิดหน้าต่างลบบัญชี"
              disabled={controlsDisabled}
              onClick={() => setDeleteTarget(null)}
            >
              <X aria-hidden="true" />
            </button>
            <span className="eyebrow">ลบถาวร</span>
            <h2>
              {deleteTarget.email
                ? `ลบบัญชี ${deleteTarget.email}`
                : `ลบบัญชี LINE ${deleteTarget.userId}`}
            </h2>
            <p>
              ระบบจะลบพื้นที่ส่วนตัวและข้อมูลส่วนตัวของผู้ใช้นี้
              การดำเนินการย้อนกลับไม่ได้
            </p>
            <div className="danger-confirm-target">
              <strong>{deleteTarget.displayName}</strong>
              <span>
                {deleteTarget.email ?? "บัญชี LINE"}
              </span>
              {!deleteTarget.email ? (
                <span>{deleteTarget.userId}</span>
              ) : null}
              <span>{statusLabels[deleteTarget.status]}</span>
            </div>
            <label htmlFor="delete-user-confirmation">
              {deleteTarget.email
                ? "พิมพ์อีเมลเพื่อยืนยัน"
                : "พิมพ์รหัสผู้ใช้เพื่อยืนยัน"}
            </label>
            <input
              id="delete-user-confirmation"
              type={deleteTarget.email ? "email" : "text"}
              value={typedConfirmation}
              onChange={(event) =>
                setTypedConfirmation(event.target.value)
              }
              autoComplete="off"
              disabled={controlsDisabled}
            />
            <div className="danger-confirm-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={controlsDisabled}
                onClick={() => setDeleteTarget(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="danger-button danger-confirm-submit"
                aria-label="ยืนยันลบบัญชีถาวร"
                disabled={
                  controlsDisabled ||
                  !deletionConfirmationMatches(
                    deleteTarget,
                    typedConfirmation
                  )
                }
                onClick={() => void permanentlyDelete()}
              >
                <Trash2 size={18} aria-hidden="true" />
                ยืนยันลบบัญชีถาวร
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
