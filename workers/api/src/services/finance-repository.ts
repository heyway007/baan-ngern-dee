import type {
  Account,
  Category,
  CategoryKind,
  CreateAccountInput,
  CreateCategoryInput,
  CreatePrivateWorkspaceInput,
  Workspace,
  WorkspaceRole
} from "@systems-credit/contracts";

import { ApiError } from "../api-error";

export interface FinanceRepository {
  createPrivateWorkspace(
    userId: string,
    input: CreatePrivateWorkspaceInput
  ): Promise<{ workspace: Workspace; categories: Category[] }>;
  createCategory(
    userId: string,
    input: CreateCategoryInput
  ): Promise<Category>;
  createAccount(
    userId: string,
    input: CreateAccountInput
  ): Promise<Account>;
}

type StoredWorkspace = Omit<Workspace, "role"> & {
  ownerUserId: string;
};

type DefaultCategory = Readonly<{
  slug: string;
  name: string;
  kind: CategoryKind;
}>;

export const defaultCategories: readonly DefaultCategory[] = [
  { slug: "salary", name: "เงินเดือน", kind: "income" },
  { slug: "bonus", name: "โบนัส", kind: "income" },
  { slug: "freelance", name: "งานเสริม", kind: "income" },
  { slug: "interest-income", name: "ดอกเบี้ยรับ", kind: "income" },
  { slug: "gift-income", name: "ของขวัญ", kind: "income" },
  { slug: "other-income", name: "รายรับอื่น", kind: "income" },
  { slug: "food", name: "อาหาร", kind: "expense" },
  { slug: "groceries", name: "ของใช้ในบ้าน", kind: "expense" },
  { slug: "housing", name: "ที่อยู่อาศัย", kind: "expense" },
  { slug: "utilities", name: "สาธารณูปโภค", kind: "expense" },
  { slug: "transport", name: "เดินทาง", kind: "expense" },
  { slug: "health", name: "สุขภาพ", kind: "expense" },
  { slug: "education", name: "การศึกษา", kind: "expense" },
  { slug: "shopping", name: "ช้อปปิ้ง", kind: "expense" },
  { slug: "entertainment", name: "บันเทิง", kind: "expense" },
  { slug: "debt-interest", name: "ดอกเบี้ยหนี้", kind: "expense" },
  { slug: "financial-fees", name: "ค่าธรรมเนียม", kind: "expense" },
  { slug: "other-expense", name: "รายจ่ายอื่น", kind: "expense" }
];

function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase("th-TH");
}

export function createMemoryFinanceRepository(): FinanceRepository {
  const workspaces = new Map<string, StoredWorkspace>();
  const memberships = new Map<string, Map<string, WorkspaceRole>>();
  const categories = new Map<string, Category>();
  const accounts = new Map<string, Account>();

  return {
    async createPrivateWorkspace(userId, input) {
      const existing = [...workspaces.values()].some(
        (workspace) =>
          workspace.ownerUserId === userId && workspace.kind === "private"
      );
      if (existing) {
        throw new ApiError(
          "PRIVATE_WORKSPACE_EXISTS",
          409,
          "ผู้ใช้นี้มีพื้นที่ส่วนตัวอยู่แล้ว"
        );
      }

      const id = crypto.randomUUID();
      const stored: StoredWorkspace = {
        id,
        name: input.name,
        kind: "private",
        baseCurrency: input.baseCurrency,
        timeZone: input.timeZone,
        ownerUserId: userId,
        version: 1
      };
      workspaces.set(id, stored);
      memberships.set(id, new Map([[userId, "owner"]]));

      const seeded = defaultCategories.map<Category>((category) => {
        const result: Category = {
          id: crypto.randomUUID(),
          workspaceId: id,
          slug: category.slug,
          name: category.name,
          kind: category.kind,
          isDefault: true,
          version: 1
        };
        categories.set(result.id, result);
        return result;
      });

      return {
        workspace: {
          id: stored.id,
          name: stored.name,
          kind: stored.kind,
          baseCurrency: stored.baseCurrency,
          timeZone: stored.timeZone,
          role: "owner",
          version: stored.version
        },
        categories: seeded
      };
    },

    async createCategory(userId, input) {
      const role = memberships.get(input.workspaceId)?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }

      if (input.parentId) {
        const parent = categories.get(input.parentId);
        if (
          !parent ||
          parent.workspaceId !== input.workspaceId ||
          parent.kind !== input.kind
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            400,
            "หมวดหมู่หลักไม่ถูกต้อง"
          );
        }
      }

      const normalizedName = normalizeCategoryName(input.name);
      const duplicate = [...categories.values()].some(
        (category) =>
          category.workspaceId === input.workspaceId &&
          category.kind === input.kind &&
          category.parentId === input.parentId &&
          normalizeCategoryName(category.name) === normalizedName
      );
      if (duplicate) {
        throw new ApiError(
          "CATEGORY_NAME_EXISTS",
          409,
          "มีชื่อหมวดหมู่นี้อยู่แล้ว"
        );
      }

      const id = crypto.randomUUID();
      const category: Category = {
        id,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        slug: `custom-${id}`,
        name: input.name,
        kind: input.kind,
        isDefault: false,
        version: 1
      };
      categories.set(id, category);
      return category;
    },

    async createAccount(userId, input) {
      const role = memberships.get(input.workspaceId)?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }

      const id = crypto.randomUUID();
      const account: Account = {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        institution: input.institution,
        version: 1
      };
      accounts.set(id, account);
      return account;
    }
  };
}
