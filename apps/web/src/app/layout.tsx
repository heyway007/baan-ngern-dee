import {
  CircleDollarSign,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Repeat2,
  Settings,
  ShieldCheck,
  Target,
  UserRoundPlus,
  UsersRound,
  WalletCards,
  X
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import type { CloudSession } from "../lib/cloud-auth";

type AppLayoutProps = Readonly<{
  session: CloudSession;
  canManageInvitations?: boolean;
  canManageUsers?: boolean;
  onSignOut(): void;
}>;

const navigation = [
  {
    to: "/overview",
    label: "ภาพรวม",
    mobileLabel: "ภาพรวม",
    icon: LayoutDashboard
  },
  {
    to: "/accounts",
    label: "บัญชี",
    mobileLabel: "บัญชี",
    icon: WalletCards
  },
  {
    to: "/transactions",
    label: "รายการ",
    mobileLabel: "รายการ",
    icon: ReceiptText
  },
  {
    to: "/recurring",
    label: "รายการประจำ",
    mobileLabel: "ประจำ",
    icon: Repeat2
  },
  {
    to: "/planning",
    label: "แผนการเงิน",
    mobileLabel: "แผน",
    icon: Target
  },
  {
    to: "/installments",
    label: "ผ่อนและหนี้",
    mobileLabel: "ผ่อน",
    icon: CreditCard
  }
] as const;

export function AppLayout({
  session,
  canManageInvitations = false,
  canManageUsers = false,
  onSignOut
}: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-head">
          <NavLink className="brand-lockup" to="/overview">
            <span className="brand-mark" aria-hidden="true">฿</span>
            <span>บ้านเงินดี</span>
          </NavLink>
          <button
            type="button"
            className="icon-button close-menu"
            aria-label="ปิดเมนู"
            onClick={() => setMenuOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="local-status">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>
            <strong>Cloud connected</strong>
            ข้อมูลซิงก์ผ่าน Supabase
          </span>
        </div>

        <nav className="primary-nav" aria-label="เมนูหลัก">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => isActive ? "active" : ""}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          {canManageInvitations ? (
            <NavLink
              to="/admin/invitations"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => isActive ? "active" : ""}
            >
              <UserRoundPlus size={20} aria-hidden="true" />
              <span>คำเชิญผู้ใช้</span>
            </NavLink>
          ) : null}
          {canManageUsers ? (
            <NavLink
              to="/admin/users"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                isActive ? "active" : ""
              }
            >
              <UsersRound size={20} aria-hidden="true" />
              <span>จัดการผู้ใช้</span>
            </NavLink>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-row">
            <span className="avatar" aria-hidden="true">
              {session.displayName.slice(0, 1)}
            </span>
            <span>
              <strong>{session.displayName}</strong>
              <small>เจ้าของพื้นที่</small>
            </span>
          </div>
          <button type="button" className="ghost-button" onClick={onSignOut}>
            <LogOut size={18} aria-hidden="true" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          className="menu-backdrop"
          aria-label="ปิดเมนู"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="mobile-header">
          <button
            type="button"
            className="icon-button"
            aria-label="เปิดเมนู"
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">฿</span>
            <span>บ้านเงินดี</span>
          </div>
          <button type="button" className="icon-button" aria-label="ตั้งค่า">
            <Settings aria-hidden="true" />
          </button>
        </header>

        <Outlet />

        <nav className="bottom-nav" aria-label="เมนูมือถือ">
          {navigation.map(({ to, mobileLabel, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => isActive ? "active" : ""}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{mobileLabel}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function ComingSoonPage({
  title,
  description
}: Readonly<{ title: string; description: string }>) {
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">กำลังพัฒนา</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <section className="empty-state large">
        <CircleDollarSign size={42} aria-hidden="true" />
        <h2>เตรียมพื้นที่ไว้ให้แล้ว</h2>
        <p>โมดูลนี้จะต่อยอดจากบัญชีที่คุณเพิ่มไว้ และซิงก์ข้อมูลผ่านระบบคลาวด์</p>
      </section>
    </main>
  );
}
