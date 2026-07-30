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

  it("keeps every mobile page-heading action exactly 44 pixels square", () => {
    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");

    expect(css).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.page-heading \.primary-button,\s*\.page-heading \.secondary-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*flex:\s*0 0 44px;/
    );
  });

  it("keeps every monthly transaction month control at the same exact height", () => {
    document.body.innerHTML = `
      <div class="monthly-transaction-month-controls">
        <button class="icon-button">ก่อนหน้า</button>
        <label class="monthly-transaction-month-picker">
          <input type="month" />
        </label>
        <button class="icon-button">ถัดไป</button>
      </div>
    `;

    const controls = [
      document.querySelector(
        ".monthly-transaction-month-controls .icon-button"
      )!,
      document.querySelector(".monthly-transaction-month-picker")!,
      document.querySelector(".monthly-transaction-month-picker input")!
    ];

    for (const control of controls) {
      const style = getComputedStyle(control);

      expect(style.boxSizing).toBe("border-box");
      expect(style.height).toBe("2.75rem");
      expect(style.minHeight).toBe("2.75rem");
    }
  });

  it("provides responsive planning layouts and accessible control heights", () => {
    document.body.innerHTML = `
      <main class="planning-page">
        <div class="budget-summary-grid"></div>
        <table class="budget-category-table"></table>
        <div class="savings-goal-grid"></div>
        <div class="goal-progress"></div>
        <div class="planning-dialog">
          <button>บันทึก</button>
          <input />
          <select></select>
        </div>
      </main>
    `;

    expect(
      getComputedStyle(document.querySelector(".budget-summary-grid")!).display
    ).toBe("grid");
    expect(
      getComputedStyle(document.querySelector(".savings-goal-grid")!).display
    ).toBe("grid");
    const planningStyle = getComputedStyle(
      document.querySelector(".planning-page")!
    );
    expect(planningStyle.maxWidth).toBe("82rem");
    expect(planningStyle.marginInline).toBe("auto");

    for (const control of document.querySelectorAll(
      ".planning-dialog button, .planning-dialog input, .planning-dialog select"
    )) {
      expect(getComputedStyle(control).minHeight).toBe("44px");
    }

    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");
    expect(css).toContain(".budget-category-card");
    expect(css).toContain("max-width: 760px");
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.planning-page\s*\{[^}]*max-width:\s*100%/
    );
  });

  it("keeps planning card content away from card borders", () => {
    document.body.innerHTML = `
      <main class="planning-page">
        <section class="content-card budget-create-card"></section>
        <section class="content-card budget-table-card">
          <p class="empty-copy">ยังไม่ได้ตั้งงบ</p>
        </section>
        <section class="content-card unbudgeted-card">
          <div class="section-heading"></div>
          <ul class="unbudgeted-list"><li>อาหาร</li></ul>
        </section>
        <section class="content-card planning-dialog"></section>
        <article class="content-card savings-goal-card"></article>
        <section class="content-card planning-empty"></section>
      </main>
    `;

    for (const selector of [
      ".budget-create-card",
      ".planning-dialog",
      ".savings-goal-card",
      ".planning-empty",
      ".budget-table-card > .empty-copy",
      ".unbudgeted-card > .section-heading",
      ".unbudgeted-list li"
    ]) {
      expect(
        getComputedStyle(document.querySelector(selector)!).paddingLeft,
        selector
      ).toBe("24px");
      expect(
        getComputedStyle(document.querySelector(selector)!).paddingRight,
        selector
      ).toBe("24px");
    }
  });

  it("centers responsive LINE entry cards with accessible actions", () => {
    document.body.innerHTML = `
      <main class="line-entry-shell">
        <section class="line-entry-card">
          <div class="line-entry-actions"><button>ลองอีกครั้ง</button></div>
        </section>
      </main>
    `;

    expect(
      getComputedStyle(document.querySelector(".line-entry-shell")!).display
    ).toBe("grid");
    expect(
      getComputedStyle(document.querySelector(".line-entry-card")!).maxWidth
    ).toBe("30rem");
    expect(
      getComputedStyle(document.querySelector(".line-entry-actions > button")!)
        .minHeight
    ).toBe("44px");
  });
});
