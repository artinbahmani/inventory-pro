/* inventory-pro — UI layer
 * Depends on the global `Store` from store.js (loaded first via plain script tag).
 * Owns all DOM rendering, filtering/sorting state, modals, export/import and
 * keyboard shortcuts. No persistence logic lives here.
 */
(function () {
  "use strict";

  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ---------------- view state (not persisted) ---------------- */
  const view = {
    search: "",
    category: "all",
    sortKey: "sku",
    sortDir: 1,
    mSearch: "",
    mType: "all",
    mSortKey: "date",
    mSortDir: -1,
    sSearch: "",
    editingProductId: null,
    editingSupplierId: null
  };

  /* ---------------- helpers ---------------- */

  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  function fmtMoney(n) { return money.format(n); }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
           d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
  }

  function stockClass(p) {
    if (p.stock === 0) return "stock-out";
    if (p.stock <= p.reorder) return "stock-low";
    return "stock-ok";
  }

  /* ---------------- rendering: header / dashboard ---------------- */

  function renderValuation() {
    const v = Store.valuation();
    $("#valCost").textContent = fmtMoney(v.cost);
    $("#valSale").textContent = fmtMoney(v.sale);
    $("#valMargin").textContent = fmtMoney(v.sale - v.cost) + "  (" + v.margin.toFixed(1) + "%)";
    const alerts = Store.lowStock().length;
    $("#valAlerts").textContent = alerts;
    $("#lowStockCard").classList.toggle("has-alerts", alerts > 0);
  }

  function renderDonut() {
    const h = Store.stockHealth();
    const total = Math.max(1, h.ok + h.low + h.out);
    const R = 44, C = 2 * Math.PI * R;
    const segs = [
      { n: h.ok, color: "#2ea86f", label: "Healthy" },
      { n: h.low, color: "#e8b23f", label: "Low stock" },
      { n: h.out, color: "#e5534b", label: "Out of stock" }
    ];
    let offset = 0;
    let svg = '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="#2a3542" stroke-width="14"/>';
    segs.forEach(function (s) {
      if (s.n === 0) return;
      const len = (s.n / total) * C;
      svg += '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + s.color +
             '" stroke-width="14" stroke-dasharray="' + len.toFixed(2) + " " + (C - len).toFixed(2) +
             '" stroke-dashoffset="' + (-offset).toFixed(2) +
             '" transform="rotate(-90 60 60)" stroke-linecap="butt"/>';
      offset += len;
    });
    svg += '<text x="60" y="57" text-anchor="middle" fill="#e6edf3" font-size="20" font-weight="700">' +
           (h.ok + h.low + h.out) + "</text>" +
           '<text x="60" y="74" text-anchor="middle" fill="#8b98a9" font-size="9.5">SKUs</text>';
    $("#donut").innerHTML = svg;
    $("#donutLegend").innerHTML = segs.map(function (s) {
      return '<div class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' +
             s.label + " <b>" + s.n + "</b></div>";
    }).join("");
  }

  function renderTopMovers() {
    const movers = Store.topMovers(30, 5);
    $("#topMovers").innerHTML = movers.length
      ? movers.map(function (m) {
          return '<li><span class="m-sku">' + esc(m.product.sku) + "</span>" + esc(m.product.name) +
                 '<span class="m-qty">' + m.qty + " u</span></li>";
        }).join("")
      : '<li class="hint">No stock moved in the last 30 days.</li>';
  }

  function renderLowStock() {
    const low = Store.lowStock();
    $("#lowStockList").innerHTML = low.length
      ? low.map(function (p) {
          const out = p.stock === 0;
          return '<li class="' + (out ? "out" : "") + '"><span><b>' + esc(p.sku) + "</b> " + esc(p.name) +
                 '</span><span class="a-stock">' + (out ? "OUT" : p.stock + " / " + p.reorder) + "</span></li>";
        }).join("")
      : '<li class="alerts-ok">All products above reorder level. ✓</li>';
  }

  /* ---------------- rendering: products ---------------- */

  function productMargin(p) {
    return p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
  }

  function filteredProducts() {
    const q = view.search.trim().toLowerCase();
    let list = Store.state.products.filter(function (p) {
      if (view.category !== "all" && p.category !== view.category) return false;
      if (!q) return true;
      const sup = Store.getSupplier(p.supplierId);
      return p.sku.toLowerCase().indexOf(q) !== -1 ||
             p.name.toLowerCase().indexOf(q) !== -1 ||
             (sup && sup.name.toLowerCase().indexOf(q) !== -1);
    });
    const k = view.sortKey, dir = view.sortDir;
    list.sort(function (a, b) {
      let va, vb;
      if (k === "supplier") {
        const sa = Store.getSupplier(a.supplierId), sb = Store.getSupplier(b.supplierId);
        va = sa ? sa.name : ""; vb = sb ? sb.name : "";
      } else if (k === "margin") {
        va = productMargin(a); vb = productMargin(b);
      } else {
        va = a[k]; vb = b[k];
      }
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
    return list;
  }

  function renderProducts() {
    const list = filteredProducts();
    const body = $("#productsBody");
    body.innerHTML = list.map(function (p) {
      const sup = Store.getSupplier(p.supplierId);
      const margin = productMargin(p);
      return "<tr data-id='" + p.id + "'>" +
        "<td class='sku'>" + esc(p.sku) + "</td>" +
        "<td>" + esc(p.name) + "</td>" +
        "<td><span class='badge cat'>" + esc(p.category) + "</span></td>" +
        "<td>" + (sup ? esc(sup.name) : "<span class='hint'>—</span>") + "</td>" +
        "<td class='num'>" + fmtMoney(p.cost) + "</td>" +
        "<td class='num'>" + fmtMoney(p.price) + "</td>" +
        "<td class='num'><span class='stock-pill " + stockClass(p) + "'>" + p.stock + "</span></td>" +
        "<td class='num'>" + p.reorder + "</td>" +
        "<td class='num'>" + margin.toFixed(1) + "%</td>" +
        "<td><div class='row-actions'>" +
          "<button class='icon-btn' data-act='move' title='Record movement'>±</button>" +
          "<button class='icon-btn' data-act='edit'>Edit</button>" +
          "<button class='icon-btn del' data-act='del'>✕</button>" +
        "</div></td></tr>";
    }).join("");
    $("#productsEmpty").hidden = list.length > 0;

    $$("#productsTable th[data-sort]").forEach(function (th) {
      th.classList.toggle("sorted-asc", th.dataset.sort === view.sortKey && view.sortDir === 1);
      th.classList.toggle("sorted-desc", th.dataset.sort === view.sortKey && view.sortDir === -1);
    });
  }

  function renderCategoryChips() {
    const cats = [];
    Store.state.products.forEach(function (p) {
      if (cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    cats.sort();
    if (view.category !== "all" && cats.indexOf(view.category) === -1) view.category = "all";
    $("#categoryChips").innerHTML =
      '<button class="chip' + (view.category === "all" ? " active" : "") + '" data-cat="all">All</button>' +
      cats.map(function (c) {
        return '<button class="chip' + (view.category === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
  }

  /* ---------------- rendering: movements ---------------- */

  function filteredMovements() {
    const q = view.mSearch.trim().toLowerCase();
    let list = Store.state.movements.filter(function (m) {
      if (view.mType !== "all" && m.type !== view.mType) return false;
      if (!q) return true;
      const p = Store.getProduct(m.productId);
      return (p && (p.sku.toLowerCase().indexOf(q) !== -1 || p.name.toLowerCase().indexOf(q) !== -1)) ||
             m.reason.toLowerCase().indexOf(q) !== -1;
    });
    const k = view.mSortKey, dir = view.mSortDir;
    list.sort(function (a, b) {
      let va, vb;
      if (k === "sku" || k === "product") {
        const pa = Store.getProduct(a.productId), pb = Store.getProduct(b.productId);
        va = pa ? (k === "sku" ? pa.sku : pa.name) : "";
        vb = pb ? (k === "sku" ? pb.sku : pb.name) : "";
      } else {
        va = a[k]; vb = b[k];
      }
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
    return list;
  }

  function renderMovements() {
    const list = filteredMovements();
    $("#movementsBody").innerHTML = list.map(function (m) {
      const p = Store.getProduct(m.productId);
      const label = { in: "In", out: "Out", adjust: "Adjust" }[m.type];
      const qtyText = m.type === "in" ? "+" + m.qty : m.type === "out" ? "−" + m.qty : "=" + m.qty;
      return "<tr>" +
        "<td>" + fmtDate(m.date) + "</td>" +
        "<td class='sku'>" + (p ? esc(p.sku) : "<span class='hint'>(deleted)</span>") + "</td>" +
        "<td>" + (p ? esc(p.name) : "") + "</td>" +
        "<td><span class='badge t-" + m.type + "'>" + label + "</span></td>" +
        "<td class='num'>" + qtyText + "</td>" +
        "<td>" + esc(m.reason) + "</td>" +
        "<td class='num'>" + m.stockAfter + "</td></tr>";
    }).join("");
    $("#movementsEmpty").hidden = list.length > 0;

    $$("#movementsTable th[data-msort]").forEach(function (th) {
      th.classList.toggle("sorted-asc", th.dataset.msort === view.mSortKey && view.mSortDir === 1);
      th.classList.toggle("sorted-desc", th.dataset.msort === view.mSortKey && view.mSortDir === -1);
    });
  }

  /* ---------------- rendering: suppliers ---------------- */

  function renderSuppliers() {
    const q = view.sSearch.trim().toLowerCase();
    const list = Store.state.suppliers.filter(function (s) {
      return !q || s.name.toLowerCase().indexOf(q) !== -1 ||
             s.contact.toLowerCase().indexOf(q) !== -1 ||
             s.email.toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    $("#suppliersBody").innerHTML = list.map(function (s) {
      const count = Store.state.products.filter(function (p) { return p.supplierId === s.id; }).length;
      return "<tr data-id='" + s.id + "'>" +
        "<td><b>" + esc(s.name) + "</b></td>" +
        "<td>" + esc(s.contact) + "</td>" +
        "<td>" + (s.email ? "<a href='mailto:" + esc(s.email) + "' style='color:var(--accent)'>" + esc(s.email) + "</a>" : "") + "</td>" +
        "<td>" + esc(s.phone) + "</td>" +
        "<td class='num'>" + count + "</td>" +
        "<td><div class='row-actions'>" +
          "<button class='icon-btn' data-act='edit'>Edit</button>" +
          "<button class='icon-btn del' data-act='del'>✕</button>" +
        "</div></td></tr>";
    }).join("");
    $("#suppliersEmpty").hidden = list.length > 0;
  }

  function renderAll() {
    renderValuation();
    renderDonut();
    renderTopMovers();
    renderLowStock();
    renderCategoryChips();
    renderProducts();
    renderMovements();
    renderSuppliers();
  }

  /* ---------------- modals ---------------- */

  function openModal(id) {
    const dlg = $(id);
    if (typeof dlg.showModal === "function") dlg.showModal();
  }
  function closeModal(dlg) { dlg.close(); }

  function fillProductSupplierSelect(selectedId) {
    const sel = $("#productSupplierSelect");
    sel.innerHTML = '<option value="">— none —</option>' +
      Store.state.suppliers
        .slice()
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === selectedId ? " selected" : "") + ">" + esc(s.name) + "</option>";
        }).join("");
  }

  function fillCategoryDatalist() {
    const cats = [];
    Store.state.products.forEach(function (p) {
      if (cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    $("#categoryList").innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("");
  }

  function openProductModal(productId) {
    view.editingProductId = productId || null;
    const form = $("#productForm");
    form.reset();
    $("#productModalTitle").textContent = productId ? "Edit product" : "Add product";
    fillProductSupplierSelect(null);
    fillCategoryDatalist();
    if (productId) {
      const p = Store.getProduct(productId);
      if (!p) return;
      form.sku.value = p.sku;
      form.name.value = p.name;
      form.category.value = p.category;
      fillProductSupplierSelect(p.supplierId);
      form.cost.value = p.cost;
      form.price.value = p.price;
      form.stock.value = p.stock;
      form.reorder.value = p.reorder;
    }
    openModal("#productModal");
    form.sku.focus();
  }

  function openMovementModal(productId) {
    const form = $("#movementForm");
    form.reset();
    const sel = $("#movementProductSelect");
    sel.innerHTML = Store.state.products
      .slice()
      .sort(function (a, b) { return a.sku.localeCompare(b.sku); })
      .map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === productId ? " selected" : "") + ">" +
               esc(p.sku) + " — " + esc(p.name) + " (" + p.stock + ")" + "</option>";
      }).join("");
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    form.date.value = now.toISOString().slice(0, 16);
    updateMovementPreview();
    openModal("#movementModal");
  }

  function updateMovementPreview() {
    const form = $("#movementForm");
    const p = Store.getProduct(form.productId.value);
    if (!p) { $("#movementPreview").textContent = ""; return; }
    const qty = Math.round(Number(form.qty.value) || 0);
    const type = form.type.value;
    form.qty.min = type === "adjust" ? "0" : "1"; // adjust may set an exact count of 0
    $("#qtyLabel").firstChild.textContent = type === "adjust" ? "New exact stock count" : "Quantity";
    let after = p.stock;
    if (type === "in") after = p.stock + qty;
    else if (type === "out") after = Math.max(0, p.stock - qty);
    else after = qty;
    $("#movementPreview").textContent =
      p.name + ": current stock " + p.stock + " → " + after + " after this movement" +
      (after <= p.reorder ? "  ⚠ will be at/below reorder level (" + p.reorder + ")" : "");
  }

  function openSupplierModal(supplierId) {
    view.editingSupplierId = supplierId || null;
    const form = $("#supplierForm");
    form.reset();
    $("#supplierModalTitle").textContent = supplierId ? "Edit supplier" : "Add supplier";
    if (supplierId) {
      const s = Store.getSupplier(supplierId);
      if (!s) return;
      form.name.value = s.name;
      form.contact.value = s.contact;
      form.email.value = s.email;
      form.phone.value = s.phone;
    }
    openModal("#supplierModal");
    form.name.focus();
  }

  /* ---------------- exports / backup ---------------- */

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function bindHeaderActions() {
    $("#btnExportProducts").addEventListener("click", function () {
      download("inventory-products-" + stamp() + ".csv", Store.productsCSV(), "text/csv;charset=utf-8");
      toast("Products CSV exported.");
    });
    $("#btnExportMovements").addEventListener("click", function () {
      download("inventory-movements-" + stamp() + ".csv", Store.movementsCSV(), "text/csv;charset=utf-8");
      toast("Movements CSV exported.");
    });
    $("#btnBackup").addEventListener("click", function () {
      download("inventory-pro-backup-" + stamp() + ".json", Store.backupJSON(), "application/json");
      toast("JSON backup downloaded.");
    });
    $("#btnRestore").addEventListener("click", function () { $("#restoreFile").click(); });
    $("#restoreFile").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const sum = Store.restoreJSON(String(reader.result));
          renderAll();
          toast("Restored " + sum.products + " products, " + sum.suppliers + " suppliers, " + sum.movements + " movements.");
        } catch (err) {
          toast("Restore failed: " + err.message, true);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  /* ---------------- events ---------------- */

  function bindTabs() {
    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $$(".tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        $$(".tab-pane").forEach(function (p) { p.classList.toggle("active", p.id === "tab-" + tab.dataset.tab); });
      });
    });
    $("#lowStockCard").addEventListener("click", function () {
      $("#search").value = "";
      view.search = "";
      view.category = "all";
      renderCategoryChips();
      renderProducts();
    });
  }

  function bindProductsTab() {
    $("#search").addEventListener("input", function (e) {
      view.search = e.target.value;
      renderProducts();
    });
    // Barcode-style: scanners terminate with Enter — jump to & flash first match.
    $("#search").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = $("#productsBody tr");
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.classList.remove("flash");
        void first.offsetWidth; // restart animation
        first.classList.add("flash");
      }
    });

    $("#categoryChips").addEventListener("click", function (e) {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      view.category = chip.dataset.cat;
      renderCategoryChips();
      renderProducts();
    });

    $$("#productsTable th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        const k = th.dataset.sort;
        if (view.sortKey === k) view.sortDir *= -1;
        else { view.sortKey = k; view.sortDir = 1; }
        renderProducts();
      });
    });

    $("#productsBody").addEventListener("click", function (e) {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      if (btn.dataset.act === "edit") openProductModal(id);
      else if (btn.dataset.act === "move") openMovementModal(id);
      else if (btn.dataset.act === "del") {
        const p = Store.getProduct(id);
        if (p && window.confirm("Delete " + p.sku + " — " + p.name + " and its movement history?")) {
          Store.deleteProduct(id);
          renderAll();
          toast("Product deleted.");
        }
      }
    });

    $("#btnAddProduct").addEventListener("click", function () { openProductModal(null); });
    $("#btnAddMovement").addEventListener("click", function () { openMovementModal(null); });
    $("#btnAddMovement2").addEventListener("click", function () { openMovementModal(null); });
  }

  function bindMovementsTab() {
    $("#movementSearch").addEventListener("input", function (e) {
      view.mSearch = e.target.value;
      renderMovements();
    });
    $("#movementTypeChips").addEventListener("click", function (e) {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      view.mType = chip.dataset.type;
      $$("#movementTypeChips .chip").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
      renderMovements();
    });
    $$("#movementsTable th[data-msort]").forEach(function (th) {
      th.addEventListener("click", function () {
        const k = th.dataset.msort;
        if (view.mSortKey === k) view.mSortDir *= -1;
        else { view.mSortKey = k; view.mSortDir = 1; }
        renderMovements();
      });
    });
  }

  function bindSuppliersTab() {
    $("#supplierSearch").addEventListener("input", function (e) {
      view.sSearch = e.target.value;
      renderSuppliers();
    });
    $("#btnAddSupplier").addEventListener("click", function () { openSupplierModal(null); });
    $("#suppliersBody").addEventListener("click", function (e) {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      if (btn.dataset.act === "edit") openSupplierModal(id);
      else if (btn.dataset.act === "del") {
        const s = Store.getSupplier(id);
        if (s && window.confirm("Delete supplier " + s.name + "? Its products will be kept but unlinked.")) {
          Store.deleteSupplier(id);
          renderAll();
          toast("Supplier deleted.");
        }
      }
    });
  }

  function bindForms() {
    $("#productForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const f = e.target;
      const data = {
        sku: f.sku.value, name: f.name.value, category: f.category.value,
        supplierId: f.supplier.value, cost: f.cost.value, price: f.price.value,
        stock: f.stock.value, reorder: f.reorder.value
      };
      try {
        if (view.editingProductId) {
          Store.updateProduct(view.editingProductId, data);
          toast("Product updated.");
        } else {
          Store.addProduct(data);
          toast("Product added.");
        }
        closeModal($("#productModal"));
        renderAll();
      } catch (err) {
        toast(err.message, true);
      }
    });

    $("#movementForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const f = e.target;
      try {
        Store.recordMovement({
          productId: f.productId.value,
          type: f.type.value,
          qty: f.qty.value,
          reason: f.reason.value,
          date: f.date.value
        });
        closeModal($("#movementModal"));
        renderAll();
        toast("Movement recorded — stock updated.");
      } catch (err) {
        toast(err.message, true);
      }
    });
    ["change", "input"].forEach(function (evt) {
      $("#movementForm").addEventListener(evt, updateMovementPreview);
    });

    $("#supplierForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const f = e.target;
      const data = { name: f.name.value, contact: f.contact.value, email: f.email.value, phone: f.phone.value };
      try {
        if (view.editingSupplierId) {
          Store.updateSupplier(view.editingSupplierId, data);
          toast("Supplier updated.");
        } else {
          Store.addSupplier(data);
          toast("Supplier added.");
        }
        closeModal($("#supplierModal"));
        renderAll();
      } catch (err) {
        toast(err.message, true);
      }
    });

    // All [data-close] buttons dismiss their parent dialog.
    $$("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.closest("dialog")); });
    });
  }

  function bindKeyboard() {
    document.addEventListener("keydown", function (e) {
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === "Escape" && inField) {
        document.activeElement.blur();
        return;
      }
      if (inField) return;
      if (e.key === "/") {
        e.preventDefault();
        $("#search").focus();
        $("#search").select();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openProductModal(null);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        openMovementModal(null);
      }
    });
    // Escape inside the search input clears it (standard barcode workflow reset).
    $("#search").addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.target.value = "";
        view.search = "";
        renderProducts();
        e.target.blur();
      }
    });
  }

  /* ---------------- boot ---------------- */

  Store.load();
  bindHeaderActions();
  bindTabs();
  bindProductsTab();
  bindMovementsTab();
  bindSuppliersTab();
  bindForms();
  bindKeyboard();
  renderAll();
})();
