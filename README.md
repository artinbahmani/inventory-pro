# inventory-pro

Inventory and stock management: live valuation, stock movement log, low-stock alerts, suppliers, barcode-style search. Vanilla JS, no dependencies.

## Features

- Products table with SKU, name, category, supplier, cost/sale price, stock on hand and reorder level — sortable by any column
- Stock movement log (in / out / adjust) with quantity, reason and date; stock on hand updates automatically and each entry records the resulting level
- Low-stock alerts panel and header card for everything at or below reorder level
- Live inventory valuation: total cost value, potential sale value, and potential margin (absolute + %)
- Suppliers manager with contact details and per-supplier product counts
- Barcode-style instant search (monospace input, Enter flashes the first match — works with handheld scanners), plus category filter chips
- Dashboard with top movers (last 30 days) and a stock-health donut rendered as inline SVG
- CSV export of products and movements (UTF-8 BOM, Excel-friendly)
- Full JSON backup / restore with validation and a restore summary
- localStorage persistence with realistic sample seed data on first run

## Run

Open index.html in any modern browser. No build step, no dependencies.

## Controls / Usage

- `/` — focus the product search · `Esc` — clear search / dismiss
- `n` — new product · `m` — new stock movement
- Click any column header to sort; click again to reverse
- Use the **In / Out / Adjust** chips on the Movements tab to filter the log
- "Adjust" sets an exact stock count (use for cycle counts); "Out" clamps at zero

## Tech notes

- Split architecture: `store.js` owns all state, persistence and reporting math (no DOM); `app.js` owns rendering and events — plain script tags so everything works over `file://`
- Movements store `stockAfter` at write time, so the log stays self-consistent even after a JSON restore
- The donut is generated as inline SVG arc segments (`stroke-dasharray` fractions), no chart library
- Restore accepts either the app's backup envelope or a bare state object, and validates before touching live data

## Roadmap

- Per-product movement history drawer with a small sparkline of stock over time
- Purchase-order workflow: draft PO per supplier, one-click receive into stock
- Configurable currency, locale and low-stock thresholds per category
- CSV import (products bulk upload) to complement the existing exports
- Multi-location / bin tracking with transfers between locations
- Optional barcode generation (Code39 in SVG) for printable SKU labels
