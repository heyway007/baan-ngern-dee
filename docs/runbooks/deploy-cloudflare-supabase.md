# นำ Baan Ngern Dee ขึ้น Supabase และ Cloudflare Workers

คู่มือนี้เตรียมระบบจาก Local ไป Cloud โดยไม่ย้ายข้อมูล Local Storage
อัตโนมัติ และไม่ใช้ Supabase `service_role` key ใน Worker

## สิ่งที่เตรียมไว้แล้ว

- Supabase migrations สำหรับ workspace, บัญชี, รายการเงิน, โอนเงิน
  และสัญญาผ่อน
- RLS แบบสมาชิก workspace และ RPC แบบ transaction สำหรับการลงบัญชี
- Worker ตรวจ Supabase JWT แล้วส่ง JWT เดิมเข้า PostgREST/RPC
- CORS จำกัดไว้ที่ origin ของเว็บที่กำหนด
- ตัวอย่าง environment ที่ไม่มี secret จริง
- dry-run build และชุดทดสอบ Local PostgreSQL

## 1. สร้างโปรเจกต์ Supabase

ติดตั้ง Supabase CLI และเข้าสู่ระบบ จาก root ของ repository:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase test db
```

ตรวจใน Supabase Dashboard ว่า Email Auth เปิดใช้งานตามต้องการ และจดค่า:

- Project URL
- anon/publishable key

ห้ามนำ `service_role` key ไปไว้ในเว็บหรือ commit ลง Git

## 2. ทดสอบ Worker กับ Supabase จากเครื่อง

คัดลอกไฟล์ตัวอย่าง:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

แก้ `.dev.vars`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
ALLOWED_ORIGIN=http://127.0.0.1:5173
```

จากนั้นรัน:

```powershell
npm run dev:api
```

ตรวจ health endpoint ที่ `http://127.0.0.1:8787/health`

## 3. ตั้งค่า Cloudflare secrets

เข้าสู่ระบบ Cloudflare แล้วตั้งค่าทั้งสามค่า:

```powershell
npx wrangler login
npx wrangler secret put SUPABASE_URL -c wrangler.jsonc
npx wrangler secret put SUPABASE_ANON_KEY -c wrangler.jsonc
npx wrangler secret put ALLOWED_ORIGIN -c wrangler.jsonc
```

`ALLOWED_ORIGIN` ต้องเป็น origin ของเว็บจริง เช่น
`https://baan-ngern-dee.pages.dev` โดยไม่มี slash ปิดท้าย

## 4. ตรวจและ deploy

ให้ deploy ฐานข้อมูลก่อน Worker เสมอ:

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
npm run deploy:worker
```

หากเชื่อม GitHub ผ่าน Cloudflare Builds ให้ตั้งค่า:

- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

ไฟล์ `wrangler.jsonc` อยู่ที่ root ของ repository เพื่อรองรับคำสั่ง deploy
ของ Cloudflare CI โดยตรง ส่วน source ของ Worker ยังอยู่ใน `workers/api`

บันทึก URL `workers.dev` ที่ Wrangler แสดง แล้วตรวจ:

```powershell
curl.exe https://YOUR-WORKER.workers.dev/health
```

คำตอบที่ถูกต้อง:

```json
{"ok":true,"service":"systems-credit-api"}
```

Endpoint ภายใต้ `/v1/*` ต้องส่ง
`Authorization: Bearer <SUPABASE_ACCESS_TOKEN>` เสมอ

## 5. เตรียมเว็บสำหรับรอบเชื่อม Cloud

คัดลอก `apps/web/.env.example` เป็น `apps/web/.env.local` แล้วกำหนด
Worker URL, Supabase URL และ anon key จริง

ขณะนี้หน้าเว็บยังใช้ Local Finance API ตามข้อตกลงเดิม การใส่ environment
เพียงอย่างเดียวจะยังไม่ย้ายหรือ sync ข้อมูล Local Storage ต้องทำขั้นเชื่อม
Supabase Auth/Remote Finance API และขั้นนำเข้าข้อมูลเป็นงานถัดไปโดยตั้งใจ

## Rollback และการกู้คืน

- Worker: ใช้ Cloudflare Deployments เลือก version ก่อนหน้าและ Rollback
- Database: migrations ชุดนี้เป็นแบบเดินหน้า หาก production migration มีปัญหา
  ให้หยุด Worker version ใหม่ก่อน แล้วออก corrective migration; ไม่ควรลบตาราง
  ที่มีข้อมูลด้วยคำสั่งย้อนกลับแบบทำลายข้อมูล
- Secret รั่ว: rotate anon key/credentials ที่ Supabase และตั้ง Worker secret ใหม่
- CORS ผิด: แก้ `ALLOWED_ORIGIN` แล้ว deploy Worker ใหม่

## Preflight ก่อนเปิดใช้จริง

- `supabase test db` ผ่าน
- tests, typecheck และ build ผ่านทั้งหมด
- Worker health ตอบ 200
- request ไม่มี token ตอบ 401
- สมาชิก workspace อ่านข้อมูลของตนเองได้
- ผู้ใช้คนอื่นอ่านสัญญา/ตารางผ่อนไม่ได้
- retry ด้วย `clientMutationId` เดิมไม่สร้างรายการซ้ำ
- stale `expectedVersion` ตอบ conflict
- principal ไม่ถูกนับเป็นรายจ่าย ดอกเบี้ย/ค่าธรรมเนียมถูกนับครั้งเดียว
