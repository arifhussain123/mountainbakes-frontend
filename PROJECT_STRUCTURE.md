# Project Structure — `@mb/web` (mountainbakes-frontend)

Next.js 16 static-export PWA (`output: 'export'`), served by Firebase Hosting from `out/`.
Generated `2026-08-31`. Excludes `node_modules/`, `.next/`, `out/`, `.git/`, `.firebase/`.

---

## Root

```
mountainbakes-frontend/
├── src/                        application source (see below)
├── public/                     static assets copied verbatim into out/
├── scripts/                    build-time Node scripts (.mjs)
├── .claude/                    Claude Code project config + skills
│
├── next.config.ts              output: 'export', trailingSlash: true
├── firebase.json               headers + rewrites (owns them, NOT next.config.ts)
├── .firebaserc                 project: mountainbakes-dfc2c
├── postcss.config.mjs          Tailwind v4 (CSS-first, no tailwind.config)
├── eslint.config.mjs           flat config
├── components.json             shadcn v4, style base-nova (@base-ui/react)
├── tsconfig.json               path aliases: @/* → src/*, @mb/shared/* → src/shared/*
├── next-env.d.ts
├── package.json                Node 24.x, pnpm 11.12.0 pinned
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── skills-lock.json
│
├── .env / .env.example / .env.production.local      NEXT_PUBLIC_* inlined at BUILD time
├── .gitignore
├── .dockerignore
│
├── README.md                   layout + local setup (partly stale)
├── DEPLOY.md                   current deploy reference
├── PWA.md                      manifest, public/sw.js, push stub
├── PERF-NOTES.md               what the notification-driven invalidation replaced
├── GEOFENCING.md               branch selling areas
├── ENGINE_SUMMARY.md           record of a deleted FastAPI service (nothing depends on it)
└── AGENTS.md
```

> `apphosting.yaml`, `Dockerfile` and `Procfile` are absent/dead — this app has no runtime host.

---

## `src/app/` — routes (thin wrappers; logic lives in `src/components/`)

```
src/app/
├── layout.tsx                  root layout — mounts AuthProvider + RouteGuard
├── page.tsx                    landing / role redirect
├── globals.css                 Tailwind v4 theme lives here
├── manifest.ts                 needs `export const dynamic = 'force-static'`
├── favicon.ico
│
├── (auth)/
│   ├── layout.tsx
│   ├── login/page.tsx
│   └── finance-login/page.tsx        Finance User ID, not email
│
├── change-password/page.tsx
├── reset-password/page.tsx
│
└── (dashboard)/
    ├── layout.tsx              RealtimeProvider + RealtimeBridge + AppRefreshProvider
    │
    ├── (admin)/                super_admin
    │   ├── dashboard/          orders/            products/
    │   ├── branches/           categories/        price-list/
    │   ├── customers/          price-history/     stock-control/
    │   ├── geofencing/         reports/           settings/
    │   ├── notification-recipients/               support/
    │   ├── users/              user-requests/
    │   └── special-events/
    │       ├── page.tsx
    │       └── [id]/page.tsx   builds ONE shell at EVENT_ID_PLACEHOLDER;
    │                           firebase.json rewrites real ids onto it
    │
    ├── (branch)/               branch_manager + branch_user
    │   ├── branch-dashboard/   branch-sales/      branch-stock/
    │   ├── branch-orders/      branch-new-orders/ branch-return-stock/
    │   ├── branch-closing/     branch-expenses/   branch-discounts/
    │   ├── branch-customers/   branch-events/     branch-reports/
    │   ├── branch-users/       branch-help-desk/
    │
    ├── (production)/           production_user
    │   ├── production-dashboard/   production-orders/    production-queue/
    │   ├── production-stock/       production-sales/     production-returns/
    │   ├── production-branch-stock/ production-discounts/
    │   ├── production-events/      production-reports/   production-help-desk/
    │
    └── (finance)/              finance_admin | finance_manager | accountant | finance_auditor
        ├── finance-dashboard/  finance-ledger/    finance-entries/
        ├── finance-closing/    finance-income/    finance-heads/
        ├── finance-salaries/   finance-partner-expenses/
        ├── finance-reports/    finance-audit/     finance-settings/
```

---

## `src/components/` — feature components (where the client logic lives)

```
src/components/
├── ui/                     shadcn v4 primitives on @base-ui/react — NOT Radix
│   avatar badge button card combobox command dialog dropdown-menu input
│   input-group label progress select separator sheet skeleton sonner switch
│   table tabs textarea
│
├── shared/                 cross-feature building blocks
│   DataTable · table-meta.ts (align + mobile ColumnMeta) · StatCard · EmptyState
│   Fab · GlobalSearch · ExpandableText · ResponsiveMatrix
│   PhotoCapture · AttachmentGallery · PrintButton · PrintPortal
│
├── layout/                 Sidebar · Topbar · BottomNav · RefreshButton
│                           RealtimeBridge · LoginHistoryBridge   (mount ONCE)
├── auth/                   RouteGuard (nav UX, not an auth boundary)
│                           ForgotPasswordDialog · PasswordStrengthMeter
│
├── admin/                  AdminBranchStockPage · AllBranchesStockSummary
│                           AddBranchStockModal · DeleteBranchStockDialog
├── dashboard/              AdminDashboard · BranchDashboard · charts
│                           (SalesChart, TopProductsChart, BranchComparisonChart,
│                            SalesVsExpensesChart) · LoginHistoryCard
│                           BranchDailyStockCard · BranchStockHistoryCard
│                           RecentOrdersTable
│
├── branches/               BranchesPage
├── branch-locations/       BranchLocationsPage · LocationPickerDialog
├── branch-users/           AccountRequestsPage · BranchUserRequestsPage
│                           RequestBranchUserForm · requestStatus
├── geofence/               GeofenceGate · GeofenceStatusCard
│
├── products/               ProductsPage · ProductForm · CategoriesPage
│                           PriceListPage · PriceHistoryPage · ChangePriceDialog
├── packing-materials/      PackingMaterialsPage · PackingMaterialForm
├── customers/              CustomersPage · CustomerForm
│
├── orders/                 OrdersPage · BranchOrdersPage · OrderForm · OrderStatusBadge
├── production-orders/      NewOrdersPage · NewOrderModal · BranchNewOrders
│                           BranchOrderDetail · BranchDiscountsPage
│                           DiscountModal · discountShared
├── production/             ProductionDashboard · ProductionOrdersPage
│                           ProductionQueuePage · ProductionStockPage
│                           ProductionReturnsPage · ProductionReportsPage
│                           ProductionDiscountsPage · ProductionCharts
│                           PrepareProductsModal · StockAdjustmentModal
│                           StockLedgerPanel · StockLedgerTypes · ProductStockDetail
│                           BranchStockMatrix · OrderPrintPreview
│                           CollectionsExportModal · PreparedDetailExportModal
│
├── stock/                  StockPage · BranchStockStatement · StockCheckModal
│                           BranchReturnStockPage · ReturnItemsModal
├── sales/                  SalesPage · SaleForm · InvoiceView
├── expenses/               ExpensesPage · ExpenseForm · ExpenseExportModal
├── closing/                BranchClosingPage · ClosingExportModal
│
├── special-events/         SpecialEventsPage · EventDetailPage · EventDetailRoute
│                           EventFormDialog · EventListTable · EventCalendar
│                           EventTimeline · EventBits · EventDemandForm
│                           EventNotificationSchedule · BranchDemandPanel
│                           BranchEventsPage · ProductionEventsPage
│                           ProductionReadinessPanel
│
├── finance/                FinanceDashboardPage · DailyLedgerPage · FinanceEntriesPage
│                           FinanceEntryForm · DailyClosingPage · BranchIncomePage
│                           LedgerHeadsPage · SalaryLedgerPage · SalaryForms
│                           PartnerExpensesPage · CompanyTransactionForms
│                           FinanceReportsPage · FinanceAuditPage
│                           FinanceSettingsPage · FinanceHelpDeskPage
│                           finance-actions · finance-ui
│
├── reports/                ReportsPage · PackingUsageReport
├── settings/               SettingsPage · NotificationRecipientsPage
├── support/                SupportCenterPage · HelpDeskPage
├── users/                  UsersPage · EditUserDialog · UserDetailsDialog
│                           ResetPasswordDialog · UserActivity
│
└── pwa/                    ServiceWorkerRegister · InstallPrompt · NetworkStatus
                            OfflineCache · OrientationLock · PushNotifications
```

---

## `src/lib/` — data layer, integrations, offline

```
src/lib/
├── api/client.ts           apiCall + assertApiReachable() + 401 refresh-and-replay
│                           + endDeadSession(); refuses non-GET while offline
├── queries.ts              ALL TanStack Query hooks (server state goes through here)
├── queryKeys.ts            `qk` — every cache key must come from here
├── supabase/client.ts      session storage adapter · setRememberMe()
├── offline/
│   ├── queryPersist.ts     query-cache snapshot → IndexedDB (4 MB, 1 day)
│   └── lastSession.ts      last identity only — never a token
├── geo/position.ts
├── maps/loader.ts
├── attachments.ts          normalise every capture to ATTACHMENT_STORED_DIMENSION
├── print/
│   ├── pos/                ESC/POS receipts — escpos · table · profiles ·
│   │                       receiptFormatter · printerConfig · printerService · printLog
│   │   └── transport/      WebUSB / Web Serial / raw TCP. No local print service.
│   └── browser/            window.print() for the A4 documents
├── printPaper.ts
├── loginHistory.ts
├── finance.ts
└── utils.ts                cn()
```

## `src/providers/` — mounted once, placement is load-bearing

```
AuthProvider.tsx      root layout — one auth listener app-wide
QueryProvider.tsx     staleTime 60s, refetchOnWindowFocus false, gcTime 1 day
RealtimeProvider.tsx  dashboard layout — the ONLY Realtime channel (notifications)
GeofenceProvider.tsx
ThemeProvider.tsx
```

## `src/hooks/`

```
useAppRefresh.tsx        the single 2s tick (4 guards: hidden tab, open dialog,
                         in-flight mutation, one-at-a-time ref)
useAuth.ts               re-exports AuthProvider context
useNotifications.ts      re-exports RealtimeProvider context
useProductionRealtime.ts | usePriceRealtime.ts | useEventsRealtime.ts
useStockRealtime.ts      notification → query invalidation + toast
useSettings.ts · useDebounce.ts · usePrintCapability.ts
```

## `src/utils/`

```
routes.ts        ROUTES + normalizePath() — trailingSlash makes this mandatory
roleHome.ts      getRoleHome() + isValidRole() — single source of truth for landings
sidebar.ts · pageTitles.ts · icons.ts · constants.ts
api.ts (re-export of lib/api/client) · authErrors.ts · logger.ts
currency.ts · date.ts · helpers.ts · images.ts · password.ts
productSort.ts · demandLines.ts · pwa.ts · pwa-splash.ts · index.ts
└── productPrice/   productPrice · priceHistory · productCategories · validation
                    excelImport · excelExport · config · helpers · index
```

## `src/stores/`

```
useAppStore.ts     client-only UI state (server state belongs in queries.ts)
```

## `src/shared/` — MIRRORED, byte-for-byte, with `mountainbakes-server/src/shared/`

Imported as `@mb/shared`. **Editing anything here means the identical edit in the server tree** — nothing enforces it mechanically.

```
src/shared/
├── index.ts
├── schemas/    attachment · branch · branch-user-request · business-date
│               closing-notifications · customer · discount · expense
│               finance · finance-ticket · geofence · login-session · order
│               packing-material · price · product · production-ops
│               production-order · settings · special-event · stock · support · user
├── types/      attachment · audit · branch · branch-user-request · business-day
│               closing-notifications · customer · discount · expense · finance
│               geofence · login-session · notification · order · packing-material
│               price · product · production · production-ops · production-order
│               report · settings · special-event · stock · support · user
└── utils/      closing · geo · hijri · production-amounts · share · stock · timezone
```

Verify the mirror:

```bash
diff -r ../mountainbakes-server/src/shared src/shared   # must print nothing
```

---

## `public/`

```
public/
├── sw.js                   service worker — no skipWaiting() in install;
│                           navigations MUST be cached; bump VERSION on rule changes
├── offline.html            fallback only
├── version.json            stamped per build by scripts/generate-version.mjs (gitignored)
├── manifest icons/         icon-96/192/512 · maskable-192/512 · favicon-16/32/48
│                           apple-touch-icon
├── splash/                 24 apple-splash PNGs (portrait + landscape per device)
├── assets/images/logo/     logo.png · logo.svg
└── file.svg · globe.svg · next.svg · vercel.svg · window.svg
```

## `scripts/`

```
generate-version.mjs     stamps public/version.json — runs before BOTH build and deploy
generate-pwa-assets.mjs  regenerates icons/ and splash/
```

## `.claude/`

```
CLAUDE.md                            project guidance for Claude Code
settings.local.json
agents/                              (empty)
skills/run-mountainbakes-frontend/SKILL.md
```

---

## Sibling project (not in this repo)

```
mountainbakes/                   plain folder, NOT a repo — no workspace root
├── mountainbakes-server/        Express REST API · :3001 · own git remote, own deploy
└── mountainbakes-frontend/      this project · :3000
```

A change touching both trees is **two commits to two remotes and two deploys**.
