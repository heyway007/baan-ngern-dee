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

  it("keeps recurring desktop month input and action at one exact height", () => {
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
      /@media \(min-width: 621px\)[\s\S]*?\.recurring-page \.page-actions \.month-selector input,\s*\.recurring-page \.page-actions > \.primary-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*3rem;[^}]*min-height:\s*3rem;/
    );
  });

  it("locks recurring mobile month input to the 44px action height", () => {
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
      /@media \(max-width: 620px\)[\s\S]*?\.recurring-page \.month-selector input\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*44px;[^}]*min-height:\s*44px;/
    );
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

  it("centers mobile page-heading icons independently of hidden labels", () => {
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
      /@media \(max-width: 620px\)[\s\S]*?\.page-heading \.primary-button,\s*\.page-heading \.secondary-button\s*\{[^}]*position:\s*relative;/
    );
    expect(css).toMatch(
      /\.page-heading \.primary-button svg,\s*\.page-heading \.secondary-button svg\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%,\s*-50%\);/
    );
  });

  it("gives the mobile recurring month selector its own flexible action row", () => {
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
      /@media \(max-width: 620px\)[\s\S]*?\.page-heading\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/
    );
    expect(css).toMatch(
      /\.recurring-page \.page-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px;[^}]*align-items:\s*end;/
    );
    expect(css).toMatch(
      /\.recurring-page \.month-selector\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0(?:px)?;/
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

  it("renders the LINE login action as a full-width accessible control", () => {
    document.body.innerHTML = `
      <section class="sign-in-panel">
        <div class="line-login-options">
          <a class="line-login-button">
            <span class="line-login-mark">LINE</span>
            <span>เข้าสู่ระบบด้วย LINE</span>
          </a>
          <div class="auth-divider">
            <span>หรือเข้าสู่ระบบด้วยอีเมล</span>
          </div>
        </div>
      </section>
    `;

    const action = getComputedStyle(
      document.querySelector(".line-login-button")!
    );
    expect(action.display).toBe("flex");
    expect(action.minHeight).toBe("48px");
    expect(action.backgroundColor).toBe("rgb(6, 199, 85)");
    expect(
      getComputedStyle(
        document.querySelector(".auth-divider")!
      ).display
    ).toBe("flex");
  });

  it("keeps the admin user search inside its card padding", () => {
    document.body.innerHTML = `
      <section class="content-card admin-users-toolbar">
        <label>ค้นหาชื่อ อีเมล หรือรหัสผู้ใช้</label>
        <div class="admin-users-search"><input /></div>
      </section>
    `;

    const toolbar = document.querySelector(
      ".admin-users-toolbar"
    )!;
    expect(getComputedStyle(toolbar).paddingLeft).toBe("1.2rem");
    expect(getComputedStyle(toolbar).paddingRight).toBe("1.2rem");
  });

  it("keeps the profile card inside a 390px container with accessible controls", () => {
    document.body.innerHTML = `
      <div style="width: 390px; overflow-x: auto">
        <main class="profile-page">
          <section class="content-card profile-card">
            <div class="profile-account-value">
              min.with.a.very.long.account.address@example.test
            </div>
            <div class="profile-form-actions">
              <input value="มิน" />
              <button>บันทึกชื่อ</button>
            </div>
          </section>
        </main>
      </div>
    `;

    const profilePage = document.querySelector(".profile-page")!;
    const profileCard = document.querySelector(".profile-card")!;
    const accountValue = document.querySelector(
      ".profile-account-value"
    )!;

    expect(getComputedStyle(profilePage).minWidth).toBe("0px");
    expect(getComputedStyle(profileCard).boxSizing).toBe("border-box");
    expect(getComputedStyle(profileCard).maxWidth).toBe("100%");
    expect(getComputedStyle(accountValue).overflowWrap).toBe("anywhere");

    for (const control of document.querySelectorAll(
      ".profile-page button, .profile-page input"
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
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.profile-avatar-actions,\s*\.profile-form-actions\s*\{[^}]*align-items:\s*stretch;[^}]*flex-direction:\s*column;/
    );
  });

  it("provides a visible keyboard-focus proxy for the profile avatar picker", () => {
    document.body.innerHTML = `
      <main class="profile-page">
        <input
          id="profile-avatar-file"
          class="profile-avatar-file"
          type="file"
        />
        <label
          class="secondary-button profile-avatar-picker"
          for="profile-avatar-file"
        >
          เลือกรูป
        </label>
      </main>
    `;

    const inputStyle = getComputedStyle(
      document.querySelector(".profile-avatar-file")!
    );
    expect(inputStyle.position).toBe("absolute");
    expect(["hidden", "clip"]).toContain(inputStyle.overflow);
    expect(inputStyle.pointerEvents).not.toBe("none");

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
      /\.profile-avatar-file:focus-visible \+ \.profile-avatar-picker\s*\{[^}]*outline:\s*3px solid/
    );
  });

  it("wraps long dynamic profile load and mutation errors", () => {
    document.body.innerHTML = `
      <main class="profile-page">
        <div class="profile-load-error">
          <span>unbroken-load-error-value</span>
        </div>
        <p class="profile-mutation-alert">
          unbroken-mutation-error-value
        </p>
      </main>
    `;

    for (const selector of [
      ".profile-load-error",
      ".profile-load-error > span",
      ".profile-mutation-alert"
    ]) {
      const style = getComputedStyle(document.querySelector(selector)!);
      expect(style.minWidth, selector).toBe("0px");
      expect(style.overflowWrap, selector).toBe("anywhere");
    }
  });
});
