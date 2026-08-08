/* inventory-pro — data layer
 * Plain-script global `Store` (no modules, so file:// works everywhere).
 * Owns: products, movements, suppliers, localStorage persistence, seed data,
 * valuation math and CSV/JSON serialization. No DOM access in this file.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "inventory-pro:v1";

  /** In-memory state. `seq` mints ids; movements keep `stockAfter` so the log
   *  is self-contained and stays correct even after restore. */
  let state = null;

  function uid(prefix) {
    state.seq += 1;
    return prefix + "-" + state.seq.toString(36) + Date.now().toString(36).slice(-4);
  }

  /* ---------------- seed data ---------------- */

  function daysAgo(n, hour) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour == null ? 10 : hour, Math.floor(Math.random() * 50) + 5, 0, 0);
    return d.toISOString();
  }

  function seed() {
    const suppliers = [
      { id: "sup-1", name: "Gulf Tech Trading", contact: "Omar Haddad", email: "omar@gulftech.ae", phone: "+971 4 555 0182" },
      { id: "sup-2", name: "Emirates Electronics LLC", contact: "Sara Nair", email: "sara@emirelec.com", phone: "+971 50 882 4410" },
      { id: "sup-3", name: "Desert Peak Supplies", contact: "James Whitfield", email: "james@desertpeak.co", phone: "+971 55 301 7788" },
      { id: "sup-4", name: "Nimbus Wholesale FZE", contact: "Lina Farouk", email: "lina@nimbuswholesale.com", phone: "+971 4 320 9961" }
    ];

    // sku, name, category, supplierId, cost, sale, stock, reorder
    const productsRaw = [
      ["WB-1001", "Aurora Wireless Mouse", "Accessories", "sup-1", 34, 69, 142, 40],
      ["WB-1002", "Volt 65W USB-C Charger", "Power", "sup-2", 22, 49, 88, 30],
      ["WB-1003", "Nimbus Mechanical Keyboard", "Accessories", "sup-1", 95, 179, 12, 20],
      ["WB-1004", "Echo Pods ANC Earbuds", "Audio", "sup-2", 78, 159, 0, 25],
      ["WB-1005", "Halo 27\" QHD Monitor", "Displays", "sup-3", 410, 649, 34, 10],
      ["WB-1006", "Terra Laptop Stand", "Accessories", "sup-3", 18, 45, 210, 60],
      ["WB-1007", "Pulse 10K Power Bank", "Power", "sup-2", 30, 65, 18, 25],
      ["WB-1008", "Drift USB-C Hub 7-in-1", "Connectivity", "sup-1", 42, 89, 96, 35],
      ["WB-1009", "Aria Bluetooth Speaker", "Audio", "sup-4", 55, 119, 41, 15],
      ["WB-1010", "Stratus 1TB NVMe SSD", "Storage", "sup-4", 145, 249, 57, 20],
      ["WB-1011", "Kestrel Webcam 4K", "Video", "sup-3", 88, 169, 9, 12],
      ["WB-1012", "Onyx HDMI Cable 2m", "Connectivity", "sup-1", 6, 19, 380, 100],
      ["WB-1013", "Zephyr Laptop Sleeve 15\"", "Accessories", "sup-4", 14, 39, 74, 30],
      ["WB-1014", "Flux GaN Wall Charger 100W", "Power", "sup-2", 48, 99, 22, 20],
      ["WB-1015", "Lumen Desk Lamp Pro", "Office", "sup-3", 36, 79, 15, 15]
    ];
    const products = productsRaw.map(function (r, i) {
      return {
        id: "p-" + (i + 1),
        sku: r[0], name: r[1], category: r[2], supplierId: r[3],
        cost: r[4], price: r[5], stock: r[6], reorder: r[7]
      };
    });

    // A plausible recent movement history so dashboard/movers have content.
    const movesRaw = [
      [0, "in", 60, "PO #1042 restock", 28],
      [0, "out", 35, "Retail sales batch", 12],
      [0, "out", 28, "Online orders", 6],
      [1, "in", 50, "PO #1044", 25],
      [1, "out", 22, "Retail sales batch", 9],
      [2, "out", 30, "Corporate order — Al Noor LLC", 15],
      [2, "out", 18, "Online orders", 3],
      [3, "out", 25, "Retail sales batch", 4],
      [3, "adjust", 0, "Cycle count — shrinkage write-off", 2],
      [4, "in", 24, "PO #1047", 20],
      [4, "out", 14, "Online orders", 7],
      [6, "out", 19, "Retail sales batch", 5],
      [7, "in", 40, "PO #1049", 16],
      [7, "out", 26, "Online orders", 4],
      [8, "out", 21, "Retail sales batch", 11],
      [9, "in", 30, "PO #1051", 8],
      [9, "out", 17, "Online orders", 2],
      [10, "out", 15, "Retail sales batch", 6],
      [13, "in", 100, "PO #1053 bulk", 18],
      [13, "out", 45, "Weekend promo", 1],
      [14, "out", 12, "Retail sales batch", 3],
      [5, "out", 30, "B2B order — Meridian Group", 13]
    ];
    const movements = movesRaw.map(function (m, i) {
      const p = products[m[0]];
      // Seeded log is illustrative: stockAfter points at the current level.
      // Live movements (recordMovement) compute stockAfter exactly.
      return {
        id: "mv-" + (i + 1),
        productId: p.id,
        type: m[1],
        qty: m[2],
        reason: m[3],
        date: daysAgo(m[4]),
        stockAfter: p.stock
      };
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });

    return {
      seq: 1000,
      products: products,
      suppliers: suppliers,
      movements: movements
    };
  }

  /* ---------------- persistence ---------------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.suppliers)) {
          state = parsed;
          if (!Array.isArray(state.movements)) state.movements = [];
          return;
        }
      }
    } catch (e) {
      console.warn("inventory-pro: could not load saved data, reseeding.", e);
    }
    state = seed();
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("inventory-pro: save failed (storage full?)", e);
    }
  }

  /* ---------------- products ---------------- */

  function addProduct(data) {
    if (state.products.some(function (p) { return p.sku.toLowerCase() === data.sku.toLowerCase(); })) {
      throw new Error("SKU " + data.sku + " already exists.");
    }
    const p = {
      id: uid("p"),
      sku: data.sku.trim(),
      name: data.name.trim(),
      category: data.category.trim(),
      supplierId: data.supplierId || null,
      cost: Math.max(0, Number(data.cost) || 0),
      price: Math.max(0, Number(data.price) || 0),
      stock: Math.max(0, Math.round(Number(data.stock) || 0)),
      reorder: Math.max(0, Math.round(Number(data.reorder) || 0))
    };
    state.products.push(p);
    save();
    return p;
  }

  function updateProduct(id, data) {
    const p = getProduct(id);
    if (!p) throw new Error("Product not found.");
    const clash = state.products.some(function (o) {
      return o.id !== id && o.sku.toLowerCase() === data.sku.toLowerCase();
    });
    if (clash) throw new Error("SKU " + data.sku + " already exists.");
    p.sku = data.sku.trim();
    p.name = data.name.trim();
    p.category = data.category.trim();
    p.supplierId = data.supplierId || null;
    p.cost = Math.max(0, Number(data.cost) || 0);
    p.price = Math.max(0, Number(data.price) || 0);
    p.stock = Math.max(0, Math.round(Number(data.stock) || 0));
    p.reorder = Math.max(0, Math.round(Number(data.reorder) || 0));
    save();
    return p;
  }

  function deleteProduct(id) {
    state.products = state.products.filter(function (p) { return p.id !== id; });
    state.movements = state.movements.filter(function (m) { return m.productId !== id; });
    save();
  }

  function getProduct(id) {
    return state.products.find(function (p) { return p.id === id; }) || null;
  }

  /* ---------------- movements ---------------- */

  /** Records a movement and applies it to stock atomically.
   *  type "in": +qty · "out": -qty (clamped at 0) · "adjust": set absolute count. */
  function recordMovement(data) {
    const p = getProduct(data.productId);
    if (!p) throw new Error("Product not found.");
    const qty = Math.round(Number(data.qty));
    if (!Number.isFinite(qty) || qty < 0 || (data.type !== "adjust" && qty === 0)) {
      throw new Error("Quantity must be a positive whole number.");
    }
    if (data.type === "in") p.stock += qty;
    else if (data.type === "out") p.stock = Math.max(0, p.stock - qty);
    else if (data.type === "adjust") p.stock = qty;
    else throw new Error("Unknown movement type.");

    const mv = {
      id: uid("mv"),
      productId: p.id,
      type: data.type,
      qty: qty,
      reason: (data.reason || "").trim(),
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      stockAfter: p.stock
    };
    state.movements.unshift(mv);
    save();
    return mv;
  }

  /* ---------------- suppliers ---------------- */

  function addSupplier(data) {
    if (state.suppliers.some(function (s) { return s.name.toLowerCase() === data.name.toLowerCase(); })) {
      throw new Error("Supplier " + data.name + " already exists.");
    }
    const s = {
      id: uid("sup"),
      name: data.name.trim(),
      contact: (data.contact || "").trim(),
      email: (data.email || "").trim(),
      phone: (data.phone || "").trim()
    };
    state.suppliers.push(s);
    save();
    return s;
  }

  function updateSupplier(id, data) {
    const s = state.suppliers.find(function (x) { return x.id === id; });
    if (!s) throw new Error("Supplier not found.");
    s.name = data.name.trim();
    s.contact = (data.contact || "").trim();
    s.email = (data.email || "").trim();
    s.phone = (data.phone || "").trim();
    save();
    return s;
  }

  function deleteSupplier(id) {
    state.products.forEach(function (p) {
      if (p.supplierId === id) p.supplierId = null;
    });
    state.suppliers = state.suppliers.filter(function (s) { return s.id !== id; });
    save();
  }

  function getSupplier(id) {
    return state.suppliers.find(function (s) { return s.id === id; }) || null;
  }

  /* ---------------- reporting ---------------- */

  function valuation() {
    let cost = 0, sale = 0;
    state.products.forEach(function (p) {
      cost += p.cost * p.stock;
      sale += p.price * p.stock;
    });
    const margin = sale > 0 ? ((sale - cost) / sale) * 100 : 0;
    return { cost: cost, sale: sale, margin: margin };
  }

  function lowStock() {
    return state.products
      .filter(function (p) { return p.stock <= p.reorder; })
      .sort(function (a, b) { return (a.stock - a.reorder) - (b.stock - b.reorder); });
  }

  /** Units moved per product over the trailing `days` window (in + out; adjust excluded). */
  function topMovers(days, limit) {
    const cutoff = Date.now() - days * 864e5;
    const totals = {};
    state.movements.forEach(function (m) {
      if (m.type === "adjust") return;
      if (new Date(m.date).getTime() < cutoff) return;
      totals[m.productId] = (totals[m.productId] || 0) + m.qty;
    });
    return Object.keys(totals)
      .map(function (pid) {
        return { product: getProduct(pid), qty: totals[pid] };
      })
      .filter(function (r) { return r.product; })
      .sort(function (a, b) { return b.qty - a.qty; })
      .slice(0, limit || 5);
  }

  /** Counts for the stock-health donut: healthy / low / out. */
  function stockHealth() {
    let ok = 0, low = 0, out = 0;
    state.products.forEach(function (p) {
      if (p.stock === 0) out++;
      else if (p.stock <= p.reorder) low++;
      else ok++;
    });
    return { ok: ok, low: low, out: out };
  }

  /* ---------------- import / export ---------------- */

  function escapeCSV(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    const lines = [headers.map(escapeCSV).join(",")];
    rows.forEach(function (r) { lines.push(r.map(escapeCSV).join(",")); });
    return "\uFEFF" + lines.join("\r\n"); // BOM so Excel opens UTF-8 cleanly
  }

  function productsCSV() {
    return toCSV(
      ["SKU", "Name", "Category", "Supplier", "Cost", "Sale Price", "Stock", "Reorder Level", "Margin %"],
      state.products.map(function (p) {
        const s = getSupplier(p.supplierId);
        const margin = p.price > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : "0.0";
        return [p.sku, p.name, p.category, s ? s.name : "", p.cost.toFixed(2), p.price.toFixed(2), p.stock, p.reorder, margin];
      })
    );
  }

  function movementsCSV() {
    return toCSV(
      ["Date", "SKU", "Product", "Type", "Qty", "Reason", "Stock After"],
      state.movements.map(function (m) {
        const p = getProduct(m.productId);
        return [new Date(m.date).toLocaleString(), p ? p.sku : "(deleted)", p ? p.name : "(deleted)", m.type, m.qty, m.reason, m.stockAfter];
      })
    );
  }

  function backupJSON() {
    return JSON.stringify({
      app: "inventory-pro",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state
    }, null, 2);
  }

  /** Accepts either a full backup envelope or a bare state object. Returns a summary. */
  function restoreJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("Not a valid JSON file.");
    }
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.suppliers)) {
      throw new Error("Backup file is missing products/suppliers data.");
    }
    state = {
      seq: Number(data.seq) || 1000,
      products: data.products,
      suppliers: data.suppliers,
      movements: Array.isArray(data.movements) ? data.movements : []
    };
    save();
    return {
      products: state.products.length,
      suppliers: state.suppliers.length,
      movements: state.movements.length
    };
  }

  /* ---------------- public API ---------------- */

  window.Store = {
    load: load,
    save: save,
    get state() { return state; },
    addProduct: addProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    getProduct: getProduct,
    recordMovement: recordMovement,
    addSupplier: addSupplier,
    updateSupplier: updateSupplier,
    deleteSupplier: deleteSupplier,
    getSupplier: getSupplier,
    valuation: valuation,
    lowStock: lowStock,
    topMovers: topMovers,
    stockHealth: stockHealth,
    productsCSV: productsCSV,
    movementsCSV: movementsCSV,
    backupJSON: backupJSON,
    restoreJSON: restoreJSON
  };
})();
