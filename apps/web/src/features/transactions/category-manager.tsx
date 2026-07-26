import { useState, type FormEvent } from "react";
import { Plus, Tags } from "lucide-react";

import type { Category, CategoryKind } from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";

type CategoryManagerProps = Readonly<{
  api: Pick<FinanceApi, "createCategory">;
  workspaceId: string;
  categories: Category[];
  onChanged(): void;
}>;

export function CategoryManager({
  api,
  workspaceId,
  categories,
  onChanged
}: CategoryManagerProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("กรุณากรอกชื่อหมวดหมู่");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.createCategory({
        workspaceId,
        name: trimmedName,
        kind
      });
      setName("");
      onChanged();
    } catch {
      setError("เพิ่มหมวดหมู่ไม่ได้ อาจมีชื่อนี้อยู่แล้ว");
    } finally {
      setSubmitting(false);
    }
  }

  const visibleCategories = categories.filter(
    (category) => category.kind === kind
  );

  return (
    <section className="category-manager" aria-labelledby="category-manager-title">
      <div className="category-manager-title">
        <span className="category-manager-icon">
          <Tags size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="category-manager-title">จัดการหมวดหมู่</h2>
          <p>หมวดเริ่มต้นพร้อมใช้ และเพิ่มหมวดของคุณเองได้</p>
        </div>
      </div>

      <div className="category-kind-tabs" aria-label="ประเภทหมวดหมู่">
        <button
          type="button"
          className={kind === "expense" ? "active" : ""}
          onClick={() => setKind("expense")}
        >
          รายจ่าย
        </button>
        <button
          type="button"
          className={kind === "income" ? "active" : ""}
          onClick={() => setKind("income")}
        >
          รายรับ
        </button>
      </div>

      <div className="category-chip-list" aria-label="หมวดหมู่ปัจจุบัน">
        {visibleCategories.map((category) => (
          <span
            className={category.isDefault ? "category-chip" : "category-chip custom"}
            key={category.id}
          >
            {category.name}
            {!category.isDefault ? <small>กำหนดเอง</small> : null}
          </span>
        ))}
      </div>

      <form className="category-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="new-category-name">ชื่อหมวดหมู่ใหม่</label>
          <input
            id="new-category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="เช่น สัตว์เลี้ยง"
          />
        </div>
        <button type="submit" className="primary-button compact" disabled={submitting}>
          <Plus size={17} aria-hidden="true" />
          {submitting ? "กำลังเพิ่ม…" : "เพิ่มหมวดหมู่"}
        </button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
