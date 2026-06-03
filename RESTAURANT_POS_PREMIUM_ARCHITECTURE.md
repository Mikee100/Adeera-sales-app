# Premium Restaurant POS Architecture

## 1) Application Architecture

- Runtime:
  - Electron main process (device access, offline storage, printing, sync triggers)
  - Electron preload (secure bridge)
  - React renderer (POS UI)
- Frontend state and data:
  - Zustand: UI state (sidebar collapse, active module, payment modal state)
  - React Query: offline-first query cache over preload API methods
- UI framework:
  - Tailwind CSS utilities
  - Shadcn-style reusable primitives (`Button`, `Card`) using `cva`, `clsx`, `tailwind-merge`
  - Framer Motion for transitions and interaction polish
- Data flow:
  - UI -> React Query hooks -> `window.electronAPI.*` -> local DB/services
  - Sync layer can push/pull cloud deltas later without changing module boundaries

## 2) Folder Structure

```text
src/renderer/
  components/
    ui/
      button.tsx
      card.tsx
  lib/
    utils.ts
  restaurant/
    RestaurantRenderer.tsx
    PremiumRestaurantPOS.tsx
    useRestaurantUiStore.ts
  tailwind.css
```

## 3) Design System

- Color tokens:
  - Primary: #0F172A
  - Secondary: #4F46E5
  - Success: #10B981
  - Warning: #F59E0B
  - Danger: #EF4444
  - Background: #F8FAFC
  - Cards: #FFFFFF
  - Sidebar: #111827
- Typography scale:
  - Dashboard title: 32px
  - Section title: 24px
  - Card title: 18px
  - Body: 14px
  - Labels: 12px
- Touch target guidance:
  - Primary buttons and cards use 44px+ height targets

## 4) Reusable Components

- `Button` variants:
  - default, secondary, ghost, success, warning, danger
  - sizes: sm, md, lg, icon
- `Card` primitives:
  - Card, CardHeader, CardTitle, CardContent

## 5) POS Screen

- Split layout:
  - Left (menu): category tabs, product search, touch product cards
  - Right (order panel): draft items, quantity controls, totals, discount, tax, actions
- Action stack:
  - Hold Order
  - Save Draft
  - Split Bill
  - Apply Discount
  - Print Receipt
  - Complete Payment
  - Send Order

## 6) Dashboard

- KPI cards:
  - Today's Sales
  - Orders Today
  - Active Tables
  - Average Order Value
  - Top Selling Item
  - Inventory Alerts
- Includes trend bars and recent order feed

## 7) Table Management

- Floor-plan style cards with status colors:
  - Green (available)
  - Red (occupied)
  - Yellow (reserved)

## 8) Kitchen Display (KDS)

- Kanban lanes:
  - Open
  - SentToKitchen
  - Served
  - Closed
- Card stack per lane with item counts and table references

## 9) Inventory Module

- Product stock list with low stock highlighting
- Supplier and stock indicator scaffolding ready for extension

## 10) Reports Module

- Report launcher cards:
  - Daily, Weekly, Monthly sales
  - Product performance
  - Employee performance
  - Profit analysis

## 11) Responsive Layouts

- Sidebar collapse behavior
- Multi-breakpoint grid behavior from mobile -> desktop
- Sticky header and sticky order panel support high-speed cashier flow

## 12) Electron Desktop Optimizations

- Offline-first by default through local API calls
- Query stale-time and focus behavior tuned to prevent noisy refetches
- Modal and screen transitions are GPU-friendly and subtle
- Architecture prepared for deferred cloud sync orchestration
