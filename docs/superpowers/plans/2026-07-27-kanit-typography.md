# Kanit Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนตัวอักษรทั้งหมดในเว็บบ้านเงินดีให้ใช้ Kanit จาก Google Fonts โดยไม่เปลี่ยน typography metrics หรือ layout ที่กำหนดไว้เดิม

**Architecture:** งานนี้แก้เฉพาะ presentation layer ใน `apps/web/src/styles.css` โดยกำหนด Kanit เป็น global font และแทนที่ทุก explicit font override ด้วย fallback stack เดียวกัน เพิ่ม source-level regression test ที่อ่านไฟล์ CSS จริงเพื่อป้องกันการนำฟอนต์เดิมกลับมาในอนาคต

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

- [ ] **Step 1: Write the failing typography contract test**

สร้าง `apps/web/src/styles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("global typography", () => {
  it("loads the approved Kanit weights from Google Fonts", () => {
    expect(styles).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap");'
    );
  });

  it("uses only the Kanit fallback stack in explicit font-family rules", () => {
    const fontFamilies = [...styles.matchAll(/font-family:\s*([^;]+);/g)].map(
      ([, family]) => family.trim()
    );

    expect(fontFamilies.length).toBeGreaterThan(0);
    expect(new Set(fontFamilies)).toEqual(new Set(['"Kanit", sans-serif']));
    expect(styles).not.toContain("Manrope");
    expect(styles).not.toContain("IBM Plex Sans Thai");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails against the legacy fonts**

Run:

```powershell
npm test -- --run apps/web/src/styles.test.ts
```

Expected: FAIL เพราะ `styles.css` ยัง import IBM Plex Sans Thai และ Manrope และยังมี explicit font stacks ของฟอนต์เดิม

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

Expected: 1 test file และ 2 tests ผ่าน

- [ ] **Step 5: Confirm the source contains no legacy font references**

Run:

```powershell
rg -n "Manrope|IBM Plex Sans Thai" apps/web/src
rg -n "font-family:" apps/web/src/styles.css
```

Expected: คำสั่งแรกไม่พบผลลัพธ์ ส่วนคำสั่งที่สองแสดงเฉพาะ `font-family: "Kanit", sans-serif;`

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
