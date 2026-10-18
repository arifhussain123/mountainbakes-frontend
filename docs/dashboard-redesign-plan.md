# Production Dashboard redesign: plan

Status: discovery done, waiting on two decisions (see "Blocking questions").
Data figures below were read from the live database (read-only) on 2026-10-18.

## Files today

Web (`frontend/`)
- `src/app/(dashboard)/…` route → `src/components/production/ProductionDashboard.tsx` (page, KPIs, strip, plan table, heatmap, recent demands, branch chips)
- `src/components/production/ProductionCharts.tsx` (recharts: `DemandProductionTrend`, `OrderStatusDonut`, `MonthlyDemandProduction`, `BranchCompareBars`)
- `src/components/production/ProductionPanel.tsx` (`Panel` card shell)
- `src/components/dashboard/LoginHistoryCard.tsx`
- `src/lib/queries.ts` → `useProductionOverview(token, branchId, period)`, key `qk.productionOverview(branchId, period)`, TanStack Query, `LIVE_STALE_TIME`
- Theme: `src/app/globals.css` (`--chart-1..5`, light/dark), shadcn `Skeleton`, Plus Jakarta Sans

Server (`backend/`)
- `src/routes/production.routes.ts` → `GET /api/production/overview` (roles: `super_admin`, `production_user` only)
- SQL: `production_demand_overview` (mig. 112), `production_dashboard_week` (140), `production_dashboard_series` (141), `production_stock_availability` (90)
- `src/services/return-stock.service.ts` (`getReturnStockTotal`), `src/shared/utils/stock.ts` (`LOW_STOCK_THRESHOLD = 5`)
- Tests: `node:test` under `src/services/__tests__/`

Chart library: **recharts 2.15**, already lazy-loaded with `next/dynamic`. Reused; nothing added.

## Endpoints

All new, all under the existing production router (same auth and roles). `/api/production/overview` stays as is because nothing else is removed.

| Endpoint | Backed by |
|---|---|
| `GET /api/production/dashboard/received-demand?period=&branchId=` | new SQL fn `production_dash_received_demand` |
| `GET /api/production/dashboard/branch-summary?period=` | new SQL fn `production_dash_branch_summary` |
| `GET /api/production/dashboard/repaired-stock?period=&branchId=` | **blocked, no data source** |
| `GET /api/production/dashboard/return-stock?period=&branchId=` | new SQL fn `production_dash_return_stock` + `return_stock` |
| `GET /api/production/dashboard/current-stock?branchId=` | `production_stock_availability` + `stock` |

Each returns `{ kpis, series, breakdown, comparePrevious }`. Period windows reuse the route's existing business-day arithmetic (`businessDateStr`, Asia/Karachi, 02:00 rollover, Monday-start weeks, compared with the same stretch of the previous period). The new SQL functions are `create or replace function` only: no table or column changes.

## Metric sources

**Received Demand** (`production_orders` + `production_order_items`, `status <> 'cancelled'`, `business_date` in window)
- Units received = Σ `items.qty`
- Orders received = count of orders
- Avg units per order = units ÷ orders
- Pending verification = orders with `status = 'awaiting_verification'`
- Rejected = orders with `status = 'rejected'`
- Stacked columns by `status`: Waiting (`pending`), Sent (`awaiting_verification`), Verified, Delivered (`approved`), Rejected. Daily, weekly for "This month".

**Branch-wise** (active `branches`, so zero-activity branches are listed too)
- Demanded = Σ `qty`; Delivered = Σ `approved_qty` on `verified`/`approved` orders (the definition migration 140 already uses)
- Returned = Σ `production_returns.qty`, `status = 'accepted'`
- Fulfilment % = delivered ÷ demanded; sparkline = daily demanded; last submission = max `submitted_at`

**Return Stock** (`production_returns`, `status = 'accepted'`)
- Units returned, top branch, top product; return rate = returned ÷ delivered (same window)
- Branch return stock on hand = Σ `return_stock.balance` (live)

**Current Stock** (live, ignores the period)
- Production stock = Σ `production_stock_availability.available` (already used for the "Available prod. stock" card; can be negative per product)
- Branch stock = Σ `stock.balance`
- Low stock = 0 < total < `LOW_STOCK_THRESHOLD` (existing shared constant, **5**); out of stock = total ≤ 0

## Bugs found

1. **"Weekly production 0" / "Today's production 0" beside "Produced 5,462".** The strip sums `production_stock_history` in Node from an unbounded, unordered `select` since the 1st of the month. PostgREST caps that at 1,000 rows and there are **1,713** this month, so this week's rows were never returned. The DB shows 5,462 prepared this week and 703 today. Fix: the strip reads the same SQL aggregate as the KPI card.
2. **"Fulfilment rate 100%".** With all branches selected, the card computes (produced + available pool stock) ÷ demand and clamps it to 100%. That measures supply coverage, not fulfilment. Fix: delivered ÷ demanded everywhere, with that definition in the tooltip.
3. **Monthly chart zeros, Nov to Jul.** These are real. The first production order is dated 2026-08-02, so this is not a timezone or query bug. Fix: hide zero labels as asked.

## Blocking questions

1. **Repaired Stock has no data source.** Nothing in the schema records a repair. The closest fields are:
   - `production_returns.disposition` = `saleable | damaged | expired`. All 260 rows are `saleable`, even the ~80 whose free-text reason says "Expired" or "Damaged".
   - `return_stock_history` movements of type `transfer_out` (Return Stock → Production Stock, mig. 139). There are **0** rows.
   - Smallest change: add `'repaired'` to the `production_return_disposition` enum (additive, one line), and treat a `transfer_return_stock_to_production` of a repaired return as "sent back to stock". The section would read 0 until staff start recording it.
2. **Return reason is free text** ("Expired", "Exp", "Expeir", "damage/expired", 116 blank). The donut either uses branch, which the prompt allows as the fallback, or buckets reasons by keyword into Expired, Damaged, Unsold, Other, and Not given.
3. **The web client has no test runner.** The component tests need new dev dependencies: `vitest`, `@testing-library/react`, `jsdom`.
