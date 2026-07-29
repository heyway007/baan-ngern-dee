# Hide Financial Planning Design

## เป้าหมาย

ปิดฟีเจอร์แผนการเงินจากผู้ใช้ชั่วคราว เพราะสูตรเงินคงเหลือยังอยู่ระหว่างการออกแบบใหม่ โดยต้องเปิดฟีเจอร์กลับมาได้ง่ายและไม่ทำให้ข้อมูลเดิมสูญหาย

## แนวทาง

- เพิ่ม feature flag ฝั่งเว็บสำหรับ `financialPlanning`
- ค่าเริ่มต้นของ flag เป็น `false`
- เมนู `แผนการเงิน` จะไม่ปรากฏทั้ง sidebar และเมนูมือถือเมื่อ flag ปิด
- การเปิด `/planning` โดยตรงจะ redirect ไป `/overview`
- Component, client API, Worker routes, Supabase functions, migrations และข้อมูลแผนการเงินเดิมยังคงอยู่ครบ
- การเปิดคืนทำได้โดยเปลี่ยน feature flag กลางเพียงจุดเดียว

## ขอบเขตไฟล์

- ไฟล์ feature flag กลางรับผิดชอบสถานะเปิดหรือปิดฟีเจอร์
- App layout กรอง navigation item ตาม flag
- Router เลือกระหว่าง planning route กับ redirect ตาม flag
- Tests ยืนยันทั้งการซ่อนเมนูและการป้องกัน direct URL

## การทดสอบ

- Layout test ต้องไม่พบลิงก์ `แผนการเงิน`
- Router test ต้องยืนยันว่า `/planning` ไปยัง `/overview`
- Tests ของ component และ API แผนการเงินเดิมยังคงทำงาน เพื่อไม่ให้โค้ดที่พักไว้เสื่อมสภาพ
- รัน web tests, typecheck และ production build ก่อนส่งขึ้น production

