import { afterEach, describe, expect, it } from "vitest";
import "./styles.css";

describe("global typography", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders the global and explicit typography roles with Kanit", () => {
    document.body.innerHTML = `
      <div class="brand-mark">บ</div>
      <section class="story-copy"><h1>บ้านเงินดี</h1></section>
      <section class="onboarding-copy"><h1>เริ่มต้น</h1></section>
      <div class="balance-copy"><strong>100</strong></div>
      <div class="balance-orbit"><span>100</span></div>
      <div class="summary-card"><strong>100</strong></div>
      <div class="account-balance"><strong>100</strong></div>
      <label class="amount-input"><span>฿</span><input value="100" /></label>
      <span class="transaction-amount">100</span>
      <div class="financed-principal-callout"><strong>100</strong></div>
      <fieldset class="manual-schedule-row"><legend>งวด 1</legend></fieldset>
      <div class="schedule-totals"><strong>100</strong></div>
      <div class="contract-principal"><strong>100</strong></div>
      <div class="next-installment"><strong>100</strong></div>
      <div class="payment-allocation-preview"><strong>100</strong></div>
      <div class="payoff-heading"><p><strong>100</strong></p></div>
      <div class="payoff-summary"><strong>100</strong></div>
      <div class="invitation-link-panel"><code>ลิงก์คำเชิญ</code></div>
      <span class="invitation-status">พร้อมใช้</span>
      <div class="invitation-recipient"><strong>ผู้รับ</strong></div>
    `;

    const typographySelectors = [
      ":root",
      ".brand-mark",
      ".story-copy h1",
      ".onboarding-copy h1",
      ".balance-copy > strong",
      ".balance-orbit span",
      ".summary-card strong",
      ".account-balance strong",
      ".amount-input > span",
      ".amount-input > input",
      ".transaction-amount",
      ".financed-principal-callout strong",
      ".manual-schedule-row legend",
      ".schedule-totals strong",
      ".contract-principal strong",
      ".next-installment strong",
      ".payment-allocation-preview strong",
      ".payoff-heading p strong",
      ".payoff-summary strong",
      ".invitation-link-panel code",
      ".invitation-status",
      ".invitation-recipient strong"
    ];

    for (const selector of typographySelectors) {
      const element = document.querySelector(selector);

      expect(element, selector).not.toBeNull();
      expect(getComputedStyle(element!).fontFamily, selector).toBe(
        '"Kanit", sans-serif'
      );
    }
  });

  it("lays out invitation controls for readable links and statuses", () => {
    document.body.innerHTML = `
      <div class="invitation-admin-grid"></div>
      <div class="invitation-link-panel"><code>https://example.test/very-long-link</code></div>
      <span class="invitation-status ready">พร้อมใช้</span>
    `;

    expect(
      getComputedStyle(
        document.querySelector(".invitation-admin-grid")!
      ).display
    ).toBe("grid");
    expect(
      getComputedStyle(
        document.querySelector(".invitation-link-panel code")!
      ).whiteSpace
    ).toBe("pre-wrap");
    expect(
      getComputedStyle(
        document.querySelector(".invitation-status")!
      ).display
    ).toBe("inline-flex");
  });

  it("provides responsive user-management and Turnstile selectors", () => {
    document.body.innerHTML = `
      <div class="admin-users-page">
        <div class="admin-users-table"></div>
        <div class="admin-users-actions"><button>ทำรายการ</button></div>
      </div>
      <span class="user-status-active">ใช้งานอยู่</span>
      <div class="turnstile-slot"></div>
      <div class="danger-confirm-overlay">
        <div class="danger-confirm-card"></div>
      </div>
    `;

    expect(
      getComputedStyle(
        document.querySelector(".admin-users-table")!
      ).width
    ).toBe("100%");
    expect(
      getComputedStyle(
        document.querySelector(".turnstile-slot")!
      ).minHeight
    ).not.toBe("");
    expect(
      getComputedStyle(
        document.querySelector(".danger-confirm-overlay")!
      ).position
    ).toBe("fixed");

    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");
    expect(css).toContain("@media");
    expect(css).toContain("max-width: 760px");
    expect(css).toContain(".admin-users-row");
    expect(css).toContain("min-height: 44px");
  });

  it("aligns recurring month and action controls on the same baseline", () => {
    document.body.innerHTML = `
      <main class="recurring-page">
        <div class="page-actions">
          <label class="month-selector">
            <span>เดือนที่แสดง</span>
            <input type="month" />
          </label>
          <button class="primary-button compact">
            เพิ่มรายการประจำ
          </button>
        </div>
      </main>
    `;

    expect(
      getComputedStyle(
        document.querySelector(".page-actions")!
      ).alignItems
    ).toBe("flex-end");
  });
});
