import { describe, expect, it } from "vitest";

import { createLocalFinanceApi } from "./local-finance-api";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local finance API", () => {
  it("restores workspace and exact account balances after reload", async () => {
    const storage = new MemoryStorage();
    const first = createLocalFinanceApi(storage);
    const workspace = await first.createPrivateWorkspace({
      name: "บ้านของเรา",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });
    await first.createAccount({
      workspaceId: workspace.workspace.id,
      name: "เงินสด",
      type: "cash",
      currency: "THB",
      openingBalance: "5000.50"
    });

    const reloaded = createLocalFinanceApi(storage);
    expect(reloaded.getSnapshot()).toMatchObject({
      workspace: {
        id: workspace.workspace.id,
        name: "บ้านของเรา"
      },
      accounts: [
        {
          name: "เงินสด",
          currency: "THB"
        }
      ]
    });
    expect(
      Object.values(reloaded.getSnapshot().accountBalances)
    ).toEqual([
      expect.objectContaining({
        amount: "5000.50",
        currency: "THB"
      })
    ]);
  });

  it("refuses a second private workspace without replacing data", async () => {
    const api = createLocalFinanceApi(new MemoryStorage());
    await api.createPrivateWorkspace({
      name: "พื้นที่แรก",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });

    await expect(
      api.createPrivateWorkspace({
        name: "พื้นที่ใหม่",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      })
    ).rejects.toThrow("PRIVATE_WORKSPACE_EXISTS");
    expect(api.getSnapshot().workspace?.name).toBe("พื้นที่แรก");
  });

  it("posts exact income and expense amounts and persists the new balance", async () => {
    const storage = new MemoryStorage();
    const api = createLocalFinanceApi(storage);
    const created = await api.createPrivateWorkspace({
      name: "รายการทดสอบ",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });
    const account = await api.createAccount({
      workspaceId: created.workspace.id,
      name: "เงินสด",
      type: "cash",
      currency: "THB",
      openingBalance: "1000.00"
    });
    const food = created.categories.find(
      (category) => category.slug === "food"
    )!;
    const salary = created.categories.find(
      (category) => category.slug === "salary"
    )!;

    await api.postTransaction({
      workspaceId: created.workspace.id,
      accountId: account.account.id,
      type: "expense",
      amount: "125.55",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId: food.id,
      tagIds: [],
      clientMutationId: crypto.randomUUID()
    });
    await api.postTransaction({
      workspaceId: created.workspace.id,
      accountId: account.account.id,
      type: "income",
      amount: "0.55",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId: salary.id,
      tagIds: [],
      clientMutationId: crypto.randomUUID()
    });

    const reloaded = createLocalFinanceApi(storage).getSnapshot();
    expect(reloaded.accountBalances[account.account.id]?.amount).toBe(
      "875.00"
    );
    expect(reloaded.transactions).toEqual([
      expect.objectContaining({
        amount: "125.55",
        type: "expense"
      }),
      expect.objectContaining({
        amount: "0.55",
        type: "income"
      })
    ]);
  });

  it("creates a custom category and rejects a duplicate sibling name", async () => {
    const api = createLocalFinanceApi(new MemoryStorage());
    const created = await api.createPrivateWorkspace({
      name: "หมวดหมู่",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });

    const category = await api.createCategory({
      workspaceId: created.workspace.id,
      name: "สัตว์เลี้ยง",
      kind: "expense"
    });

    expect(category).toMatchObject({
      name: "สัตว์เลี้ยง",
      kind: "expense",
      isDefault: false
    });
    await expect(
      api.createCategory({
        workspaceId: created.workspace.id,
        name: " สัตว์เลี้ยง ",
        kind: "expense"
      })
    ).rejects.toThrow("CATEGORY_NAME_EXISTS");
  });
});
