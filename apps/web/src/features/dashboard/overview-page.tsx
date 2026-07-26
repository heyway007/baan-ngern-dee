import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Plus,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { Link } from "react-router-dom";

import type { LocalFinanceSnapshot } from "../../lib/local-finance-api";
import type { LocalSession } from "../../lib/local-session";

type OverviewPageProps = Readonly<{
  session: LocalSession;
  snapshot: LocalFinanceSnapshot;
}>;

function addExactMoney(values: string[]): string {
  let satang = 0n;
  for (const value of values) {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole = "0", fraction = ""] = unsigned.split(".");
    const normalized = `${whole}${fraction.padEnd(2, "0").slice(0, 2)}`;
    const amount = BigInt(normalized || "0");
    satang += negative ? -amount : amount;
  }
  const negative = satang < 0n;
  const absolute = negative ? -satang : satang;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatMoney(amount: string, currency = "THB") {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = "0", fraction = "00"] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "THB" ? "฿" : `${currency} `;
  return `${negative ? "−" : ""}${symbol}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

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

      <div className="dashboard-grid">
        <section className="content-card quick-actions">
          <div className="section-title">
            <div>
              <span className="eyebrow">ทางลัด</span>
              <h2>เริ่มบันทึกเงินของคุณ</h2>
            </div>
          </div>
          <div className="quick-action-grid">
            <button type="button" disabled>
              <span className="action-icon income">
                <ArrowDownLeft aria-hidden="true" />
              </span>
              <strong>บันทึกรายรับ</strong>
              <small>เปิดในขั้นถัดไป</small>
            </button>
            <button type="button" disabled>
              <span className="action-icon expense">
                <ArrowUpRight aria-hidden="true" />
              </span>
              <strong>บันทึกรายจ่าย</strong>
              <small>เปิดในขั้นถัดไป</small>
            </button>
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
