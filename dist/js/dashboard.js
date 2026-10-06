import { auth, db, collection, getDocs, query, orderBy, where, limit } from './firebase.js';
import { money, todayStr, getExpiryInfo, getPaymentStatusInfo, esc } from './utils.js';
import { productsList, loadProducts } from './products.js';
import { customersList, loadCustomers } from './customers.js';
import { suppliersList, loadSuppliers } from './suppliers.js';
import { storeEvents } from './store.js';
import { getUserAccessGroup } from './auth.js';

let chartInstances = {};

// Reactive Store Event Subscriptions for real-time Dashboard KPIs
['stockUpdated', 'customerBalanceUpdated', 'supplierBalanceUpdated', 'invoiceSaved', 'purchaseSaved', 'productSaved'].forEach(event => {
  storeEvents.on(event, () => {
    // Refresh dashboard data reactively without full page reloads
    loadDashboardData();
  });
});

/**
 * Loads and calculates dashboard KPIs and renders charts efficiently.
 */
export async function loadDashboardData() {
  if (!auth || !auth.currentUser) return;
  try {
    const today = todayStr();
    // Get start of current month for monthly summary bounds
    const now = new Date();
    const firstDayOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Show loading state on KPI cards while fetching
    ['dashGstSales', 'dashNonGstSales', 'dashTotalSales', 'dashTodaySales', 'dashTodayPurchase', 'dashReceivables', 'dashPayables', 'dashStockValuation', 'dashExpiryAlerts', 'dashOverdueAlerts'].forEach(id => {
      setKPI(id, 'Loading...');
    });
    
    // Ensure products, customers, and suppliers lists are loaded for KPI calculation
    await Promise.all([
      (!productsList || productsList.length === 0) ? loadProducts(100) : Promise.resolve(),
      (!customersList || customersList.length === 0) ? loadCustomers(100) : Promise.resolve(),
      (!suppliersList || suppliersList.length === 0) ? loadSuppliers(100) : Promise.resolve()
    ]);

    // Fetch recent invoices (bounded query, up to 200 recent docs)
    const invSnap = await getDocs(query(
      collection(db, 'invoices'),
      orderBy('createdAt', 'desc'),
      limit(200)
    ));

    let todaySales = 0;
    let gstSales = 0;
    let nonGstSales = 0;
    let totalSales = 0;
    const dailySalesMap = {};
    const productSalesMap = {};
    const overdueAlertList = [];

    const activeGroup = getUserAccessGroup();
    const dashTitle = document.getElementById('dashboardMainTitle');
    if (dashTitle) {
      if (activeGroup === 'bio') {
        dashTitle.innerHTML = '🌿 Bio, Nithish & Micro Nutrients Dashboard';
      } else {
        dashTitle.innerHTML = '🧪 Chemical Dashboard';
      }
    }

    invSnap.forEach(d => {
      const inv = d.data();
      if (inv.status === 'CANCELLED') return;
      if (inv.accessGroup && inv.accessGroup !== activeGroup) return;

      const grand = Number(inv.grandTotal ?? inv.totals?.grandTotal) || 0;
      const date = inv.invoiceDate || today;
      const type = (inv.invoiceType || 'GST').toUpperCase();

      totalSales += grand;
      if (type === 'NON_GST') {
        nonGstSales += grand;
      } else {
        gstSales += grand;
      }

      if (date === today) todaySales += grand;

      // Group daily sales
      dailySalesMap[date] = (dailySalesMap[date] || 0) + grand;

      // Product sales stats
      (inv.itemsSnapshot || []).forEach(item => {
        const pName = item.productName || item.name;
        productSalesMap[pName] = (productSalesMap[pName] || 0) + (Number(item.qty) || 0);
      });

      // Check Overdue Status for Advance Invoices (Day 31+)
      const payStatus = getPaymentStatusInfo(inv, 'sales');
      if (payStatus.isOverdue) {
        overdueAlertList.push({
          docType: 'sales',
          id: d.id,
          number: inv.invoiceNumber,
          date: date,
          partyName: inv.customerName || 'Walk-in Customer',
          grandTotal: grand,
          advanceAmount: inv.advanceAmount || 0,
          balanceAmount: inv.balanceAmount ?? (grand - (inv.advanceAmount || 0)),
          payStatus
        });
      }
    });

    // Fetch recent purchases (bounded query, up to 100 recent docs)
    const purSnap = await getDocs(query(
      collection(db, 'purchases'),
      orderBy('createdAt', 'desc'),
      limit(100)
    ));
    let todayPurchase = 0;
    purSnap.forEach(d => {
      const pur = d.data();
      if (pur.accessGroup && pur.accessGroup !== activeGroup) return;
      if (pur.purchaseDate === today) {
        todayPurchase += Number(pur.totals?.grandTotal) || 0;
      }

      // Check Overdue Status for Advance Purchases (Day 76+)
      const payStatus = getPaymentStatusInfo(pur, 'purchase');
      if (payStatus.isOverdue) {
        const grand = Number(pur.totals?.grandTotal) || 0;
        overdueAlertList.push({
          docType: 'purchase',
          id: d.id,
          number: pur.purchaseNumber,
          date: pur.purchaseDate || today,
          partyName: pur.supplierName || 'Unknown Supplier',
          grandTotal: grand,
          advanceAmount: pur.advanceAmount || 0,
          balanceAmount: pur.balanceAmount ?? (grand - (pur.advanceAmount || 0)),
          payStatus
        });
      }
    });

    // Calculate receivables & payables
    let totalReceivables = 0;
    customersList.forEach(c => totalReceivables += Number(c.currentOutstanding) || 0);

    let totalPayables = 0;
    suppliersList.forEach(s => totalPayables += Number(s.currentOutstanding) || 0);

    // Calculate Stock Valuation, Low Stock Count & Expiry Alerts
    let stockValuation = 0;
    let lowStockCount = 0;
    const expiryAlertProducts = [];

    productsList.forEach(p => {
      const stock = Number(p.currentStock) || 0;
      const minStock = Number(p.minimumStock) || 5;
      const rate = Number(p.purchaseRate ?? p.sellingRate) || 0;
      stockValuation += stock * rate;
      if (stock <= minStock) lowStockCount++;

      // Check Expiry Status
      if (p.expiryDate) {
        const expInfo = getExpiryInfo(p.expiryDate);
        if (expInfo.isAlert) {
          expiryAlertProducts.push({ product: p, expInfo });
        }
      }
    });

    // Sort expiry alerts by urgency (Expired first, then critical, high, warning)
    expiryAlertProducts.sort((a, b) => {
      const daysA = a.expInfo.daysRemaining ?? 999;
      const daysB = b.expInfo.daysRemaining ?? 999;
      return daysA - daysB;
    });

    // Render KPI numbers in UI
    setKPI('dashGstSales', money(gstSales));
    setKPI('dashNonGstSales', money(nonGstSales));
    setKPI('dashTotalSales', money(totalSales));
    setKPI('dashTodaySales', money(todaySales));
    setKPI('dashTodayPurchase', money(todayPurchase));
    setKPI('dashReceivables', money(totalReceivables));
    // Sort overdue alerts by highest pending days
    overdueAlertList.sort((a, b) => (b.payStatus.pendingDays || 0) - (a.payStatus.pendingDays || 0));

    setKPI('dashPayables', money(totalPayables));
    setKPI('dashStockValuation', money(stockValuation));
    setKPI('dashTotalProducts', productsList.length);
    setKPI('dashTotalCustomers', customersList.length);
    setKPI('dashTotalSuppliers', suppliersList.length);
    setKPI('dashLowStockAlerts', lowStockCount);
    setKPI('dashExpiryAlerts', expiryAlertProducts.length);
    setKPI('dashOverdueAlerts', overdueAlertList.length);

    const badgeEl = document.getElementById('expiryAlertCountBadge');
    if (badgeEl) badgeEl.textContent = `${expiryAlertProducts.length} Product${expiryAlertProducts.length === 1 ? '' : 's'}`;

    const overdueBadgeEl = document.getElementById('overdueAlertCountBadge');
    if (overdueBadgeEl) overdueBadgeEl.textContent = `${overdueAlertList.length} Overdue Notification${overdueAlertList.length === 1 ? '' : 's'}`;

    // Populate Dashboard Widgets
    renderDashboardExpiryWidget(expiryAlertProducts);
    renderDashboardOverdueWidget(overdueAlertList);

    // Render Charts if Chart.js is loaded
    renderCharts(dailySalesMap, productSalesMap);
  } catch (err) {
    console.error('Error loading dashboard data:', err);
  }
}

/**
 * Renders Expiry Alert Card items in the Dashboard Widget.
 */
function renderDashboardExpiryWidget(alertList) {
  const container = document.getElementById('dashExpiryWidgetRows');
  if (!container) return;

  if (alertList.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; background:#ffffff; border:1px solid #bbf7d0; border-radius:8px; padding:12px 16px; color:#166534; font-size:13.5px; display:flex; align-items:center; gap:8px;">
        <span>✅ No products expiring within 60 days. All product stocks are fresh.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = alertList.map(({ product: p, expInfo }) => {
    let cardBg = '#ffffff';
    let borderColor = '#fde68a';
    let icon = '⚠️';
    let badgeText = '';
    let statusMsg = '';

    if (expInfo.level === 'EXPIRED') {
      cardBg = '#fef2f2';
      borderColor = '#fca5a5';
      icon = '❌';
      badgeText = 'Product Expired';
      statusMsg = `Expired on ${p.expiryDate} (Prevented from Sale)`;
    } else if (expInfo.level === 'CRITICAL') {
      cardBg = '#fff1f2';
      borderColor = '#fecdd3';
      icon = '🔴';
      badgeText = `Expires in ${expInfo.daysRemaining} days`;
      statusMsg = `Critical warning — Expiring on ${p.expiryDate}`;
    } else if (expInfo.level === 'HIGH') {
      cardBg = '#fffbeb';
      borderColor = '#fde68a';
      icon = '⚠️';
      badgeText = `Expires in ${expInfo.daysRemaining} days`;
      statusMsg = `High-priority — Expiring within 1 month (${p.expiryDate})`;
    } else {
      cardBg = '#ffffff';
      borderColor = '#fed7aa';
      icon = '⚠️';
      badgeText = `Expires in ${expInfo.daysRemaining} days`;
      statusMsg = `Expiring within 2 months (${p.expiryDate})`;
    }

    return `
      <div style="background:${cardBg}; border:1.5px solid ${borderColor}; border-radius:10px; padding:12px 14px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between; gap:6px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <strong style="font-size:14px; color:#1e293b; display:block;">${icon} ${esc(p.productName)}</strong>
            <small style="color:#64748b; font-size:12px;">Barcode: ${esc(p.barcode || 'N/A')} | Stock: ${p.currentStock || 0} ${esc(p.unit || '')}</small>
          </div>
          <span class="badge ${expInfo.badgeClass}" style="font-size:11px; white-space:nowrap; padding:3px 8px;">
            ${esc(expInfo.label)}
          </span>
        </div>
        <div style="font-size:12px; color:#475569; font-weight:500; margin-top:2px;">
          📅 Expiry Date: <strong>${esc(p.expiryDate)}</strong> (${expInfo.daysRemaining <= 0 ? 'Expired' : `${expInfo.daysRemaining} Days Remaining`})
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renders Overdue Payment Alert items in the Dashboard Widget.
 */
function renderDashboardOverdueWidget(alertList) {
  const container = document.getElementById('dashOverdueWidgetRows');
  if (!container) return;

  if (alertList.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; background:#ffffff; border:1px solid #bbf7d0; border-radius:8px; padding:12px 16px; color:#166534; font-size:13.5px; display:flex; align-items:center; gap:8px;">
        <span>✅ No overdue advance payments found. All invoice and purchase balances are within credit limits.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = alertList.map(item => {
    const isSales = item.docType === 'sales';
    const docLabel = isSales ? 'Sales Invoice' : 'Purchase Record';
    const tagBg = isSales ? '#eff6ff' : '#fef3c7';
    const tagColor = isSales ? '#1d4ed8' : '#b45309';

    return `
      <div style="background:#fff5f5; border:1.5px solid #fca5a5; border-radius:10px; padding:12px 14px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <span style="font-size:11px; font-weight:700; background:${tagBg}; color:${tagColor}; padding:2px 6px; border-radius:4px; text-transform:uppercase;">
              ${docLabel}
            </span>
            <strong style="font-size:14px; color:#9f1239; display:block; margin-top:4px;">🚨 ${esc(item.number)}</strong>
            <div style="font-size:12.5px; color:#334155; font-weight:600; margin-top:2px;">${esc(item.partyName)}</div>
          </div>
          <span class="badge danger" style="font-size:11px; white-space:nowrap; padding:3px 8px;">
            ${esc(item.payStatus.statusText)}
          </span>
        </div>
        <div style="font-size:12px; color:#475569; display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #fecdd3; padding-top:6px; margin-top:2px;">
          <div>
            <span>Total: <strong>${money(item.grandTotal)}</strong></span>
            ${item.advanceAmount ? `<br><small>Advance: ${money(item.advanceAmount)}</small>` : ''}
          </div>
          <div style="text-align:right;">
            <span style="color:#b91c1c; font-weight:700;">Balance Due: ${money(item.balanceAmount)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/**
 * Renders Chart.js analytics graphs.
 */
function renderCharts(dailySalesMap, productSalesMap) {
  if (!window.Chart) return;

  // 1. Daily Sales Trend Chart
  const salesCanvas = document.getElementById('salesTrendChart');
  if (salesCanvas) {
    const dates = Object.keys(dailySalesMap).sort().slice(-7);
    const amounts = dates.map(d => dailySalesMap[d]);

    if (chartInstances.salesTrend) chartInstances.salesTrend.destroy();

    chartInstances.salesTrend = new window.Chart(salesCanvas, {
      type: 'line',
      data: {
        labels: dates.length ? dates : ['Today'],
        datasets: [{
          label: 'Sales (₹)',
          data: amounts.length ? amounts : [0],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }

  // 2. Top Selling Products Chart
  const prodCanvas = document.getElementById('topProductsChart');
  if (prodCanvas) {
    const sortedProds = Object.entries(productSalesMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const labels = sortedProds.map(p => p[0]);
    const quantities = sortedProds.map(p => p[1]);

    if (chartInstances.topProducts) chartInstances.topProducts.destroy();

    chartInstances.topProducts = new window.Chart(prodCanvas, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          label: 'Qty Sold',
          data: quantities.length ? quantities : [0],
          backgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }
}
