import { Plus, ScanLine, Settings2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import type {
  FinanceSnapshot,
  FinanceTransaction
} from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
import { TransactionForm } from "./transaction-form";
import {
  TransactionList,
  type TransactionListFilter
} from "./transaction-list";
import { TransactionVoidDialog } from "./transaction-void-dialog";
import { CategoryManager } from "./category-manager";
import { SlipImportDialog } from "./slip-import-dialog";

type TransactionsPageProps = Readonly<{
  api: FinanceApi;
  snapshot: FinanceSnapshot;
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
  const [showSlipImport, setShowSlipImport] = useState(false);
  const slipButtonRef = useRef<HTMLButtonElement>(null);
  const [transactionFilter, setTransactionFilter] =
    useState<TransactionListFilter>("current");
  const [transactionToVoid, setTransactionToVoid] =
    useState<FinanceTransaction | null>(null);

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
          {snapshot.accounts.length ? (
            <button
              ref={slipButtonRef}
              type="button"
              className="secondary-button compact"
              onClick={() => {
                setShowForm(false);
                setShowSlipImport(true);
              }}
            >
              <ScanLine size={18} aria-hidden="true" />
              อ่านสลิป
            </button>
          ) : null}
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
        filter={transactionFilter}
        onFilterChange={setTransactionFilter}
        onDeleteRequested={setTransactionToVoid}
      />

      {transactionToVoid ? (
        <TransactionVoidDialog
          transaction={transactionToVoid}
          accountName={
            snapshot.accounts.find(
              (account) => account.id === transactionToVoid.accountId
            )?.name ?? "ไม่พบบัญชี"
          }
          categoryName={
            snapshot.categories.find(
              (category) =>
                category.id ===
                (transactionToVoid.categoryId ??
                  transactionToVoid.splits?.[0]?.categoryId)
            )?.name ?? "แบ่งหมวดหมู่"
          }
          onCancel={() => setTransactionToVoid(null)}
          onConfirm={async (reason) => {
            await api.voidTransaction(transactionToVoid.id, {
              version: transactionToVoid.version,
              reason
            });
            setTransactionToVoid(null);
            onChanged();
          }}
        />
      ) : null}
      {showSlipImport ? (
        <SlipImportDialog
          api={api}
          workspaceId={snapshot.workspace.id}
          accounts={snapshot.accounts}
          categories={snapshot.categories}
          onClose={() => {
            setShowSlipImport(false);
            setTimeout(() => slipButtonRef.current?.focus(), 0);
          }}
          onManual={() => {
            setShowSlipImport(false);
            setShowForm(true);
          }}
          onPosted={() => {
            setShowSlipImport(false);
            onChanged();
          }}
        />
      ) : null}
    </main>
  );
}
