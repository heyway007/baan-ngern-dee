# Kanit Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนตัวอักษรทั้งหมดในเว็บบ้านเงินดีให้ใช้ Kanit จาก Google Fonts โดยไม่เปลี่ยน typography metrics หรือ layout ที่กำหนดไว้เดิม

**Architecture:** งานนี้แก้เฉพาะ presentation layer ใน `apps/web/src/styles.css` โดยกำหนด Kanit เป็น global font และแทนที่ทุก explicit font override ด้วย fallback stack เดียวกัน เพิ่ม DOM regression test ที่โหลด stylesheet จริงและตรวจ computed style ของ typography roles เพื่อป้องกันไม่ให้ส่วนใดกลับไปแสดงฟอนต์เดิม

**Tech Stack:** CSS, Google Fonts, Vitest, TypeScript, Vite, React

## Global Constraints

- โหลด Kanit จาก Google Fonts เฉพาะน้ำหนัก 300, 400, 500, 600 และ 700
- ใช้ fallback stack เป็น `"Kanit", sans-serif`
- ลบการอ้างอิง `Manrope` และ `IBM Plex Sans Thai` จาก `apps/web/src/styles.css`
- ห้ามเปลี่ยน `font-size`, `font-weight`, `line-height`, letter spacing, สี, spacing หรือ layout
- ห้ามแก้ React components, API, Worker, Supabase schema, authentication หรือ business logic
- ต้องตรวจทั้ง desktop และ mobile โดยเน้นข้อความไทย ปุ่ม ฟอร์ม เมนู ตัวเลข ยอดเงิน ตาราง และข้อความล้น

---

### Task 1: Apply and verify the global Kanit typography

**Files:**
- Create: `apps/web/src/styles.test.ts`
- Modify: `apps/web/src/styles.css:1-4`
- Modify: `apps/web/src/styles.css` ทุก declaration ของ `font-family`
- Test: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: ไฟล์ CSS หลักที่ import โดย `apps/web/src/main.tsx`
- Produces: global font contract ซึ่งกำหนดให้ทุก explicit `font-family` ใน `styles.css` เท่ากับ `"Kanit", sans-serif`

- [ ] **Step 1: Write the failing computed-style typography test**

สร้าง `apps/web/src/styles.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails against the legacy fonts**

Run:

```powershell
npm test -- --run apps/web/src/styles.test.ts
```

Expected: FAIL ที่ selector `:root` หรือ typography role แรก เพราะ computed `font-family` ยังเป็น IBM Plex Sans Thai หรือ Manrope

- [ ] **Step 3: Replace the Google Fonts import and explicit font stacks**

แก้บรรทัด import แรกใน `apps/web/src/styles.css` เป็น:

```css
@import url("https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap");
```

เปลี่ยนทุก declaration ต่อไปนี้:

```css
font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
font-family: Manrope, sans-serif;
font-family: Manrope, "IBM Plex Sans Thai", sans-serif;
```

ให้เป็น:

```css
font-family: "Kanit", sans-serif;
```

ห้ามแก้ property อื่นใน selector เดียวกัน

- [ ] **Step 4: Run the focused typography test**

Run:

```powershell
npm test -- --run apps/web/src/styles.test.ts
```

Expected: 1 test file และ 1 test ผ่าน โดยทุก selector มี computed `font-family` เท่ากับ `"Kanit", sans-serif`

- [ ] **Step 5: Confirm the source contains no legacy font references**

Run:

```powershell
rg -n "Manrope|IBM Plex Sans Thai" apps/web/src
rg -n "family=Kanit:wght@300;400;500;600;700" apps/web/src/styles.css
rg -n "font-family:" apps/web/src/styles.css
```

Expected: คำสั่งแรกไม่พบผลลัพธ์ คำสั่งที่สองพบ Google Fonts import หนึ่งจุด และคำสั่งสุดท้ายแสดงเฉพาะ `font-family: "Kanit", sans-serif;`

- [ ] **Step 6: Run the full automated verification**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
```

Expected: ชุดทดสอบทั้งหมดผ่าน, TypeScript ไม่มี error และ Vite/Worker production build สำเร็จ

- [ ] **Step 7: Perform desktop and mobile visual verification**

เปิดเว็บ local และตรวจอย่างน้อยหน้า sign-in/onboarding, overview, transactions และ installments ที่ viewport:

- Desktop: 1440 × 900
- Mobile: 390 × 844

ยืนยันจาก computed style ว่าข้อความ หัวข้อ ปุ่ม ช่องกรอก เมนู และตัวเลขใช้ `Kanit` และตรวจว่าไม่มีข้อความล้น การตัดบรรทัดผิดปกติ หรือองค์ประกอบซ้อนกัน ห้ามแก้ layout ในงานนี้; หากพบ regression ให้บันทึกตำแหน่งและแก้เฉพาะ typography rule ที่เป็นสาเหตุ

- [ ] **Step 8: Commit the tested implementation**

```powershell
git add -- apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "style: use Kanit across the web app"
```
