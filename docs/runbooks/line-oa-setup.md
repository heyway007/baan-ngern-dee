# ตั้งค่า LINE OA และ LINE Login สำหรับ บ้านเงินดี

คู่มือนี้สำหรับเจ้าของระบบที่มีสิทธิ์ใน LINE Official Account, LINE
Developers Console และ Supabase Dashboard เท่านั้น ค่าลับทั้งหมดต้องอยู่ใน
หน้าควบคุมของผู้ให้บริการหรือ environment ของเครื่องเจ้าของ ห้ามส่งผ่านแชต,
commit ลง Git หรือใส่ใน `VITE_*`.

> Codex ไม่สามารถสร้างบัญชี LINE Official Account หรือยอมรับข้อตกลงแทนเจ้าของได้
> เจ้าของต้องลงชื่อเข้าใช้และทำขั้นตอน interactive ของ LINE ด้วยตนเอง

อ้างอิง: [LINE Login สำหรับเว็บ](https://developers.line.biz/en/docs/line-login/integrate-line-login/),
[LINE Rich Menu](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/),
และ [Supabase custom OAuth providers](https://supabase.com/docs/guides/auth/custom-oauth-providers).

## 1. สร้าง LINE Official Account `บ้านเงินดี`

ใน [LINE Official Account Manager](https://manager.line.biz/) ให้เจ้าของสร้าง OA
ชื่อ `บ้านเงินดี` และทำข้อมูล/ข้อกำหนดที่ LINE ขอให้ครบด้วยบัญชีของเจ้าของเอง
บันทึกว่า OA นี้จะเป็นช่องทางที่ผู้ใช้แตะ rich menu และส่งข้อความ `สอบถามเรา`
ให้แอดมินตอบด้วยตนเอง ไม่มี webhook หรือบอตตอบกลับในงานนี้

## 2. เปิดใช้ Messaging API

จาก OA ให้เปิดใช้ Messaging API เพื่อสร้าง Messaging API channel และออก channel
access token สำหรับการ provision rich menu เท่านั้น เก็บ token ไว้ใน password
manager หรือใช้เฉพาะ environment ของ terminal ในขั้นตอนที่ 9; อย่าใส่ token ใน
Cloudflare variables, browser bundle, ไฟล์ `.env` ที่จะ commit หรือภาพหน้าจอ

## 3. สร้าง LINE Provider เดียว

ใน LINE Developers Console สร้าง LINE Provider หนึ่งตัว แล้วให้ทั้ง Messaging API
channel จากข้อ 2 และ LINE Login channel จากข้อ 4 อยู่ใต้ Provider เดียวกัน
Provider เดียวกันทำให้ OA และ LINE Login เป็นชุดเดียวกัน และรองรับการเชื่อม rich
menu รายบุคคลหากเลือกใช้ในภายหลัง

## 4. ตั้งค่า LINE Login เป็น Web App และขอเฉพาะ scope ที่จำเป็น

สร้าง LINE Login channel ภายใต้ Provider เดียวกัน ใน Basic settings เลือก App type
เป็น **Web app**. ตั้ง permission/scope ที่ Supabase จะส่งไปเป็น `openid profile`
เท่านั้น และอย่าสมัครหรือขอ email permission: บ้านเงินดีใช้ชื่อโปรไฟล์เพื่อเรียกชื่อ
workspace ได้ แต่ไม่ต้องใช้ email ของ LINE. เก็บ Channel ID และ Channel secret
ไว้สำหรับกรอกใน Supabase เท่านั้น

## 5. คัดลอก Supabase Auth callback ไปตั้งใน LINE Login

ไปที่ Supabase Dashboard → Authentication → Providers → Custom OAuth Providers
แล้วเริ่มสร้าง provider ตามข้อ 6. หน้านี้จะแสดง **Callback URL แบบ read-only**
ของ Supabase ให้คัดลอก URL ที่ Dashboard แสดงจริงไปวางใน LINE Developers Console
→ LINE Login → Callback URL. อย่าเดาหรือแทนที่ด้วย URL เว็บแอป:
`/line/callback` เป็นปลายทางหลังจาก Supabase ออก session แล้ว ไม่ใช่ callback
ระหว่าง LINE กับ Supabase. หากภายหลังเปลี่ยน Supabase custom domain ให้คัดลอกและ
เพิ่ม callback URL ใหม่ที่ Dashboard แสดงด้วย

## 6. ตั้งค่า Supabase custom OAuth provider `custom:line`

ใน Supabase Dashboard → Authentication → Providers → Custom OAuth Providers เลือก
Manual configuration (OAuth2) แล้วสร้างและ enable provider ดังนี้:

| ค่า | ใช้ค่า |
| --- | --- |
| Identifier | `custom:line` |
| Client ID / Client secret | LINE Login Channel ID / Channel secret จากข้อ 4 |
| Authorization URL | `https://access.line.me/oauth2/v2.1/authorize` |
| Token URL | `https://api.line.me/oauth2/v2.1/token` |
| UserInfo URL | `https://api.line.me/v2/profile` |
| Scopes | `openid profile` |
| Email optional | เปิด (`true`) |

`custom:` เป็น prefix ที่ Supabase บังคับสำหรับ custom provider และ `email_optional`
ต้องเปิดเพราะ LINE Login flow นี้ไม่ขอ email. Supabase รองรับ PKCE สำหรับ custom
providers โดยปริยาย; อย่าปิดหาก LINE รองรับตามปกติ. หน้า provider ของ Supabase
เป็นแหล่งข้อมูลจริงสำหรับ callback URL และต้องไม่บันทึก Channel secret ไว้ในเอกสาร
หรือ source code.

## 7. เพิ่ม Auth redirect URLs ของเว็บแอปใน Supabase

ใน Supabase Dashboard → Authentication → URL Configuration ตั้ง Site URL เป็น
production origin แล้วเพิ่ม redirect URLs ต่อไปนี้ (เก็บ URL เดิมสำหรับ sign-in,
reset password และ email/password flow ไว้ทั้งหมด):

```text
https://baan-ngern-dee.newforico-9ea.workers.dev/line/callback
http://127.0.0.1:8787/line/callback
http://127.0.0.1:5173/line/callback
```

สาม URL นี้เป็นปลายทาง `redirectTo` ของเว็บหลัง Supabase Auth เสร็จสิ้น; URL
production ต้องเป็น HTTPS. ขั้นตอนนี้ไม่แทนที่ callback URL ของ Supabase ที่ตั้งใน
LINE Login จากข้อ 5.

## 8. Deploy แอปพลิเคชัน

deploy migration (ถ้ามี), Worker และเว็บตาม
[`deploy-cloudflare-supabase.md`](deploy-cloudflare-supabase.md) ก่อนเปิด rich menu
ให้ผู้ใช้จริง ตรวจว่าหน้า `/line` และ `/line/callback` ถูกเสิร์ฟเป็น SPA route และ
หน้า sign-in email/password เดิมยังเข้าถึงได้. Origin ที่ rich menu ใช้คือ
`https://baan-ngern-dee.newforico-9ea.workers.dev`.

## 9. Provision rich menu จากเครื่องของเจ้าของโดยไม่พิมพ์ token

หลัง deploy ให้ใช้ PowerShell ใน root ของ repository และรับ token ผ่าน prompt
เท่านั้น อย่าส่งคำสั่งพร้อม token เป็น command-line argument. รันตามลำดับนี้:

```powershell
$env:LINE_CHANNEL_ACCESS_TOKEN = Read-Host -MaskInput
npm run validate:line-menu
npm run provision:line-menu
Remove-Item Env:LINE_CHANNEL_ACCESS_TOKEN
```

`validate:line-menu` ตรวจภาพ PNG, พื้นที่แตะ และ URL ก่อนเรียก LINE; ส่วน
`provision:line-menu` จะ validate, สร้าง rich menu, upload PNG และตั้งเป็น default
ตามลำดับ. หากคำสั่งล้มเหลว ให้ล้าง environment variable ตามบรรทัดสุดท้ายก่อนตรวจ
ข้อความผิดพลาด; ห้ามนำ token ไปวางใน issue หรือ log.

## 10. ทางเลือก: ทดสอบ rich menu เฉพาะเจ้าของก่อนตั้ง default

หากเลือกใช้ LINE per-user linking flow ให้สร้างและ upload rich menu ที่ **ยังไม่**
ตั้ง default แล้ว link rich menu นั้นกับ LINE user ID ของเจ้าของผ่าน API/เครื่องมือ
LINE ที่ได้รับอนุญาต. การ link ทำได้เฉพาะผู้ที่เพิ่ม OA เป็นเพื่อน และ user ID ต้อง
อยู่ใน channel เดียวกัน. สคริปต์ `npm run provision:line-menu` ออกแบบมาเพื่อ rollout
default จึงไม่ใช่คำสั่งสำหรับทดสอบรายบุคคล; ใช้ขั้นตอน per-user ตาม
[LINE rich-menu reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
เมื่อเจ้าของต้องการทดสอบแบบนี้ แล้วจึงตั้ง menu ที่ผ่านทดสอบเป็น default ในข้อ 9
หรือ LINE Official Account Manager.

## 11. ทดสอบด้วยบัญชี LINE สองบัญชี

ใช้บัญชี LINE ทดสอบสองบัญชีที่แยกกัน (เช่น A และ B) และเปิด OA บนอุปกรณ์/โปรไฟล์
browser แยกกัน:

1. ให้ทั้งสองบัญชีเพิ่ม OA เป็นเพื่อน แล้วแตะ `ภาพรวม` เพื่อเข้าสู่ LINE Login
2. อนุญาต `openid profile` และรอให้แต่ละบัญชีเข้าสู่ `/overview`
3. ตรวจ `/v1/snapshot` ผ่าน Network panel ของแต่ละ session โดยไม่คัดลอก bearer
   token ว่า `workspaceId` ต่างกัน
4. สร้างข้อมูลทดสอบที่ไม่ละเอียดอ่อนใน workspace A แล้วตรวจว่า B ไม่เห็นหรือแก้ไข
   ข้อมูลนั้นไม่ได้; ทำสลับกันอีกครั้ง
5. ตรวจว่า workspace แรกใช้ชื่อ `บ้านเงินของ {ชื่อโปรไฟล์ LINE}` หรือ
   `การเงินของฉัน` เมื่อไม่มีชื่อที่ใช้ได้

หาก workspace ซ้ำหรือข้อมูลข้ามบัญชี ให้หยุด rollout และตรวจ Supabase/Auth/RLS ก่อน
ตั้ง rich menu เป็น default.

## 12. ทดสอบทุกพื้นที่แตะบน LINE mobile

rich menu ไม่แสดงบน LINE desktop จึงต้องทดสอบบน LINE mobile จริง หลังมี session
ทดสอบแล้ว แตะทั้งหกพื้นที่และบันทึกผล:

| พื้นที่ | ผลที่ต้องได้ |
| --- | --- |
| `ภาพรวม` | เปิด `/overview` |
| `เพิ่มรายรับ` | เปิดรายการใหม่ชนิด income |
| `เพิ่มรายจ่าย` | เปิดรายการใหม่ชนิด expense |
| `บัญชี` | เปิด `/accounts` |
| `ผ่อนและหนี้` | เปิด `/installments` |
| `สอบถามเรา` | ส่งข้อความ `สอบถามเรา` ใน OA chat เพื่อให้แอดมินตอบ |

ทดสอบอีกครั้งหลังปิด/เปิด LINE เพื่อยืนยันว่า default rich menu แสดงกับผู้ที่เป็น
เพื่อน OA. หากพื้นที่ใดไป URL ภายนอกหรือไม่ตรง ให้ rollback ก่อนเปิดใช้จริง.

## 13. Rollback โดยคง email/password ไว้

หาก rollout มีปัญหา ให้หยุด traffic ใหม่ด้วยลำดับนี้:

1. ลบ default rich menu ใน LINE Official Account Manager หรือเรียก API ลบ default
   rich menu ของ OA
2. ปิดหรือ disable `custom:line` ใน Supabase Dashboard → Authentication → Providers
3. คง Email/Password provider, Site URL, redirect URLs เดิม และหน้า sign-in เดิมไว้
4. หากปัญหาอยู่ที่เว็บ ให้ rollback Worker ไป deployment ก่อนหน้า; database ใช้
   corrective forward migration เท่านั้น ห้ามลบข้อมูลเพื่อย้อน migration

ผู้ใช้ email/password เดิมต้องยังเข้าสู่ระบบและใช้ workspace เดิมได้ตลอด rollback.
การปิด `custom:line` หยุดการเข้าใหม่ผ่าน LINE แต่ไม่ลบ Auth user หรือข้อมูลการเงิน
ที่มีอยู่โดยอัตโนมัติ.

## 14. Rotate channel token ทันทีเมื่อสงสัยว่ารั่ว

หาก Messaging API channel access token ปรากฏใน terminal history, log, chat, Git,
ภาพหน้าจอ หรือถูกส่งผิดที่ ให้ถือว่ารั่ว: ออก/rotate token ใหม่ใน LINE Developers
Console ทันที, ยกเลิกค่าเดิมจาก password manager และ environment ที่ใช้ provision,
จากนั้นทำขั้นตอน 9 ใหม่ด้วย token ใหม่. หาก LINE Login Channel secret รั่วด้วย ให้
rotate secret ใน LINE และอัปเดตเฉพาะใน Supabase custom provider แล้วทดสอบ LINE
Login อีกครั้ง. อย่าใส่ token หรือ secret ที่รั่วไว้ในรายงาน incident.

## รายการก่อนเปิดใช้จริง

- [ ] Owner ทำขั้นตอน LINE interactive และ provider/channel อยู่ใต้ Provider เดียวกัน
- [ ] Supabase custom provider `custom:line` เปิดใช้, email optional และใช้ scopes
  `openid profile`
- [ ] callback URL ที่ Supabase Dashboard แสดงถูกตั้งใน LINE Login; app redirect URLs
  จากข้อ 7 ถูก allowlist ใน Supabase
- [ ] ทดสอบสองบัญชีเห็น `workspaceId` และข้อมูลที่แยกจากกัน
- [ ] ทดสอบ six taps บน LINE mobile และแชต `สอบถามเรา` ถึงแอดมิน
- [ ] Email/password sign-in เดิมยังทำงาน
