import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Plus,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { Link } from "react-router-dom";
import { toFinancialDate } from "@systems-credit/domain";

import type { FinanceSnapshot } from "@systems-credit/contracts";

import type { CloudSession } from "../../lib/cloud-auth";
import { addExactMoney, formatMoney } from "../../lib/money-display";
import { SummaryCards } from "./summary-cards";

type OverviewPageProps = Readonly<{
  session: CloudSession;
  snapshot: FinanceSnapshot;
}>;

export function OverviewPage({ session, snapshot }: OverviewPageProps) {
  const liquidBalances = snapshot.accounts
    .filter(
      (account) =>
        ["cash", "bank", "ewallet"].includes(account.type) &&
        account.currency === "THB"
    )
    .map((account) => snapshot.accountBalances[account.id]?.amount ?? "0.00");
  const available = addExactMoney(liquidBalances);
  const accountCount = snapshot.accounts.length;
  const currentMonth = toFinancialDate(
    new Date().toISOString(),
    snapshot.workspace?.timeZone ?? "Asia/Bangkok"
  ).slice(0, 7);

  return (
    <main className="page-content overview-page">
      <div className="page-heading overview-heading">
        <div>
          <span className="eyebrow">ภาพรวมวันนี้</span>
          <h1>สวัสดี {session.displayName}</h1>
          <p>
            {snapshot.workspace?.name}
          </p>
        </div>
        <Link className="primary-button compact" to="/accounts">
          <Plus size={18} aria-hidden="true" />
          เพิ่มบัญชี
        </Link>
      </div>

      <section className="hero-balance" aria-labelledby="available-title">
        <div className="balance-copy">
          <span id="available-title">เงินที่พร้อมใช้</span>
          <strong>{formatMoney(available)}</strong>
          <small>รวมเงินสด ธนาคาร และ e-Wallet สกุล THB</small>
        </div>
        <div className="balance-orbit" aria-hidden="true">
          <span>฿</span>
        </div>
        <div className="balance-meta">
          <div>
            <WalletCards size={20} aria-hidden="true" />
            <span>
              <small>บัญชีทั้งหมด</small>
              <strong>{accountCount} บัญชี</strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={20} aria-hidden="true" />
            <span>
              <small>สถานะข้อมูล</small>
              <strong>บันทึกในเครื่อง</strong>
            </span>
          </div>
        </div>
      </section>

      <SummaryCards
        month={currentMonth}
        transactions={snapshot.transactions}
      />

      <div className="dashboard-grid">
        <section className="content-card quick-actions">
          <div className="section-title">
            <div>
              <span className="eyebrow">ทางลัด</span>
              <h2>เริ่มบันทึกเงินของคุณ</h2>
            </div>
          </div>
          <div className="quick-action-grid">
            <Link to="/transactions/new?type=income">
              <span className="action-icon income">
                <ArrowDownLeft aria-hidden="true" />
              </span>
              <strong>บันทึกรายรับ</strong>
              <small>เพิ่มเงินเข้าบัญชี</small>
            </Link>
            <Link to="/transactions/new?type=expense">
              <span className="action-icon expense">
                <ArrowUpRight aria-hidden="true" />
              </span>
              <strong>บันทึกรายจ่าย</strong>
              <small>บันทึกเงินที่ใช้ไป</small>
            </Link>
            <Link to="/accounts">
              <span className="action-icon account">
                <Landmark aria-hidden="true" />
              </span>
              <strong>จัดการบัญชี</strong>
              <small>เพิ่มยอดตั้งต้น</small>
            </Link>
          </div>
        </section>

        <section className="content-card next-step-card">
          <span className="eyebrow">ขั้นตอนแนะนำ</span>
          <h2>{accountCount ? "พร้อมเริ่มบันทึกรายการ" : "เพิ่มบัญชีแรก"}</h2>
          <p>
            {accountCount
              ? "บัญชีของคุณพร้อมแล้ว ขั้นถัดไปเราจะเพิ่มรายรับ รายจ่าย และรายการโอน"
              : "เพิ่มเงินสดหรือบัญชีธนาคาร พร้อมยอดปัจจุบัน เพื่อให้ภาพรวมเริ่มทำงาน"}
          </p>
          <Link className="text-link" to="/accounts">
            {accountCount ? "ดูบัญชีทั้งหมด" : "เพิ่มบัญชีแรก"}
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </main>
  );
}
