/**
 * Akshara Spices Trades - Comprehensive Reports & Analytics Engine
 */

import { db, collection, getDocs, query, where, orderBy } from './firebase.js';
import { money, formatDate } from './utils.js';
import { getUserAccessGroup } from './auth.js';

/**
 * Generates Daily/Monthly/Date-Range Sales Report.
 */
export async function getSalesReport(fromDate, toDate) {
  try {
    const snap = await getDocs(query(collection(db, 'invoices'), orderBy('invoiceDate', 'desc')));
    const invoices = [];
    snap.forEach(d => invoices.push({ id: d.id, ...d.data() }));

    const group = getUserAccessGroup();
    const filtered = invoices.filter(inv => {
      if (inv.status === 'CANCELLED') return false;
      if (inv.accessGroup && inv.accessGroup !== group) return false;
      const date = inv.invoiceDate;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    });

    let totalRevenue = 0;
    let gstSales = 0;
    let nonGstSales = 0;
    let totalTaxable = 0;
    let totalGst = 0;
    let totalInvoices = filtered.length;

    filtered.forEach(inv => {
      const grand = Number(inv.grandTotal ?? inv.totals?.grandTotal) || 0;
      const taxable = Number(inv.taxableValue ?? inv.totals?.totalTaxable) || 0;
      const gst = Number(inv.totals?.totalGst) || 0;
      const type = (inv.invoiceType || 'GST').toUpperCase();

      totalRevenue += grand;
      totalTaxable += taxable;
      totalGst += gst;

      if (type === 'NON_GST') {
        nonGstSales += grand;
      } else {
        gstSales += grand;
      }
    });

    return {
      invoices: filtered,
      totalInvoices,
      totalRevenue,
      gstSales,
      nonGstSales,
      totalSales: totalRevenue,
      totalTaxable,
      totalGst
    };
  } catch (err) {
    console.error('Get sales report error:', err);
    return { invoices: [], totalInvoices: 0, totalRevenue: 0, gstSales: 0, nonGstSales: 0, totalSales: 0, totalTaxable: 0, totalGst: 0 };
  }
}

/**
 * Generates Purchase Report.
 */
export async function getPurchaseReport(fromDate, toDate) {
  try {
    const snap = await getDocs(query(collection(db, 'purchases'), orderBy('purchaseDate', 'desc')));
    const purchases = [];
    snap.forEach(d => purchases.push({ id: d.id, ...d.data() }));

    const group = getUserAccessGroup();
    const filtered = purchases.filter(p => {
      if (p.accessGroup && p.accessGroup !== group) return false;
      const date = p.purchaseDate;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    });

    let totalCost = 0;
    let totalTaxable = 0;
    let totalGst = 0;

    filtered.forEach(p => {
      totalCost += Number(p.totals?.grandTotal) || 0;
      totalTaxable += Number(p.totals?.totalTaxable) || 0;
      totalGst += Number(p.totals?.totalGst) || 0;
    });

    return {
      purchases: filtered,
      totalPurchases: filtered.length,
      totalCost,
      totalTaxable,
      totalGst
    };
  } catch (err) {
    console.error('Get purchase report error:', err);
    return { purchases: [], totalPurchases: 0, totalCost: 0, totalTaxable: 0, totalGst: 0 };
  }
}

/**
 * Fast & Slow Moving Products Analysis.
 */
export async function getProductPerformanceReport(fromDate, toDate) {
  try {
    const snap = await getDocs(query(collection(db, 'invoices')));
    const productStats = {};

    snap.forEach(docSnap => {
      const inv = docSnap.data();
      if (inv.status === 'CANCELLED') return;
      const date = inv.invoiceDate;
      if (fromDate && date < fromDate) return;
      if (toDate && date > toDate) return;

      const items = inv.itemsSnapshot || [];
      items.forEach(item => {
        const key = item.productId || item.productName;
        if (!productStats[key]) {
          productStats[key] = {
            productName: item.productName || item.name,
            hsn: item.hsn || '',
            unit: item.unit || 'KG',
            qtySold: 0,
            revenue: 0
          };
        }
        productStats[key].qtySold += Number(item.qty) || 0;
        productStats[key].revenue += Number(item.lineTotal || (item.qty * item.rate)) || 0;
      });
    });

    const statsList = Object.values(productStats);
    statsList.sort((a, b) => b.qtySold - a.qtySold);

    return {
      fastMoving: statsList.slice(0, 10),
      slowMoving: [...statsList].reverse().slice(0, 10),
      allProducts: statsList
    };
  } catch (err) {
    console.error('Get product performance report error:', err);
    return { fastMoving: [], slowMoving: [], allProducts: [] };
  }
}

/**
 * Profit & Margin Report including Landed Costs & Expenses.
 */
export async function getProfitAndMarginReport(fromDate, toDate) {
  try {
    const salesReport = await getSalesReport(fromDate, toDate);
    const purchaseReport = await getPurchaseReport(fromDate, toDate);

    // Fetch expenses
    const expSnap = await getDocs(query(collection(db, 'expenses')));
    let totalExpenses = 0;
    expSnap.forEach(d => {
      const exp = d.data();
      if (fromDate && exp.expenseDate < fromDate) return;
      if (toDate && exp.expenseDate > toDate) return;
      totalExpenses += Number(exp.amount) || 0;
    });

    const revenue = salesReport.totalRevenue;
    const directPurchaseCost = purchaseReport.totalCost;
    const grossProfit = revenue - directPurchaseCost;
    const netProfit = grossProfit - totalExpenses;
    const marginPct = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0;

    return {
      revenue,
      directPurchaseCost,
      totalExpenses,
      grossProfit,
      netProfit,
      marginPct
    };
  } catch (err) {
    console.error('Get profit report error:', err);
    return { revenue: 0, directPurchaseCost: 0, totalExpenses: 0, grossProfit: 0, netProfit: 0, marginPct: 0 };
  }
}

/**
 * GST Reports Summary (Output Tax vs Input Tax).
 * GST reports must include ONLY applicable GST transactions (invoiceType === 'GST').
 */
export async function getGSTReport(fromDate, toDate) {
  try {
    const salesReport = await getSalesReport(fromDate, toDate);
    const purchaseReport = await getPurchaseReport(fromDate, toDate);

    // Filter sales to ONLY GST transactions
    const gstInvoices = salesReport.invoices.filter(inv => (inv.invoiceType || 'GST').toUpperCase() === 'GST');

    let outputCgst = 0, outputSgst = 0, outputIgst = 0;
    let totalGstTaxable = 0;
    let totalGstSales = 0;

    gstInvoices.forEach(inv => {
      outputCgst += Number(inv.cgst ?? inv.totals?.totalCgst) || 0;
      outputSgst += Number(inv.sgst ?? inv.totals?.totalSgst) || 0;
      outputIgst += Number(inv.igst ?? inv.totals?.totalIgst) || 0;
      totalGstTaxable += Number(inv.taxableValue ?? inv.totals?.totalTaxable) || 0;
      totalGstSales += Number(inv.grandTotal ?? inv.totals?.grandTotal) || 0;
    });

    let inputCgst = 0, inputSgst = 0, inputIgst = 0;
    purchaseReport.purchases.forEach(p => {
      inputCgst += Number(p.totals?.totalCgst) || 0;
      inputSgst += Number(p.totals?.totalSgst) || 0;
      inputIgst += Number(p.totals?.totalIgst) || 0;
    });

    const totalOutputGst = outputCgst + outputSgst + outputIgst;
    const totalInputGst = inputCgst + inputSgst + inputIgst;
    const netTaxPayable = totalOutputGst - totalInputGst;

    return {
      sales: salesReport,
      purchases: purchaseReport,
      gstInvoices,
      totalGstSales,
      totalGstTaxable,
      outputTax: { cgst: outputCgst, sgst: outputSgst, igst: outputIgst, total: totalOutputGst },
      inputTax: { cgst: inputCgst, sgst: inputSgst, igst: inputIgst, total: totalInputGst },
      netTaxPayable
    };
  } catch (err) {
    console.error('Get GST report error:', err);
    return null;
  }
}
