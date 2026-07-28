# User Management and Instant Signup Rollout

เอกสารนี้เป็นขั้นตอนสำหรับผู้ดูแลระบบในการนำระบบสมัครทันที, Cloudflare Turnstile และหน้า Super Admin จัดการผู้ใช้ขึ้น production อย่างควบคุมความเสี่ยง

> คำเตือน: เอกสารและโค้ดชุดนี้ไม่ได้อนุญาตให้รันคำสั่ง production โดยอัตโนมัติ ต้องได้รับอนุมัติจากเจ้าของระบบอีกครั้งก่อนแก้ Supabase, Cloudflare, deploy หรือแก้บัญชีผู้ใช้จริง

## ค่าที่ต้องเตรียม

- Supabase project URL และ browser-safe publishable/anon key
- Supabase Service Role key ซึ่งต้องอยู่ฝั่ง Worker เท่านั้น
- UUID ของ Super Admin สำหรับ `SUPER_ADMIN_USER_ID`
- production hostname ของบ้านเงินดี
- Turnstile production site key (public) สำหรับ `TURNSTILE_SITE_KEY`
- Turnstile secret key สำหรับ Supabase Authentication CAPTCHA settings เท่านั้น ห้ามใส่ใน repository, web bundle หรือ Worker response

## ลำดับ rollout

### 1. สำรองข้อมูลและบันทึกจุดย้อนกลับ

1. สร้างหรือยืนยัน Supabase database backup ที่กู้คืนได้
2. บันทึก Cloudflare Worker deployment version ที่กำลังให้บริการ
3. Export ค่า Supabase Auth settings ปัจจุบันหรือเก็บภาพหน้าจอ โดยเฉพาะ Confirm Email และ CAPTCHA
4. ห้ามดำเนินการต่อหากยังไม่มี backup หรือไม่ทราบ deployment version เดิม

### 2. ตรวจ migration ก่อนเปลี่ยนฐานข้อมูล

จาก root ของ repository ให้เชื่อม Supabase project ที่ถูกต้อง แล้วรัน:

```powershell
npx supabase migration list
```

ตรวจให้แน่ใจว่า remote ยังไม่มี migration ต่อไปนี้ก่อน apply:

- `202607270013_user_invitations.sql`
- `202607280014_user_management.sql`

ถ้าสถานะ local/remote ไม่ตรงกับที่คาด ให้หยุดและตรวจ project ref ก่อน ห้าม repair หรือ push โดยเดา

### 3. Apply migration แบบเรียงลำดับ

หลังได้รับอนุมัติ production โดยเฉพาะ ให้รัน:

```powershell
npx supabase db push --include-all
npx supabase migration list
```

ผลหลัง push ต้องแสดง migration 013 และ 014 ใน remote ตามลำดับ ตรวจว่าไม่มี migration อื่นที่ไม่เกี่ยวข้องถูก apply

Migration 014 เป็น additive: เพิ่ม audit/RPC สำหรับจัดการผู้ใช้และปรับ invitation foreign key ให้เก็บประวัติหลังลบ Auth user

### 4. สร้าง Turnstile widget

1. ใน Cloudflare Turnstile สร้าง widget สำหรับ production hostname จริง
2. เพิ่ม hostname ที่ให้บริการเว็บเท่านั้น
3. คัดลอก site key (public) และ secret key แยกกัน
4. อย่าใช้ test key `1x00000000000000000000AA` บน production

### 5. เปิด Turnstile ใน Supabase Auth

ใน Supabase Dashboard > Authentication > CAPTCHA:

1. เลือก Cloudflare Turnstile
2. ใส่ Turnstile secret key
3. เปิด CAPTCHA protection
4. ห้ามนำ secret key นี้ไปใส่ Cloudflare public config หรือ commit ลง Git

### 6. ตั้งค่า Cloudflare Worker

ใน Worker production Variables and Secrets ให้ยืนยันค่าต่อไปนี้:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPER_ADMIN_USER_ID
TURNSTILE_SITE_KEY
ALLOWED_ORIGIN
```

`TURNSTILE_SITE_KEY` ใช้ site key แบบ public ของ production widget ส่วน `ALLOWED_ORIGIN` ใช้ origin เต็มของเว็บ เช่น `https://baan-ngern-dee.example.com` และไม่ควรใช้ `*` บน production

### 7. Build, deploy และ smoke test

หลังได้รับอนุมัติ deploy ให้รัน:

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
npm run deploy:worker
```

ตรวจ production ตามลำดับ:

1. `GET /health` ตอบ `200` และ `{ "ok": true }`
2. `GET /config` ตอบเฉพาะ Supabase URL, publishable key และ Turnstile site key ห้ามมี Service Role key
3. สมัครด้วยรหัสผ่านไม่ตรงกันต้องถูกบล็อกก่อนเรียก Supabase
4. สมัครผ่าน Turnstile แล้วต้องได้ session และเข้า onboarding/overview ทันที
5. login และ password reset ต้องทำงาน
6. Super Admin เปิด `/admin/users` และเห็นรายการผู้ใช้
7. ผู้ใช้ทั่วไปเข้า `/admin/users` ไม่ได้
8. ทดสอบ confirm บัญชีเก่าที่ยังไม่ยืนยัน, suspend, resume และ reset กับบัญชีทดสอบ
9. ทดสอบว่าผู้ใช้ที่มี shared/family data ถูกบล็อกการลบ
10. ทดสอบลบบัญชีส่วนตัวที่สร้างไว้สำหรับ smoke test เท่านั้น

### 8. ปิด Confirm Email เป็นขั้นตอนสุดท้าย

ทำขั้นตอนนี้หลัง deploy และ smoke test instant signup ผ่านทั้งหมดแล้วเท่านั้น:

1. Supabase Dashboard > Authentication > Providers > Email
2. ปิด Confirm Email
3. สมัครบัญชีทดสอบใหม่
4. ยืนยันว่า Supabase คืน session ทันทีและไม่ส่งหน้า “ตรวจอีเมล”

หากสมัครแล้วไม่มี session ให้เปิด Confirm Email กลับทันทีและ rollback Worker version

### 9. กู้บัญชีเพื่อนที่เข้าไม่ได้

เปิด `/admin/users` ด้วย Super Admin:

- ถ้าสถานะเป็น “ยังไม่ยืนยัน” ให้กด “ยืนยันบัญชี”
- ถ้ายืนยันแล้วแต่ไม่ทราบรหัสผ่าน ให้กด “ส่งรีเซ็ตรหัสผ่าน”
- ถ้าสถานะเป็น “ระงับ” ให้ตรวจ audit/สาเหตุแล้วกด “เปิดใช้งาน”

ห้ามแก้หรือลบบัญชี production ของเพื่อนก่อนเจ้าของระบบอนุมัติและยืนยันอีเมลเป้าหมาย

## Rollback

1. เปิด Confirm Email กลับใน Supabase
2. ปิด CAPTCHA ชั่วคราวเฉพาะเมื่อ Turnstile ทำให้ signup ใช้งานไม่ได้และมีการอนุมัติ
3. Rollback Cloudflare ไป deployment version ที่บันทึกในขั้นตอนแรก
4. เก็บ migration 014 ไว้ เพราะเป็น additive และโค้ดเก่าสามารถไม่เรียก RPC ใหม่ได้
5. ห้ามพยายามย้อนกลับ user deletion; การลบถาวรไม่สามารถกู้คืนด้วย rollback แอป ต้องใช้ database backup และกระบวนการกู้คืนที่ได้รับอนุมัติ

## เกณฑ์หยุดทันที

- migration list ชี้ไปคนละ Supabase project
- `/config` เปิดเผย Service Role key หรือ secret ใด ๆ
- signup สำเร็จแต่ไม่มี session
- ผู้ใช้ทั่วไปเรียก `/v1/admin/users*` ได้
- บัญชี Super Admin สามารถ suspend/delete ตัวเองได้
- shared/family user ถูกลบได้โดยไม่เกิด `USER_SHARED_DATA_CONFLICT`
