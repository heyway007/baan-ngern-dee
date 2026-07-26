import { Plus, Trash2, X } from "lucide-react";

import type {
  Category,
  TransactionSplitInput
} from "@systems-credit/contracts";

type SplitEditorProps = Readonly<{
  categories: Category[];
  value: TransactionSplitInput[];
  onChange(value: TransactionSplitInput[]): void;
  onCancel(): void;
}>;

export function SplitEditor({
  categories,
  value,
  onChange,
  onCancel
}: SplitEditorProps) {
  function update(
    index: number,
    field: keyof TransactionSplitInput,
    fieldValue: string
  ) {
    onChange(
      value.map((split, splitIndex) =>
        splitIndex === index
          ? { ...split, [field]: fieldValue }
          : split
      )
    );
  }

  return (
    <fieldset className="split-editor full-field">
      <legend>แบ่งหลายหมวดหมู่</legend>
      <button
        type="button"
        className="split-cancel"
        onClick={onCancel}
      >
        <X size={16} aria-hidden="true" />
        ใช้หมวดเดียว
      </button>

      <div className="split-rows">
        {value.map((split, index) => (
          <div className="split-row" key={`${index}-${split.categoryId}`}>
            <span className="split-number">{index + 1}</span>
            <div className="field">
              <label htmlFor={`split-category-${index}`}>
                หมวดหมู่ส่วนที่ {index + 1}
              </label>
              <select
                id={`split-category-${index}`}
                value={split.categoryId}
                onChange={(event) =>
                  update(index, "categoryId", event.target.value)
                }
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`split-amount-${index}`}>
                จำนวนเงินส่วนที่ {index + 1}
              </label>
              <input
                id={`split-amount-${index}`}
                inputMode="decimal"
                value={split.amount}
                onChange={(event) =>
                  update(index, "amount", event.target.value)
                }
                placeholder="0.00"
              />
            </div>
            {value.length > 2 ? (
              <button
                type="button"
                className="icon-button remove-split"
                aria-label={`ลบส่วนที่ ${index + 1}`}
                onClick={() =>
                  onChange(value.filter((_, splitIndex) => splitIndex !== index))
                }
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="secondary-button compact add-split"
        onClick={() =>
          onChange([
            ...value,
            {
              categoryId: categories[0]?.id ?? "",
              amount: ""
            }
          ])
        }
      >
        <Plus size={16} aria-hidden="true" />
        เพิ่มส่วนแบ่ง
      </button>
    </fieldset>
  );
}
