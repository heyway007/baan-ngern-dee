import {
  useState,
  type FormEvent
} from "react";

import type {
  AccountCreationResult,
  FinanceApi
} from "../../lib/finance-api";

type AccountFormProps = Readonly<{
  api: Pick<FinanceApi, "createAccount">;
  workspaceId: string;
  onCreated(result: AccountCreationResult): void;
}>;

const accountTypes = [
  ["cash", "เงินสด"],
  ["bank", "บัญชีธนาคาร"],
  ["ewallet", "กระเป๋าเงินอิเล็กทรอนิกส์"],
  ["credit_card", "บัตรเครดิต"],
  ["loan", "เงินกู้"],
  ["asset", "สินทรัพย์"]
] as const;

const signedMoneyPattern =
  /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function AccountForm({
  api,
  workspaceId,
  onCreated
}: AccountFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof accountTypes)[number][0]>("cash");
  const [currency, setCurrency] = useState("THB");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [institution, setInstitution] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("กรุณากรอกชื่อบัญชี");
      return;
    }
    if (!signedMoneyPattern.test(openingBalance)) {
      setError(
        "กรอกจำนวนเงินเป็นตัวเลข เช่น 1000.00 โดยไม่ใส่เครื่องหมายคั่นหลักพัน"
      );
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.createAccount({
        workspaceId,
        name: trimmedName,
        type,
        currency,
        openingBalance,
        ...(institution.trim()
          ? { institution: institution.trim() }
          : {})
      });
      onCreated(result);
      setName("");
      setOpeningBalance("0.00");
      setInstitution("");
    } catch {
      setError(
        "ยังเพิ่มบัญชีไม่ได้ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="account-form" onSubmit={handleSubmit} noValidate>
      <div className="field full-field">
        <label htmlFor="account-name">ชื่อบัญชี</label>
        <input
          id="account-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="เช่น เงินสด, บัญชีเงินเดือน"
          maxLength={80}
        />
      </div>

      <div className="field">
        <label htmlFor="account-type">ประเภทบัญชี</label>
        <select
          id="account-type"
          value={type}
          onChange={(event) =>
            setType(event.target.value as typeof type)
          }
        >
          {accountTypes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="account-currency">สกุลเงิน</label>
        <select
          id="account-currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
        >
          <option value="THB">THB — บาทไทย</option>
          <option value="USD">USD — ดอลลาร์สหรัฐ</option>
          <option value="EUR">EUR — ยูโร</option>
          <option value="JPY">JPY — เยน</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="opening-balance">ยอดตั้งต้น</label>
        <input
          id="opening-balance"
          inputMode="decimal"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          aria-describedby="opening-balance-hint"
        />
        <small id="opening-balance-hint">
          ระบบจะบันทึกเป็นรายการปรับยอดที่ตรวจสอบย้อนหลังได้
        </small>
      </div>

      <div className="field">
        <label htmlFor="institution">
          ธนาคารหรือสถาบัน (ไม่บังคับ)
        </label>
        <input
          id="institution"
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          maxLength={120}
        />
      </div>

      {error ? (
        <p role="alert" className="form-error full-field">
          {error}
        </p>
      ) : null}

      <div className="form-actions full-field">
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "กำลังเพิ่ม…" : "เพิ่มบัญชี"}
        </button>
      </div>
    </form>
  );
}
