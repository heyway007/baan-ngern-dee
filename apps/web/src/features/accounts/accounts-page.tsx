import {
  Banknote,
  Building2,
  CreditCard,
  Gem,
  Landmark,
  Plus,
  Smartphone,
  WalletCards,
  X
} from "lucide-react";
import { useState, type ComponentType } from "react";

import type { Account } from "@systems-credit/contracts";

import type { LocalFinanceApi, LocalFinanceSnapshot } from "../../lib/local-finance-api";
import { formatMoney } from "../../lib/money-display";
import { AccountForm } from "./account-form";

type AccountsPageProps = Readonly<{
  api: LocalFinanceApi;
  snapshot: LocalFinanceSnapshot;
  onChanged(): void;
}>;

const accountPresentation: Record<
  Account["type"],
  { label: string; icon: ComponentType<{ size?: number }> }
> = {
  cash: { label: "เงินสด", icon: Banknote },
  bank: { label: "บัญชีธนาคาร", icon: Landmark },
  ewallet: { label: "e-Wallet", icon: Smartphone },
  credit_card: { label: "บัตรเครดิต", icon: CreditCard },
  loan: { label: "เงินกู้", icon: Building2 },
  asset: { label: "สินทรัพย์", icon: Gem }
};

export function AccountsPage({
  api,
  snapshot,
  onChanged
}: AccountsPageProps) {
  const [showForm, setShowForm] = useState(snapshot.accounts.length === 0);

  if (!snapshot.workspace) {
    return null;
  }

  return (
    <main className="page-content accounts-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">เงินของฉันอยู่ที่ไหนบ้าง</span>
          <h1>บัญชีทั้งหมด</h1>
          <p>ยอดตั้งต้นจะถูกเก็บอย่างแม่นยำและตรวจสอบย้อนหลังได้</p>
        </div>
        <button
          type="button"
          className="primary-button compact"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          {showForm ? "ปิดแบบฟอร์ม" : "เพิ่มบัญชี"}
        </button>
      </div>

      {showForm ? (
        <section className="content-card form-card" aria-labelledby="account-form-title">
          <div className="section-title">
            <div>
              <span className="eyebrow">บัญชีใหม่</span>
              <h2 id="account-form-title">เพิ่มแหล่งเงินหรือภาระหนี้</h2>
            </div>
          </div>
          <AccountForm
            api={api}
            workspaceId={snapshot.workspace.id}
            onCreated={() => {
              onChanged();
              setShowForm(false);
            }}
          />
        </section>
      ) : null}

      {snapshot.accounts.length ? (
        <section className="account-grid" aria-label="รายการบัญชี">
          {snapshot.accounts.map((account) => {
            const presentation = accountPresentation[account.type];
            const Icon = presentation.icon;
            const balance = snapshot.accountBalances[account.id];
            return (
              <article className={`account-card type-${account.type}`} key={account.id}>
                <div className="account-card-head">
                  <span className="account-icon">
                    <Icon size={23} aria-hidden="true" />
                  </span>
                  <span className="account-type">{presentation.label}</span>
                </div>
                <div>
                  <h2>{account.name}</h2>
                  <p>{account.institution ?? "บัญชีส่วนตัว"}</p>
                </div>
                <div className="account-balance">
                  <small>ยอดปัจจุบัน</small>
                  <strong>
                    {formatMoney(balance?.amount ?? "0.00", account.currency)}
                  </strong>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="empty-state">
          <WalletCards size={40} aria-hidden="true" />
          <h2>ยังไม่มีบัญชี</h2>
          <p>เริ่มจากเงินสดหรือบัญชีธนาคารที่ใช้เป็นประจำ</p>
        </section>
      )}
    </main>
  );
}
