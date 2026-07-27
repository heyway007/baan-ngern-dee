# Monthly Recurring Items Design

## เป้าหมาย

เพิ่มโมดูล “รายการประจำ” สำหรับตั้งรายรับและรายจ่ายที่เกิดทุกเดือน เช่น เงินเดือน ค่าเช่า ค่าอินเทอร์เน็ต และค่าสมาชิก ระบบสร้างรายการรอยืนยันของเดือนปัจจุบันเมื่อผู้ใช้เปิดระบบ แต่ไม่ปรับยอดบัญชีจนกว่าผู้ใช้จะยืนยันรับหรือจ่ายเงินจริง

โมดูลต้องแสดงเงินคาดว่าจะเหลือหลังหักรายจ่ายประจำออกจากรายรับประจำ รองรับการแก้ยอดหรือวันที่รายเดือน การข้ามเฉพาะเดือน การพัก และการยกเลิกรายการ โดยต้องไม่สร้างหรือบันทึกธุรกรรมซ้ำ

## ขอบเขตการทำงาน

### รายการประจำ

ผู้ใช้สร้างแม่แบบรายเดือนโดยกำหนด:

- ชื่อรายการ
- ประเภท `income` หรือ `expense`
- จำนวนเงินเริ่มต้นที่มากกว่า 0
- สกุลเงิน
- บัญชีรับหรือจ่าย
- หมวดหมู่ที่ตรงกับประเภท
- วันที่ประจำของเดือนตั้งแต่ 1–31
- เดือนเริ่มต้น
- เดือนสิ้นสุดแบบไม่บังคับ
- สถานะ `active`, `paused` หรือ `cancelled`

แต่ละรายการเลือกบัญชีของตัวเองได้ จึงสามารถตั้งรายการทั้งหมดให้ใช้บัญชีเงินเดือน หรือแยกบัญชีตามวิธีรับและจ่ายจริงได้

### รายการประจำเดือน

ระบบสร้าง occurrence แยกสำหรับแต่ละแม่แบบและเดือน โดยมี:

- เดือนอ้างอิงในรูป `YYYY-MM`
- วันที่กำหนดของเดือนนั้น
- จำนวนเงินของเดือนนั้น
- สถานะ `pending`, `posted` หรือ `skipped`
- ธุรกรรมจริงที่เชื่อมโยง เมื่อสถานะเป็น `posted`
- version สำหรับ optimistic concurrency

ผู้ใช้แก้ยอดและวันที่ของ occurrence ที่ยัง `pending` ได้โดยไม่เปลี่ยนแม่แบบ การแก้แม่แบบจะอัปเดต occurrence ของเดือนปัจจุบันที่ยัง `pending` และใช้ค่าใหม่กับเดือนถัดไป หาก occurrence เดือนปัจจุบันเคยถูกแก้เฉพาะเดือน การบันทึกแม่แบบภายหลังจะแทนที่ค่าของ occurrence นั้น และ UI ต้องแจ้งผลนี้ก่อนยืนยันการแก้แม่แบบ

## กฎวันที่

- แต่ละแม่แบบกำหนดวันของเดือนเอง
- หากกำหนดวันที่ 29–31 แต่เดือนนั้นมีวันไม่ครบ ให้ใช้วันสุดท้ายของเดือน
- `startMonth` และ `endMonth` เก็บเป็นวันแรกของเดือนเพื่อเปรียบเทียบอย่างแน่นอน และขอบเขตทั้งสองเดือนเป็นแบบ inclusive
- การสร้าง occurrence ใช้ timezone ของ workspace
- ระบบสร้างเฉพาะเดือนปัจจุบันเมื่อเปิดระบบ ไม่สร้างล่วงหน้า 12 เดือน

## การสร้างรายการโดยไม่ใช้ Cron

ระหว่าง cloud boot เว็บโหลด snapshot ครั้งแรกเพื่อทราบ workspace และ timezone จากนั้นเรียก endpoint materialize สำหรับเดือนปัจจุบันหนึ่งครั้ง หาก endpoint สร้างรายการใหม่ เว็บจึง refresh snapshot เพื่อรับ read model ล่าสุดก่อนแสดง Overview การ refresh หรือเปิด `/recurring` ซ้ำสามารถเรียก materialize อีกครั้งได้อย่างปลอดภัย

การ materialize:

1. ปฏิเสธ period ที่ไม่ใช่เดือนปัจจุบันตาม timezone ของ workspace
2. อ่านแม่แบบสถานะ `active` ที่อยู่ในช่วงเดือนเริ่มต้นและสิ้นสุด
3. คำนวณวันที่จริงตามกฎวันสุดท้ายของเดือน
4. สร้าง occurrence ด้วยยอด บัญชี หมวดหมู่ และสกุลเงินจากแม่แบบ
5. ใช้ unique constraint `(template_id, period_month)` เพื่อให้เรียกซ้ำได้โดยไม่สร้างข้อมูลซ้ำ
6. คืนผลจำนวนรายการที่สร้างและรายการที่มีอยู่แล้ว

แนวทางนี้ทำงานบน Cloudflare Worker และ Supabase Free โดยไม่ต้องใช้ Cloudflare Cron รายการจะพร้อมเมื่อผู้ใช้เปิดระบบในเดือนนั้น

## การยืนยันและผลต่อยอดเงินจริง

Occurrence ที่ `pending` ยังไม่เป็นรายรับหรือรายจ่ายจริง และไม่เปลี่ยนยอดบัญชี

เมื่อผู้ใช้กด “ยืนยันรับเงิน” หรือ “ยืนยันจ่าย” ระบบทำงานใน database transaction เดียว:

1. ล็อก occurrence และตรวจ version
2. ตรวจว่ายังเป็น `pending`
3. ตรวจว่าบัญชีและหมวดหมู่ยังใช้งานได้ ประเภทหมวดตรงกัน และสกุลเงินตรงกับบัญชี
4. สร้าง transaction จริงด้วยยอดและวันที่ล่าสุดของ occurrence
5. ปรับยอดบัญชีตามกฎ transaction เดิม
6. เชื่อม `transaction_id` และเปลี่ยน occurrence เป็น `posted`
7. บันทึก audit event

คำขอยืนยันต้องมี `clientMutationId` และ database uniqueness เพื่อให้ retry หรือกดย้ำไม่หักเงินซ้ำ

## การข้าม พัก และยกเลิก

### ข้ามเดือนนี้

- เปลี่ยน occurrence ปัจจุบันจาก `pending` เป็น `skipped`
- ไม่สร้าง transaction และไม่เปลี่ยนยอดบัญชี
- แม่แบบยัง `active` และกลับมาสร้างรายการในเดือนถัดไป
- เก็บ occurrence ที่ข้ามไว้ในประวัติ

### พักรายการ

- เปลี่ยนแม่แบบเป็น `paused`
- ไม่สร้าง occurrence ในเดือนใหม่ระหว่างที่พัก
- occurrence เดือนปัจจุบันที่มีอยู่แล้วไม่ถูกลบ ผู้ใช้ยังยืนยันหรือข้ามได้
- เมื่อเปิดใช้อีกครั้งและเดือนปัจจุบันอยู่ในช่วงวันที่ของแม่แบบ การ materialize ครั้งถัดไปจะสร้าง occurrence เดือนปัจจุบันหากยังไม่มี โดยไม่ย้อนสร้างเดือนก่อนหน้า

### ยกเลิกรายการ

- ต้องมีหน้าต่างยืนยันก่อนดำเนินการ
- เปลี่ยนแม่แบบเป็น `cancelled` แบบถาวร
- ไม่สร้าง occurrence ในเดือนถัดไป
- occurrence เดือนปัจจุบันที่มีอยู่แล้วไม่ถูกลบ ผู้ใช้ยืนยันหรือข้ามเพื่อปิดรายการได้
- ประวัติ `posted` และ `skipped` ยังคงอยู่

## การคำนวณสรุปประจำเดือน

หน้า “รายการประจำ” คำนวณและแสดงแยกตามสกุลเงิน:

- รายรับประจำเดือน = ผลรวม occurrence ประเภท `income` ที่เป็น `pending` หรือ `posted`
- รายจ่ายประจำเดือน = ผลรวม occurrence ประเภท `expense` ที่เป็น `pending` หรือ `posted`
- เงินคาดว่าจะเหลือ = รายรับประจำเดือน − รายจ่ายประจำเดือน
- จำนวนรายการรอยืนยัน
- ยอดที่ยืนยันแล้ว และยอดที่ยังรอดำเนินการ แสดงแยกกัน

Occurrence ที่ `skipped` ไม่รวมในการคำนวณเงินคาดว่าจะเหลือ แต่ยังแสดงในประวัติเดือนนั้น

ตัวเลขนี้เป็นประมาณการของรายการประจำ ไม่ใช่ยอดคงเหลือรวมของทุกบัญชี และไม่แทนที่สรุปรายรับรายจ่ายจริงบน Overview

ห้ามรวมยอดต่างสกุลเงินหรือคำนวณอัตราแลกเปลี่ยน หาก workspace มี THB และ USD ให้แสดงรายรับ รายจ่าย และเงินคาดว่าจะเหลือเป็นคนละชุด

## หน้าจอ

### เมนูและเส้นทาง

- เพิ่มเมนู “รายการประจำ”
- เพิ่ม route `/recurring`
- หน้า Overview เพิ่มการ์ด “ภาระประจำเดือนนี้” ซึ่งแสดงรายจ่ายประจำที่ยังรอยืนยัน เงินคาดว่าจะเหลือ และลิงก์ไป `/recurring`

### หน้า `/recurring`

ประกอบด้วย:

1. การ์ดสรุปรายรับประจำ รายจ่ายประจำ เงินคาดว่าจะเหลือ และจำนวนรอยืนยัน
2. รายการ “รอรับ” และ “รอจ่าย” เรียงตามวันที่
3. การกระทำของ occurrence: แก้ยอด/วันที่, ยืนยัน, ข้ามเดือนนี้
4. ตัวเลือกเดือนสำหรับดูประวัติเดือนปัจจุบันและเดือนที่ผ่านมา โดยการเปิดเดือนเก่าเป็น read-only และไม่ materialize ย้อนหลัง
5. ประวัติรายการที่ `posted` และ `skipped` ของเดือนที่เลือก
6. ส่วนจัดการแม่แบบ: เพิ่ม, แก้ไข, พัก, เปิดใช้อีกครั้ง และยกเลิก

ทุก action ที่สร้าง transaction หรือเปลี่ยนสถานะต้องแสดง pending state ปิดปุ่มซ้ำ และแสดงข้อความภาษาไทยเมื่อไม่สำเร็จ

## โมเดลข้อมูล

### `recurring_templates`

- `id uuid primary key`
- `workspace_id uuid not null`
- `name text not null`
- `kind category_kind not null`
- `amount numeric(20,4) not null check (amount > 0)`
- `currency text not null`
- `account_id uuid not null`
- `category_id uuid not null`
- `day_of_month integer not null check (day_of_month between 1 and 31)`
- `start_month date not null`
- `end_month date null`
- `status recurring_template_status not null`
- `version integer not null default 1`
- `created_by uuid not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### `recurring_occurrences`

- `id uuid primary key`
- `workspace_id uuid not null`
- `template_id uuid not null`
- `kind category_kind not null`
- `period_month date not null`
- `scheduled_date date not null`
- `amount numeric(20,4) not null check (amount > 0)`
- `currency text not null`
- `account_id uuid not null`
- `category_id uuid not null`
- `status recurring_occurrence_status not null`
- `transaction_id uuid null`
- `version integer not null default 1`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

ข้อบังคับสำคัญ:

- unique `(template_id, period_month)`
- unique `transaction_id` เมื่อค่าไม่เป็น null
- `period_month` ต้องเป็นวันแรกของเดือน
- `posted` ต้องมี `transaction_id`
- `pending` และ `skipped` ต้องไม่มี `transaction_id`
- foreign keys และ RLS ต้องจำกัดข้อมูลตาม workspace membership

## API

- `POST /v1/recurring-periods/materialize` รับ `workspaceId` และ `period` รูป `YYYY-MM` แล้วสร้าง occurrence แบบ idempotent
- `GET /v1/recurring-periods/:period?workspaceId=:workspaceId` อ่าน occurrence ของเดือนปัจจุบันหรือเดือนที่ผ่านมาโดยไม่สร้างข้อมูล
- `POST /v1/recurring-templates` สร้างแม่แบบ
- `PATCH /v1/recurring-templates/:id` แก้ข้อมูลด้วย version
- `POST /v1/recurring-templates/:id/pause`
- `POST /v1/recurring-templates/:id/resume`
- `POST /v1/recurring-templates/:id/cancel`
- `PATCH /v1/recurring-occurrences/:id` แก้ยอดหรือวันที่ของ `pending`
- `POST /v1/recurring-occurrences/:id/skip`
- `POST /v1/recurring-occurrences/:id/post` ยืนยันและสร้าง transaction จริง

Finance snapshot เพิ่ม `recurringTemplates` และ `recurringOccurrences` เฉพาะเดือนปัจจุบันเพื่อให้หน้า Overview และหน้า `/recurring` ใช้ read model เดียวกัน ประวัติเดือนก่อนโหลดผ่าน endpoint รายเดือนเพื่อไม่ให้ snapshot โตไม่จำกัด

## การจัดการข้อผิดพลาด

- stale version คืน conflict โดยไม่เปลี่ยนข้อมูล
- occurrence ที่ไม่ใช่ `pending` ห้ามแก้ ข้าม หรือ post ซ้ำ
- บัญชีหรือหมวดหมู่ที่ปิดใช้งานต้องคืนข้อผิดพลาดที่ UI แปลเป็น “ต้องแก้ไขข้อมูลก่อนยืนยัน”
- สกุลเงินไม่ตรง ประเภทหมวดไม่ตรง ยอดไม่ถูกต้อง หรือวันที่อยู่นอกเดือนต้องถูกปฏิเสธ
- materialize ที่ถูกเรียกพร้อมกันต้องคืนข้อมูลชุดเดียวกันจาก unique constraint
- database function ต้องทำ rollback ทั้งหมดเมื่อสร้าง transaction หรือปรับยอดไม่สำเร็จ

## การทดสอบ

### Domain

- คำนวณวันที่ 29–31 ในเดือนสั้นและปีอธิกสุรทิน
- คำนวณรายรับ รายจ่าย และเงินคาดว่าจะเหลือด้วย decimal ที่แน่นอน
- ตัด `skipped` ออกจากประมาณการ

### Database และ Worker

- materialize สร้างหนึ่ง occurrence ต่อแม่แบบต่อเดือนและ retry ไม่ซ้ำ
- ไม่สร้างรายการก่อน `startMonth`, หลัง `endMonth`, ขณะพัก หรือหลังยกเลิก
- ผู้ใช้ต่าง workspace อ่านหรือเปลี่ยนข้อมูลไม่ได้
- post สร้าง transaction และปรับบัญชีครั้งเดียว
- post ซ้ำหรือ stale version ไม่หักเงินซ้ำ
- skip ไม่สร้าง transaction และเดือนถัดไปกลับมาสร้างได้
- pause, resume และ cancel รักษาประวัติเดิม
- snapshot ส่ง read model ใหม่ครบถ้วน

### Web

- เพิ่มและแก้แม่แบบด้วยจำนวนเงินแบบ string ไม่แปลงผ่าน JavaScript float
- materialize แล้ว refresh snapshot เมื่อเปิดระบบ
- แสดงสรุปและรายการรอยืนยันตามเดือน
- แก้ยอด/วันที่ ยืนยัน ข้าม พัก เปิดใหม่ และยกเลิก
- ปุ่มยืนยันถูกปิดระหว่างส่งคำขอ
- แสดงข้อผิดพลาดภาษาไทย
- หน้า Overview และ `/recurring` ใช้งานได้บน desktop และ mobile

### Verification

- full unit/integration/database tests
- TypeScript typecheck
- production build และ Wrangler dry-run
- visual QA ที่ desktop และ mobile

## เกณฑ์สำเร็จ

- ผู้ใช้ตั้งเงินเดือนและรายจ่ายประจำโดยเลือกบัญชีและวันที่แยกกันได้
- เมื่อเปิดระบบในเดือนใหม่ รายการรอยืนยันถูกสร้างครั้งเดียว
- ยอดบัญชีเปลี่ยนเฉพาะเมื่อกดยืนยัน และไม่มีการหักซ้ำ
- ผู้ใช้แก้ยอด/วันที่ ข้ามเดือน พัก เปิดใหม่ และยกเลิกได้ตามกฎ
- ระบบแสดงเงินคาดว่าจะเหลือจากรายรับประจำลบรายจ่ายประจำอย่างถูกต้อง
- ประวัติรายการที่ยืนยันหรือข้ามยังคงอยู่และแยกตาม workspace

## นอกขอบเขต

- Cloudflare Cron หรือการสร้างรายการขณะผู้ใช้ไม่เปิดระบบ
- การส่งอีเมล push notification หรือ LINE notification
- ความถี่รายสัปดาห์ รายปี หรือรอบกำหนดเอง
- การสร้างรายการล่วงหน้าหลายเดือน
- การผูกหรือหักเงินจริงจากธนาคารภายนอก
