/**
 * Custom Billing Software - GST Billing Engine & Invoice Module
 */

import { auth, db, doc, setDoc, collection, getDocs, getDoc, updateDoc, runTransaction, serverTimestamp, query, orderBy, limit, startAfter, where } from './firebase.js';
import { calculateDocumentTotals, formatDocumentNumber } from './gst.js';
import { productsList, loadProducts } from './products.js';
import { customersList, loadCustomers } from './customers.js';
import { money, esc, toast, todayStr, validateGSTIN, normalizeBarcode } from './utils.js';
import { logAuditAction } from './audit-logs.js';
import { appCache, getCachedCompanySettings, setCachedCompanySettings, cacheProduct, updateCachedProductStock, updateCachedCustomerOutstanding } from './cache.js';
import { storeEvents } from './store.js';
import { getUserAccessGroup, isCategoryAllowed } from './auth.js';

export let currentInvoiceItems = [];
export const productCacheByBarcode = new Map();

/**
 * Searches Firestore for a product matching the exact barcode.
 * Uses indexed query with in-memory caching for maximum speed.
 */
export async function findProductByBarcodeRemote(barcode) {
  const normBarcode = normalizeBarcode(barcode);
  if (!normBarcode) return null;

  // 1. Check session barcode cache
  if (productCacheByBarcode.has(normBarcode)) {
    const cached = productCacheByBarcode.get(normBarcode);
    if (cached && isCategoryAllowed(cached.category)) {
      return cached;
    }
  }

  // 2. Check loaded productsList in memory
  const localHit = Array.isArray(productsList) ? productsList.find(p => normalizeBarcode(p.barcode) === normBarcode && isCategoryAllowed(p.category)) : null;
  if (localHit) {
    productCacheByBarcode.set(normBarcode, localHit);
    return localHit;
  }

  if (!auth || !auth.currentUser) return null;

  try {
    const qBar = query(
      collection(db, 'products'),
      where('barcode', '==', normBarcode),
      limit(1)
    );
    const snap = await getDocs(qBar);
    if (!snap.empty) {
      const d = snap.docs[0];
      const prod = { id: d.id, ...d.data() };
      if (isCategoryAllowed(prod.category)) {
        cacheProduct(prod);
        productCacheByBarcode.set(normBarcode, prod);
        return prod;
      }
    }
  } catch (err) {
    console.warn('findProductByBarcodeRemote query error:', err.message);
  }
  return null;
}

export let companySettings = {
  name: 'S M AGRI TECH',
  subtitle: 'Agriculture Chemicals & Fertilizers · Thalavadi',
  address: 'Thalavadi, Erode District, Tamil Nadu',
  phone: '+91 98765 43210',
  email: 'contact@smagritech.com',
  gstin: '33AAAAA0000A1Z5',
  state: 'Tamil Nadu',
  stateCode: '33',
  bankAccountName: 'S M AGRI TECH',
  bankAccountType: 'Current Account',
  bankName: 'State Bank of India',
  bankAccountNo: '123456789012',
  bankIfsc: 'SBIN0001234',
  bankBranch: 'Thalavadi Branch',
  allowNegativeStock: false,
  invoicePrefix: 'INV',
  quotationPrefix: 'QTN',
  logoUrl: 'logo.png',
  terms: '1. Goods once sold are subject to standard company warranty policy.\n2. Interest @ 18% p.a. will be charged on overdue payments.\n3. Subject to local court jurisdiction.'
};

/**
 * Loads company settings from Firestore or returns cached session copy.
 */
export async function loadCompanySettings(forceRefresh = false) {
  const cached = getCachedCompanySettings();
  if (cached && !forceRefresh) {
    companySettings = cached;
    return companySettings;
  }
  if (!auth || !auth.currentUser) return companySettings;
  try {
    const docSnap = await getDoc(doc(db, 'company_settings', 'main'));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.name === 'CUSTOM BILLING SOFTWARE' || !data.name) {
        data.name = 'S M AGRI TECH';
      }
      if (!data.logoUrl) {
        data.logoUrl = 'logo.png';
      }
      companySettings = { ...companySettings, ...data };
      setCachedCompanySettings(companySettings);
    }
  } catch (err) {
    console.warn('Could not load company settings, using defaults:', err);
  }
  return companySettings;
}

/**
 * Atomically saves and synchronizes company settings across Firestore, cache, and app events.
 */
export async function saveCompanySettings(payload) {
  try {
    await setDoc(doc(db, 'company_settings', 'main'), payload, { merge: true });
    companySettings = { ...companySettings, ...payload };
    setCachedCompanySettings(companySettings);
    storeEvents.emit('companySettingsUpdated', companySettings);
    return companySettings;
  } catch (err) {
    console.error('Save company settings error:', err);
    throw err;
  }
}

/**
 * Saves GST Invoice or Non-GST Bill to Firestore atomically.
 * Strictly executes ALL READS FIRST before ANY WRITES per Cloud Firestore requirements.
 */
export async function saveInvoice(invoiceData) {
  if (!invoiceData.items || invoiceData.items.length === 0) {
    toast('Cannot save empty invoice. Please add at least one product.', 'warning');
    return null;
  }

  const rawGstin = (invoiceData.customerGstin || '').trim();
  const hasValidGstin = Boolean(rawGstin);

  // Auto-detect invoiceType: if explicitly set, respect it; otherwise auto-detect based on GSTIN presence
  let invoiceType = 'GST';
  if (invoiceData.invoiceType) {
    invoiceType = String(invoiceData.invoiceType).toUpperCase() === 'NON_GST' ? 'NON_GST' : 'GST';
  } else {
    invoiceType = hasValidGstin ? 'GST' : 'NON_GST';
  }

  const {
    customerName = 'Walk-in Customer',
    customerId = '',
    phone = '',
    customerGstin = '',
    customerStateCode = '33',
    billingAddress = '',
    paymentMode = 'Cash',
    notes = '',
    date = todayStr()
  } = invoiceData;

  // Validation for GST Invoice
  if (invoiceType === 'GST') {
    if (!customerGstin || !customerGstin.trim()) {
      toast('GST Invoice requires Customer GSTIN.', 'error');
      return null;
    }
    if (!validateGSTIN(customerGstin.trim())) {
      toast('Invalid GSTIN Format for GST Invoice (e.g. 33AAAAA0000A1Z5)', 'error');
      return null;
    }
  }

  const finalGstin = invoiceType === 'GST' ? customerGstin.trim().toUpperCase() : null;

  // Calculate totals using tax engine
  const totals = calculateDocumentTotals(
    invoiceData.items,
    companySettings.stateCode || '33',
    customerStateCode || '33',
    0,
    0,
    invoiceType,
    invoiceData.overallDiscountVal || 0,
    invoiceData.overallDiscountType || 'amount'
  );

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      // ==========================================
      // PHASE 1: READ ALL DOCUMENTS FIRST
      // ==========================================

      // 1. Read Product documents
      const prodSnaps = [];
      for (const item of totals.items) {
        if (item.productId) {
          const productRef = doc(db, 'products', item.productId);
          const prodSnap = await transaction.get(productRef);
          prodSnaps.push({ item, ref: productRef, snap: prodSnap });
        }
      }

      // Check stock availability
      if (!companySettings.allowNegativeStock) {
        for (const p of prodSnaps) {
          if (p.snap.exists()) {
            const currentStock = Number(p.snap.data().currentStock) || 0;
            if (currentStock < p.item.qty) {
              throw new Error(`Insufficient stock for "${p.item.productName}". Available: ${currentStock} ${p.item.unit || ''}, Requested: ${p.item.qty}`);
            }
          }
        }
      }

      // 2. Read Invoice Counter document
      const currentYear = new Date(date).getFullYear();
      const counterRef = doc(db, 'counters', `invoices_${currentYear}`);
      const counterSnap = await transaction.get(counterRef);

      // 3. Read Customer document if applicable
      let custSnap = null;
      let customerRef = null;
      if (customerId) {
        customerRef = doc(db, 'customers', customerId);
        custSnap = await transaction.get(customerRef);
      }

      // ==========================================
      // PHASE 2: PERFORM ALL WRITES SECOND
      // ==========================================

      // Update counter
      let nextCounter = 1;
      if (counterSnap.exists()) {
        nextCounter = (Number(counterSnap.data().value) || 0) + 1;
        transaction.update(counterRef, { value: nextCounter });
      } else {
        transaction.set(counterRef, { value: 1 });
      }

      const invoiceNumber = formatDocumentNumber(companySettings.invoicePrefix || 'INV', currentYear, nextCounter);

      // Deduct stock & create stock movements
      const updatedStockMap = {};
      for (const p of prodSnaps) {
        if (p.snap.exists()) {
          const prevStock = Number(p.snap.data().currentStock) || 0;
          const newStock = prevStock - Number(p.item.qty);
          updatedStockMap[p.item.productId] = newStock;
          transaction.update(p.ref, { 
            currentStock: newStock,
            updatedAt: serverTimestamp()
          });

          // Log stock movement
          const movementRef = doc(collection(db, 'stock_movements'));
          transaction.set(movementRef, {
            productId: p.item.productId,
            productName: p.item.productName || p.item.name,
            type: 'SALE',
            referenceId: invoiceNumber,
            quantity: -Math.abs(p.item.qty),
            unit: p.item.unit || 'KG',
            previousStock: prevStock,
            newStock: newStock,
            createdAt: serverTimestamp(),
            notes: `${invoiceType} Sale Invoice #${invoiceNumber}`
          });
        }
      }

      // Update customer ledger & outstanding
      let updatedCustomerOutstanding = null;
      if (customerRef && custSnap && custSnap.exists()) {
        const prevOutstanding = Number(custSnap.data().currentOutstanding) || 0;
        const isCredit = paymentMode === 'Credit / Unpaid';
        const additionToOutstanding = isCredit ? totals.grandTotal : 0;
        updatedCustomerOutstanding = prevOutstanding + additionToOutstanding;

        transaction.update(customerRef, {
          currentOutstanding: updatedCustomerOutstanding,
          updatedAt: serverTimestamp()
        });

        const ledgerRef = doc(collection(db, 'customer_ledger'));
        transaction.set(ledgerRef, {
          customerId,
          customerName,
          date,
          referenceNumber: invoiceNumber,
          type: 'INVOICE',
          debit: totals.grandTotal,
          credit: isCredit ? 0 : totals.grandTotal,
          balance: updatedCustomerOutstanding,
          createdAt: serverTimestamp()
        });
      }

      // Save Invoice document
      const invoiceRef = doc(collection(db, 'invoices'));
      const invoiceRecord = {
        invoiceNumber,
        invoiceDate: date,
        invoiceType,
        payableStatus: invoiceData.payableStatus || null,
        advanceAmount: invoiceData.payableStatus === 'advance' ? (Number(invoiceData.advanceAmount) || 0) : null,
        balanceAmount: invoiceData.payableStatus === 'advance' ? Math.max(0, totals.grandTotal - (Number(invoiceData.advanceAmount) || 0)) : 0,
        overallDiscountVal: invoiceData.overallDiscountVal || 0,
        overallDiscountType: invoiceData.overallDiscountType || 'amount',
        customerId: customerId || null,
        customerName,
        phone,
        customerGstin: finalGstin,
        customerGSTIN: finalGstin,
        customerStateCode,
        customerSnapshot: invoiceData.customerSnapshot || {
          customerId: customerId || null,
          customerName: customerName,
          phone: phone,
          customerType: invoiceData.customerType || 'B2B',
          taxType: invoiceData.customerTaxType || (finalGstin ? 'GST' : 'NON_GST'),
          gstin: finalGstin,
          state: invoiceData.customerState || 'Tamil Nadu',
          stateCode: customerStateCode,
          billingAddress: billingAddress,
          deliveryAddress: invoiceData.deliveryAddress || billingAddress
        },
        companySnapshot: { ...companySettings },
        itemsSnapshot: totals.items.map(i => ({
          productId: i.productId || null,
          productName: i.productName || i.name,
          hsn: i.hsnCode || i.hsn || '',
          qty: Number(i.qty),
          unit: i.unit || 'KG',
          rate: Number(i.rate),
          discount: Number(i.discount || 0),
          gstRate: Number(i.gstRate || i.gst || 0),
          appliedGstRate: Number(i.appliedGstRate || 0),
          taxableValue: Number(i.taxableValue),
          cgstAmount: Number(i.cgstAmount),
          sgstAmount: Number(i.sgstAmount),
          igstAmount: Number(i.igstAmount),
          lineTotal: Number(i.lineTotal)
        })),
        taxableValue: totals.totalTaxable,
        cgst: totals.totalCgst,
        sgst: totals.totalSgst,
        igst: totals.totalIgst,
        grandTotal: totals.grandTotal,
        totals: {
          subtotal: totals.subtotal,
          totalDiscount: totals.totalDiscount,
          totalTaxable: totals.totalTaxable,
          totalCgst: totals.totalCgst,
          totalSgst: totals.totalSgst,
          totalIgst: totals.totalIgst,
          totalGst: totals.totalGst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          isIntraState: totals.isIntraState
        },
        status: 'PAID',
        accessGroup: getUserAccessGroup(),
        createdAt: serverTimestamp()
      };

      transaction.set(invoiceRef, invoiceRecord);
      return {
        id: invoiceRef.id,
        invoiceNumber,
        updatedStockMap,
        updatedCustomerOutstanding,
        ...invoiceRecord
      };
    });

    // Synchronize In-Memory Cache and Emit Real-Time Events
    for (const [pId, newStock] of Object.entries(resultDoc.updatedStockMap || {})) {
      updateCachedProductStock(pId, newStock);
      storeEvents.emit('stockUpdated', { productId: pId, newStock });
    }
    if (resultDoc.updatedCustomerOutstanding !== null && customerId) {
      updateCachedCustomerOutstanding(customerId, resultDoc.updatedCustomerOutstanding);
      storeEvents.emit('customerBalanceUpdated', { customerId, newOutstanding: resultDoc.updatedCustomerOutstanding });
    }
    storeEvents.emit('invoiceSaved', { invoice: resultDoc });

    toast(`${invoiceType === 'NON_GST' ? 'Non-GST Bill' : 'GST Invoice'} #${resultDoc.invoiceNumber} saved successfully!`, 'success');
    await logAuditAction('INVOICE_CREATED', 'billing', resultDoc.id, {
      invoiceNumber: resultDoc.invoiceNumber,
      invoiceType: resultDoc.invoiceType,
      grandTotal: resultDoc.grandTotal
    });
    return resultDoc;
  } catch (err) {
    console.error('Invoice save transaction failed:', err);
    toast(err.message || 'Failed to save invoice.', 'error');
    throw err;
  }
}

/**
 * Cancels an invoice with mandatory audit trail logging.
 */
export async function cancelInvoice(invoiceId, reason = '') {
  if (!invoiceId) return false;
  try {
    const invRef = doc(db, 'invoices', invoiceId);
    const snap = await getDoc(invRef);
    if (!snap.exists()) {
      toast('Invoice not found.', 'error');
      return false;
    }
    const data = snap.data();
    if (data.status === 'CANCELLED') {
      toast('Invoice is already cancelled.', 'warning');
      return false;
    }

    await updateDoc(invRef, {
      status: 'CANCELLED',
      cancellationReason: reason.trim(),
      cancelledAt: serverTimestamp()
    });

    await logAuditAction('INVOICE_CANCELLED', 'billing', invoiceId, {
      invoiceNumber: data.invoiceNumber,
      invoiceType: data.invoiceType || 'GST',
      reason: reason.trim(),
      grandTotal: data.grandTotal
    });

    toast(`Invoice #${data.invoiceNumber} has been cancelled.`, 'success');
    return true;
  } catch (err) {
    console.error('Cancel invoice error:', err);
    toast('Failed to cancel invoice.', 'error');
    return false;
  }
}

/**
 * Fetch invoice history list.
 */
export async function fetchInvoices(limitCount = 50) {
  if (!auth || !auth.currentUser) return [];
  try {
    const q = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const docs = [];
    const group = getUserAccessGroup();
    snap.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (!data.accessGroup || data.accessGroup === group) {
        docs.push(data);
      }
    });
    return docs;
  } catch (err) {
    console.error('Fetch invoices error:', err);
    return [];
  }
}

/**
 * Paginated Invoice Fetching using Firestore Cursors.
 */
export async function fetchInvoicesPage(pageSize = 25, lastVisible = null) {
  if (!auth || !auth.currentUser) return { invoices: [], lastVisibleDoc: null, hasMore: false };
  try {
    let q;
    if (lastVisible) {
      q = query(
        collection(db, 'invoices'),
        orderBy('createdAt', 'desc'),
        startAfter(lastVisible),
        limit(pageSize)
      );
    } else {
      q = query(
        collection(db, 'invoices'),
        orderBy('createdAt', 'desc'),
        limit(pageSize)
      );
    }
    const snap = await getDocs(q);
    const docs = [];
    const group = getUserAccessGroup();
    snap.forEach(docSnap => {
      const data = { id: docSnap.id, docSnap, ...docSnap.data() };
      if (!data.accessGroup || data.accessGroup === group) {
        docs.push(data);
      }
    });

    const lastVisibleDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    const hasMore = snap.docs.length === pageSize;

    return { invoices: docs, lastVisibleDoc, hasMore };
  } catch (err) {
    console.error('Fetch invoices page error:', err);
    return { invoices: [], lastVisibleDoc: null, hasMore: false };
  }
}
