# นำ Baan Ngern Dee ขึ้น Supabase และ Cloudflare Workers

ระบบนี้เป็น Cloud-only: Browser ใช้ Supabase เฉพาะ Email/Password Auth
แล้วส่ง access token ไปยัง Worker origin เดียวกัน Worker จึงอ่านและเขียน
PostgreSQL ผ่าน PostgREST/RPC ภายใต้ RLS ของผู้ใช้คนนั้น

ห้ามใช้ `service_role`, key ที่ขึ้นต้นด้วย `sb_secret_`, database password
หรือ connection string ใน Browser, Git หรือ Cloudflare public variables

## 1. เตรียมและตรวจ migration

จาก root ของ repository:

```powershell
npm install
npm test -- --run
npm run test:db
npm run typecheck
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
```

ตรวจว่า dry run แสดงเฉพาะ forward migrations ที่คาดไว้และไม่มีการลบข้อมูล
จากนั้นจึงใช้:

```powershell
npx supabase db push
npx supabase test db
```

สำหรับโมดูลรายการประจำ ต้องยืนยันว่า production ใช้ migration
ตามลำดับนี้ก่อน deploy Worker:

```text
202607270011_recurring_items.sql
202607270012_recurring_snapshot.sql
```

โมดูลคำเชิญผู้ใช้ต้องมี migration ต่อไปนี้ด้วย:

```text
202607270013_user_invitations.sql
```

Migration นี้สร้างตาราง audit/RLS และ RPC แบบ `service_role` สำหรับโทเคน
ใช้ครั้งเดียว ห้าม deploy Worker รุ่นคำเชิญก่อน migration นี้ขึ้น production

โมดูลรายการประจำสร้างรายการของเดือนปัจจุบันตอนผู้ใช้เปิดแอป จึงไม่ต้องเพิ่ม
Cloudflare Cron Trigger

ลำดับที่ปลอดภัยคือ tests → link/ตรวจ migration → `db push` → deploy Worker

ถ้าจะทดสอบ Supabase stack ในเครื่อง ต้องเปิด Docker Desktop ก่อน แล้วรัน:

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset` ใช้เฉพาะฐานข้อมูล Supabase ในเครื่องและล้างข้อมูล local ทั้งหมด
ห้ามใช้คำสั่ง reset กับ production project

## 2. ตั้ง Supabase Auth URL

ใน Supabase Dashboard → Authentication → URL Configuration ตั้ง:

```text
Site URL:
https://baan-ngern-dee.newforico-9ea.workers.dev

Redirect URLs:
https://baan-ngern-dee.newforico-9ea.workers.dev/
https://baan-ngern-dee.newforico-9ea.workers.dev/reset-password
http://127.0.0.1:8787/
http://127.0.0.1:8787/reset-password
http://127.0.0.1:5173/
http://127.0.0.1:5173/reset-password
```

เปิด Confirm Email ไว้ ระบบ Supabase mailer เริ่มต้นเหมาะกับการทดสอบและจำกัด
ประมาณ 2 อีเมลต่อชั่วโมง ก่อนเปิดให้ผู้ใช้ทั่วไปควรตั้ง Custom SMTP

ค่าที่ระบบต้องใช้:

- Project URL รูปแบบ `https://YOUR_PROJECT_REF.supabase.co`
- Browser-safe publishable key ที่ขึ้นต้นด้วย `sb_publishable_`

## 3. ทดสอบ Cloud runtime ในเครื่อง

คัดลอกและแก้ `.dev.vars`:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_YOUR_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SUPER_ADMIN_USER_ID=YOUR_SUPER_ADMIN_AUTH_USER_UUID
# ALLOWED_ORIGIN=http://127.0.0.1:5173
```

`ALLOWED_ORIGIN` ไม่บังคับเมื่อ SPA และ API ใช้ origin เดียวกัน ใส่เฉพาะตอน
ใช้ Vite หรือ client อื่นแบบ cross-origin เท่านั้น

หา `SUPER_ADMIN_USER_ID` ได้จาก Supabase Dashboard → Authentication →
Users → เปิดบัญชี Super Admin แล้วคัดลอก UUID ช่อง User UID ต้องใช้ UUID
ของบัญชี `newforico@gmail.com` ไม่ใช่อีเมล และต้องยืนยันอีเมลบัญชีนี้แล้ว

หา Service Role key ได้จาก Supabase Dashboard → Project Settings → API Keys
ใช้เฉพาะ key ฝั่ง server ที่มีสิทธิ์ `service_role` เท่านั้น ค่านี้ห้ามใส่ใน
`VITE_*`, Browser, Git, screenshot หรือส่งให้ผู้ใช้รายอื่น

ทดสอบแบบ Worker เสิร์ฟ SPA:

```powershell
npm run build
npm run dev:api
```

เปิด `http://127.0.0.1:8787` หรือใช้ Vite HMR อีก terminal:

```powershell
npm run dev:web
```

หน้าเว็บไม่อ่าน `VITE_API_URL` หรือ `VITE_SUPABASE_*`; public URL/key มาจาก
`GET /config` ขณะ runtime

Endpoint สำคัญ:

- `GET /config` public และคืนเฉพาะ Supabase URL/publishable key
- `GET /health` public
- `POST /v1/public/invitations/inspect` public แต่รับเฉพาะ one-time token
- `POST /v1/public/invitations/redeem` public และใช้ token ได้ครั้งเดียว
- `/v1/admin/*` ต้องมี token ของ Super Admin UID ที่กำหนดไว้
- `GET /v1/snapshot` ต้องมี `Authorization: Bearer <ACCESS_TOKEN>`
- ทุก `/v1/*` อื่นต้องมี token เช่นกัน

## 4. ตั้ง Cloudflare Variables and secrets

ใน Cloudflare Worker/Build settings → Variables and secrets เพิ่ม:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_YOUR_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SUPER_ADMIN_USER_ID=YOUR_SUPER_ADMIN_AUTH_USER_UUID
```

หรือใช้ Wrangler:

```powershell
npx wrangler login
npx wrangler secret put SUPABASE_URL -c wrangler.jsonc
npx wrangler secret put SUPABASE_ANON_KEY -c wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.jsonc
npx wrangler secret put SUPER_ADMIN_USER_ID -c wrangler.jsonc
```

ไม่ต้องตั้ง `ALLOWED_ORIGIN` บน production แบบ same-origin หากมีเว็บอื่น
เรียก API ข้าม origin จึงค่อยเพิ่มเป็นค่าของ origin นั้นโดยไม่มี slash ปิดท้าย

สำหรับ Cloudflare Builds:

- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

## 5. Deploy และตรวจ production

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
npm run deploy:worker
```

ตรวจ endpoint:

```powershell
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/config
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/v1/snapshot
```

ผลที่คาด: `/config` และ `/health` ตอบ 200, ส่วน `/v1/snapshot` ที่ไม่มี
token ตอบ 401

## Rollback และการกู้คืน

- Worker: เลือก version ก่อนหน้าใน Cloudflare Deployments แล้ว Rollback
- Database: หยุด deploy ใหม่และออก corrective forward migration
  ห้ามย้อนด้วยคำสั่งที่ลบตารางหรือข้อมูล
- Key/credential รั่ว: rotate ที่ Supabase แล้วตั้ง Cloudflare secret ใหม่
- CORS ผิด: แก้หรือลบ `ALLOWED_ORIGIN` แล้ว deploy ใหม่

## Acceptance ก่อนเปิดใช้จริง

- สมัคร, ยืนยันอีเมล, sign in/out และ reset password ได้
- Super Admin เห็นเมนูคำเชิญ แต่ผู้ใช้ทั่วไปไม่เห็นและเรียก admin API ได้ 403
- สร้างคำเชิญแล้วคัดลอกลิงก์ได้ โดยลิงก์เดิมไม่ปรากฏในประวัติ
- ผู้รับเปิดลิงก์ ตั้งรหัสผ่าน และเข้าสู่ระบบอัตโนมัติได้
- คำเชิญใช้ซ้ำไม่ได้ หมดอายุใน 24 ชั่วโมง และ revoke/replace ได้
- ผู้รับคำเชิญได้ private workspace ของตนเองและอ่านข้อมูลของผู้อื่นไม่ได้
- ผู้ใช้ใหม่เข้า onboarding และสร้าง workspace ได้
- บัญชี รายการ สัญญาผ่อน ชำระงวด และปิดยอดคงอยู่หลัง hard refresh
- request ไม่มี token ตอบ 401
- ผู้ใช้คนที่สองอ่าน snapshot ของคนแรกไม่ได้
- retry ใช้ `clientMutationId` เดิมและไม่สร้างรายการซ้ำ
- stale `expectedVersion` ตอบ conflict
- เงินต้นไม่ถูกนับเป็นรายจ่าย; ดอกเบี้ย/ค่าธรรมเนียมถูกนับครั้งเดียว
