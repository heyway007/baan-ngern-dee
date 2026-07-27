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
      ".payoff-summary strong"
    ];

    for (const selector of typographySelectors) {
      const element = document.querySelector(selector);

      expect(element, selector).not.toBeNull();
      expect(getComputedStyle(element!).fontFamily, selector).toBe(
        '"Kanit", sans-serif'
      );
    }
  });
});
