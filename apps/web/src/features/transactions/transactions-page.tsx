import { Plus, Settings2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type {
  LocalFinanceApi,
  LocalFinanceSnapshot
} from "../../lib/local-finance-api";
import { TransactionForm } from "./transaction-form";
import { TransactionList } from "./transaction-list";
import { CategoryManager } from "./category-manager";

type TransactionsPageProps = Readonly<{
  api: LocalFinanceApi;
  snapshot: LocalFinanceSnapshot;
  onChanged(): void;
  initiallyOpen?: boolean;
  initialType?: "income" | "expense";
}>;

export function TransactionsPage({
  api,
  snapshot,
  onChanged,
  initiallyOpen = false,
  initialType = "expense"
}: TransactionsPageProps) {
  const [showForm, setShowForm] = useState(initiallyOpen);
  const [showCategories, setShowCategories] = useState(false);

  if (!snapshot.workspace) {
    return null;
  }

  return (
    <main className="page-content transactions-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">กระแสเงินเข้าและออก</span>
          <h1>รายการเงิน</h1>
          <p>บันทึกตามวันที่เกิดรายการจริง เพื่อให้ยอดและรายงานตรงกัน</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => setShowCategories((value) => !value)}
          >
            <Settings2 size={17} aria-hidden="true" />
            หมวดหมู่
          </button>
          {snapshot.accounts.length ? (
            <button
              type="button"
              className="primary-button compact"
              onClick={() => setShowForm((value) => !value)}
            >
              {showForm ? (
                <X size={18} aria-hidden="true" />
              ) : (
                <Plus size={18} aria-hidden="true" />
              )}
              {showForm ? "ปิดแบบฟอร์ม" : "เพิ่มรายการ"}
            </button>
          ) : null}
        </div>
      </div>

      {showCategories ? (
        <section className="content-card category-card">
          <CategoryManager
            api={api}
            workspaceId={snapshot.workspace.id}
            categories={snapshot.categories}
            onChanged={onChanged}
          />
        </section>
      ) : null}

      {!snapshot.accounts.length ? (
        <section className="content-card prerequisite-card">
          <h2>เพิ่มบัญชีก่อนบันทึกรายการ</h2>
          <p>ระบบต้องรู้ว่าเงินเข้าหรือออกจากบัญชีใด</p>
          <Link className="primary-button compact" to="/accounts">
            ไปหน้าบัญชี
          </Link>
        </section>
      ) : null}

      {showForm && snapshot.accounts.length ? (
        <section className="content-card form-card" aria-labelledby="transaction-form-title">
          <div className="section-title">
            <div>
              <span className="eyebrow">รายการใหม่</span>
              <h2 id="transaction-form-title">บันทึกเงินเข้า–ออก</h2>
            </div>
          </div>
          <TransactionForm
            key={initialType}
            api={api}
            workspaceId={snapshot.workspace.id}
            accounts={snapshot.accounts}
            categories={snapshot.categories}
            initialType={initialType}
            onPosted={() => {
              onChanged();
              setShowForm(false);
            }}
          />
        </section>
      ) : null}

      <TransactionList
        transactions={snapshot.transactions}
        accounts={snapshot.accounts}
        categories={snapshot.categories}
      />
    </main>
  );
}
