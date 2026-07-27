# Baan Ngern Dee

ระบบจัดการรายรับ รายจ่าย บัญชี และสัญญาผ่อนชำระแบบ Cloud-only
พัฒนาด้วย React/Vite, Cloudflare Workers และ Supabase Auth/PostgreSQL

ข้อมูลการเงินทั้งหมดอ่านและเขียนผ่าน Worker API พร้อม Supabase JWT และ RLS
หน้าเว็บไม่ใช้ Local Storage เป็นฐานข้อมูล และไม่ต้องมี `VITE_SUPABASE_*`
เพราะโหลด public runtime config จาก `/config`

## พัฒนาในเครื่อง

ติดตั้งและ build เว็บก่อน:

```powershell
npm install
npm run build
Copy-Item .dev.vars.example .dev.vars
npm run dev:api
```

เปิด `http://127.0.0.1:8787` เพื่อทดสอบ SPA และ Worker บน origin เดียวกัน
ถ้าต้องการ Vite HMR ให้เปิดอีก terminal ด้วย `npm run dev:web` แล้วเข้า
`http://127.0.0.1:5173`; Vite จะ proxy `/config`, `/health` และ `/v1`
ไปยัง Worker ที่พอร์ต 8787

## ตรวจสอบโครงการ

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

คู่มือเชื่อม Supabase, ตั้ง Auth URL, secrets และ deploy Cloudflare อยู่ที่
[`docs/runbooks/deploy-cloudflare-supabase.md`](docs/runbooks/deploy-cloudflare-supabase.md)
