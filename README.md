# Baan Ngern Dee

ระบบจัดการรายรับ รายจ่าย บัญชี และสัญญาผ่อนชำระแบบ Local-first
พัฒนาด้วย React/Vite, Cloudflare Workers และ Supabase PostgreSQL

## พัฒนาในเครื่อง

```powershell
npm install
npm run dev:web
```

เว็บ Local เปิดที่ `http://127.0.0.1:5173` และเก็บข้อมูลใน Local Storage

## ตรวจสอบโครงการ

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

ขั้นตอนเชื่อม Supabase และนำ Worker ขึ้น Cloudflare อยู่ที่
[`docs/runbooks/deploy-cloudflare-supabase.md`](docs/runbooks/deploy-cloudflare-supabase.md)
