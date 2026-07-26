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
});
