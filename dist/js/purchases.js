/**
 * Akshara Spices Trades - Purchase Management & Stock Addition Module
 */

import { auth, db, doc, collection, getDocs, runTransaction, serverTimestamp, query, orderBy, limit, startAfter } from './firebase.js';
import { calculateDocumentTotals, formatDocumentNumber } from './gst.js';
import { loadProducts } from './products.js';
import { suppliersList, loadSuppliers } from './suppliers.js';
import { companySettings } from './billing.js';
import { money, toast, todayStr } from './utils.js';
import { updateCachedProductStock, updateCachedSupplierOutstanding } from './cache.js';
import { storeEvents } from './store.js';
import { getUserAccessGroup } from './auth.js';

export let currentPurchaseItems = [];

/**
 * Saves Purchase invoice to Firestore.
 * Strictly executes ALL READS FIRST before ANY WRITES per Cloud Firestore requirements.
 */
export async function savePurchase(purchaseData) {
  if (!purchaseData.items || purchaseData.items.length === 0) {
    toast('Please add at least one item to purchase invoice.', 'warning');
    return null;
  }

  const {
    supplierId = '',
    supplierName = '',
    supplierGstin = '',
    supplierInvoiceNo = '',
    purchaseDate = todayStr(),
    freight = 0,
    otherCharges = 0,
    supplierStateCode = '33',
    notes = ''
  } = purchaseData;

  const totals = calculateDocumentTotals(
    purchaseData.items,
    companySettings.stateCode || '33',
    supplierStateCode || '33',
    freight,
    otherCharges
  );

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      // ==========================================
      // PHASE 1: READ ALL DOCUMENTS FIRST
      // ==========================================

      // 1. Read Purchase Counter document
      const currentYear = new Date(purchaseDate).getFullYear();
      const counterRef = doc(db, 'counters', `purchases_${currentYear}`);
      const counterSnap = await transaction.get(counterRef);

      // 2. Read Product documents
      const prodSnaps = [];
      for (const item of totals.items) {
        if (item.productId) {
          const productRef = doc(db, 'products', item.productId);
          const prodSnap = await transaction.get(productRef);
          prodSnaps.push({ item, ref: productRef, snap: prodSnap });
        }
      }

      // 3. Read Supplier document
      let suppSnap = null;
      let supplierRef = null;
      if (supplierId) {
        supplierRef = doc(db, 'suppliers', supplierId);
        suppSnap = await transaction.get(supplierRef);
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

      const purchaseNumber = formatDocumentNumber('PUR', currentYear, nextCounter);

      // Increase Stock & Log Stock Movements
      const updatedStockMap = {};
      for (const p of prodSnaps) {
        if (p.snap.exists()) {
          const prevStock = Number(p.snap.data().currentStock) || 0;
          const newStock = prevStock + Number(p.item.qty);
          updatedStockMap[p.item.productId] = newStock;

          const updates = {
            currentStock: newStock,
            updatedAt: serverTimestamp()
          };
          if (p.item.rate > 0) updates.purchaseRate = Number(p.item.rate);

          transaction.update(p.ref, updates);

          const movementRef = doc(collection(db, 'stock_movements'));
          transaction.set(movementRef, {
            productId: p.item.productId,
            productName: p.item.productName || p.item.name,
            type: 'PURCHASE',
            referenceId: purchaseNumber,
            quantity: Math.abs(Number(p.item.qty)),
            unit: p.item.unit || 'KG',
            previousStock: prevStock,
            newStock: newStock,
            createdAt: serverTimestamp(),
            notes: `Purchase Invoice #${purchaseNumber} (Supplier Ref: ${supplierInvoiceNo || 'N/A'})`
          });
        }
      }

      // Update Supplier Ledger / Outstanding
      let updatedSupplierOutstanding = null;
      if (supplierRef && suppSnap && suppSnap.exists()) {
        const prevOutstanding = Number(suppSnap.data().currentOutstanding) || 0;
        updatedSupplierOutstanding = prevOutstanding + totals.grandTotal;

        transaction.update(supplierRef, {
          currentOutstanding: updatedSupplierOutstanding,
          updatedAt: serverTimestamp()
        });

        const ledgerRef = doc(collection(db, 'supplier_ledger'));
        transaction.set(ledgerRef, {
          supplierId,
          supplierName,
          date: purchaseDate,
          referenceNumber: purchaseNumber,
          type: 'PURCHASE',
          debit: 0,
          credit: totals.grandTotal,
          balance: updatedSupplierOutstanding,
          createdAt: serverTimestamp()
        });
      }

      // Save Purchase record
      const purchaseRef = doc(collection(db, 'purchases'));
      const purchaseRecord = {
        purchaseNumber,
        purchaseDate,
        payableStatus: purchaseData.payableStatus || null,
        advanceAmount: purchaseData.payableStatus === 'advance' ? (Number(purchaseData.advanceAmount) || 0) : null,
        balanceAmount: purchaseData.payableStatus === 'advance' ? Math.max(0, totals.grandTotal - (Number(purchaseData.advanceAmount) || 0)) : 0,
        supplierId: supplierId || null,
        supplierName,
        supplierGstin,
        supplierInvoiceNo,
        supplierStateCode,
        notes,
        accessGroup: getUserAccessGroup(),
        itemsSnapshot: totals.items.map(i => ({
          productId: i.productId || null,
          productName: i.productName || i.name,
          hsn: i.hsnCode || i.hsn || '',
          qty: Number(i.qty),
          unit: i.unit || 'KG',
          rate: Number(i.rate),
          discount: Number(i.discount || 0),
          gstRate: Number(i.gstRate || i.gst || 0),
          taxableValue: Number(i.taxableValue),
          cgstAmount: Number(i.cgstAmount),
          sgstAmount: Number(i.sgstAmount),
          igstAmount: Number(i.igstAmount),
          lineTotal: Number(i.lineTotal)
        })),
        totals: {
          subtotal: totals.subtotal,
          totalDiscount: totals.totalDiscount,
          totalTaxable: totals.totalTaxable,
          totalCgst: totals.totalCgst,
          totalSgst: totals.totalSgst,
          totalIgst: totals.totalIgst,
          totalGst: totals.totalGst,
          freight: totals.freight,
          otherCharges: totals.otherCharges,
          grandTotal: totals.grandTotal
        },
        createdAt: serverTimestamp()
      };

      transaction.set(purchaseRef, purchaseRecord);
      return {
        id: purchaseRef.id,
        purchaseNumber,
        updatedStockMap,
        updatedSupplierOutstanding,
        ...purchaseRecord
      };
    });

    // Synchronize In-Memory Cache and Emit Real-Time Events
    for (const [pId, newStock] of Object.entries(resultDoc.updatedStockMap || {})) {
      updateCachedProductStock(pId, newStock);
      storeEvents.emit('stockUpdated', { productId: pId, newStock });
    }
    if (resultDoc.updatedSupplierOutstanding !== null && supplierId) {
      updateCachedSupplierOutstanding(supplierId, resultDoc.updatedSupplierOutstanding);
      storeEvents.emit('supplierBalanceUpdated', { supplierId, newOutstanding: resultDoc.updatedSupplierOutstanding });
    }
    storeEvents.emit('purchaseSaved', { purchase: resultDoc });

    toast(`Purchase Invoice #${resultDoc.purchaseNumber} recorded successfully!`, 'success');
    return resultDoc;
  } catch (err) {
    console.error('Purchase save transaction error:', err);
    toast(err.message || 'Failed to save purchase invoice.', 'error');
    throw err;
  }
}

/**
 * Fetch purchases history.
 */
export async function fetchPurchases(limitCount = 50) {
  if (!auth || !auth.currentUser) return [];
  try {
    const q = query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(limitCount));
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
    console.error('Fetch purchases error:', err);
    return [];
  }
}

/**
 * Fetch paginated purchases with Firestore cursor.
 */
export async function fetchPurchasesPage(pageSize = 25, lastVisibleDoc = null) {
  if (!auth || !auth.currentUser) return { purchases: [], lastDoc: null, hasMore: false };
  try {
    let q = query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(pageSize));
    if (lastVisibleDoc) {
      q = query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), startAfter(lastVisibleDoc), limit(pageSize));
    }
    const snap = await getDocs(q);
    const docs = [];
    const group = getUserAccessGroup();
    let newLastDoc = null;
    snap.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (!data.accessGroup || data.accessGroup === group) {
        docs.push(data);
        newLastDoc = docSnap;
      }
    });
    return {
      purchases: docs,
      lastDoc: newLastDoc,
      hasMore: docs.length === pageSize
    };
  } catch (err) {
    console.error('Fetch purchases page error:', err);
    return { purchases: [], lastDoc: null, hasMore: false };
  }
}
