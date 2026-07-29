import {
  publicAppConfigSchema,
  type HealthResponse,
  type PublicAppConfig
} from "@systems-credit/contracts";
import { Hono } from "hono";

import { errorHandler } from "./middleware/error-handler";
import {
  createStaticAuthVerifier,
  requireAuth,
  type AuthVerifier
} from "./middleware/auth";
import { requestId } from "./middleware/request-id";
import { accountRoutes } from "./routes/accounts";
import { catalogRoutes } from "./routes/catalog";
import {
  adminInvitationRoutes,
  publicInvitationRoutes
} from "./routes/invitations";
import { installmentRoutes } from "./routes/installments";
import { planningRoutes } from "./routes/planning";
import {
  recurringOccurrenceRoutes,
  recurringPeriodRoutes,
  recurringTemplateRoutes
} from "./routes/recurring";
import { snapshotRoutes } from "./routes/snapshot";
import { transactionRoutes } from "./routes/transactions";
import { slipImportRoutes } from "./routes/slip-imports";
import { transferRoutes } from "./routes/transfers";
import { workspaceRoutes } from "./routes/workspaces";
import { adminUserRoutes } from "./routes/users";
import {
  createMemoryFinanceRepository,
  type FinanceRepository
} from "./services/finance-repository";
import type {
  InvitationService
} from "./services/invitation-service";
import type { UserManagementService } from "./services/user-management-service";
import {
  createMemoryPlanningRepository,
  type PlanningRepository
} from "./services/planning-repository";
import type { SlipImportService } from "./services/slip-import-service";
import type { AppEnv } from "./types";

export type AppDependencies = Readonly<{
  authVerifier: AuthVerifier;
  financeRepository: FinanceRepository;
  planningRepository: PlanningRepository;
  invitationService: InvitationService;
  userManagementService: UserManagementService;
  publicConfig: PublicAppConfig;
  slipImportService: SlipImportService;
}>;

export function createApp(
  dependencies: Partial<AppDependencies> = {}
) {
  const authVerifier =
    dependencies.authVerifier ?? createStaticAuthVerifier({});
  const financeRepository =
    dependencies.financeRepository ?? createMemoryFinanceRepository();
  const planningRepository =
    dependencies.planningRepository ?? createMemoryPlanningRepository();
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.onError(errorHandler);
  app.get("/health", (context) => {
    const body: HealthResponse = {
      ok: true,
      service: "systems-credit-api"
    };
    return context.json(body);
  });
  app.get("/config", (context) =>
    context.json(
      publicAppConfigSchema.parse(dependencies.publicConfig)
    )
  );
  if (dependencies.invitationService) {
    app.route(
      "/v1/public/invitations",
      publicInvitationRoutes(dependencies.invitationService)
    );
  }
  app.use("/v1/*", requireAuth(authVerifier));
  if (dependencies.invitationService) {
    app.route(
      "/v1/admin",
      adminInvitationRoutes(dependencies.invitationService)
    );
  }
  if (dependencies.userManagementService) {
    app.route(
      "/v1/admin",
      adminUserRoutes(dependencies.userManagementService)
    );
  }
  app.route("/v1/snapshot", snapshotRoutes(financeRepository));
  app.route("/v1/accounts", accountRoutes(financeRepository));
  app.route("/v1/workspaces", workspaceRoutes(financeRepository));
  app.route("/v1/categories", catalogRoutes(financeRepository));
  app.route(
    "/v1/installments",
    installmentRoutes(financeRepository)
  );
  app.route(
    "/v1/transactions",
    transactionRoutes(financeRepository)
  );
  if (dependencies.slipImportService) {
    app.route(
      "/v1/slip-imports",
      slipImportRoutes(dependencies.slipImportService)
    );
  }
  app.route("/v1/transfers", transferRoutes(financeRepository));
  app.route("/v1/planning", planningRoutes(planningRepository));
  app.route(
    "/v1/recurring-templates",
    recurringTemplateRoutes(financeRepository)
  );
  app.route(
    "/v1/recurring-periods",
    recurringPeriodRoutes(financeRepository)
  );
  app.route(
    "/v1/recurring-occurrences",
    recurringOccurrenceRoutes(financeRepository)
  );

  return app;
}
