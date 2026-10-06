/**
 * Akshara Spices Trades - Sales & Purchase Returns Module
 */

import { db, doc, collection, getDocs, runTransaction, serverTimestamp, query, orderBy, limit } from './firebase.js';
import { calculateDocumentTotals, formatDocumentNumber } from './gst.js';
import { loadProducts } from './products.js';
import { loadCustomers } from './customers.js';
import { loadSuppliers } from './suppliers.js';
import { money, toast, todayStr } from './utils.js';
import { updateCachedProductStock, updateCachedCustomerOutstanding, updateCachedSupplierOutstanding } from './cache.js';
import { storeEvents } from './store.js';

/**
 * Saves a Sales Return (Credit Note).
 * Stock INCREASES, customer ledger / outstanding is credited.
 */
export async function saveSalesReturn(returnData) {
  const {
    customerId = '',
    customerName = '',
    originalInvoiceNo = '',
    productId = '',
    productName = '',
    qty = 0,
    unit = 'KG',
    rate = 0,
    gstRate = 5,
    reason = '',
    returnDate = todayStr()
  } = returnData;

  if (!productId || qty <= 0) {
    toast('Invalid return product or quantity.', 'warning');
    return null;
  }

  const calc = calculateDocumentTotals([{ qty, rate, gstRate }]);

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      // ==========================================
      // PHASE 1: READ ALL DOCUMENTS FIRST
      // ==========================================
      const currentYear = new Date(returnDate).getFullYear();
      const counterRef = doc(db, 'counters', `sales_returns_${currentYear}`);
      const counterSnap = await transaction.get(counterRef);

      const productRef = doc(db, 'products', productId);
      const prodSnap = await transaction.get(productRef);

      let customerRef = null;
      let custSnap = null;
      if (customerId) {
        customerRef = doc(db, 'customers', customerId);
        custSnap = await transaction.get(customerRef);
      }

      // ==========================================
      // PHASE 2: PERFORM ALL WRITES SECOND
      // ==========================================
      let nextCounter = 1;
      if (counterSnap.exists()) {
        nextCounter = (Number(counterSnap.data().value) || 0) + 1;
        transaction.update(counterRef, { value: nextCounter });
      } else {
        transaction.set(counterRef, { value: 1 });
      }

      const returnNumber = formatDocumentNumber('CN', currentYear, nextCounter);

      // Increase Stock for returned item
      let calculatedStock = null;
      if (prodSnap.exists()) {
        const prevStock = Number(prodSnap.data().currentStock) || 0;
        calculatedStock = prevStock + Number(qty);
        transaction.update(productRef, {
          currentStock: calculatedStock,
          updatedAt: serverTimestamp()
        });

        // Stock movement log
        const movementRef = doc(collection(db, 'stock_movements'));
        transaction.set(movementRef, {
          productId,
          productName,
          type: 'SALES_RETURN',
          referenceId: returnNumber,
          quantity: Math.abs(Number(qty)),
          unit,
          previousStock: prevStock,
          newStock: calculatedStock,
          createdAt: serverTimestamp(),
          notes: `Sales Return #${returnNumber} (Invoice #${originalInvoiceNo || 'N/A'}) - Reason: ${reason}`
        });
      }

      // Customer Ledger credit adjustment
      let calculatedOutstanding = null;
      if (customerRef && custSnap && custSnap.exists()) {
        const prevOutstanding = Number(custSnap.data().currentOutstanding) || 0;
        calculatedOutstanding = prevOutstanding - calc.grandTotal;

        transaction.update(customerRef, {
          currentOutstanding: calculatedOutstanding,
          updatedAt: serverTimestamp()
        });

        // Ledger record
        const ledgerRef = doc(collection(db, 'customer_ledger'));
        transaction.set(ledgerRef, {
          customerId,
          customerName,
          date: returnDate,
          referenceNumber: returnNumber,
          type: 'SALES_RETURN',
          debit: 0,
          credit: calc.grandTotal,
          balance: calculatedOutstanding,
          createdAt: serverTimestamp()
        });
      }

      // Record Sales Return document
      const returnRef = doc(collection(db, 'sales_returns'));
      const record = {
        returnNumber,
        returnDate,
        customerId: customerId || null,
        customerName,
        originalInvoiceNo,
        productId,
        productName,
        qty: Number(qty),
        unit,
        rate: Number(rate),
        gstRate: Number(gstRate),
        refundAmount: calc.grandTotal,
        reason,
        createdAt: serverTimestamp()
      };

      transaction.set(returnRef, record);
      return {
        id: returnRef.id,
        calculatedStock,
        calculatedOutstanding,
        ...record
      };
    });

    if (resultDoc.calculatedStock !== null && productId) {
      updateCachedProductStock(productId, resultDoc.calculatedStock);
      storeEvents.emit('stockUpdated', { productId, newStock: resultDoc.calculatedStock });
    }
    if (resultDoc.calculatedOutstanding !== null && customerId) {
      updateCachedCustomerOutstanding(customerId, resultDoc.calculatedOutstanding);
      storeEvents.emit('customerBalanceUpdated', { customerId, newOutstanding: resultDoc.calculatedOutstanding });
    }

    toast(`Sales Return #${resultDoc.returnNumber} recorded! Stock restored by +${qty} ${unit}.`, 'success');
    return resultDoc;
  } catch (err) {
    console.error('Sales return error:', err);
    toast('Failed to record sales return.', 'error');
    throw err;
  }
}

/**
 * Saves a Purchase Return (Debit Note).
 * Stock DECREASES, supplier ledger / outstanding is debited.
 */
export async function savePurchaseReturn(returnData) {
  const {
    supplierId = '',
    supplierName = '',
    originalPurchaseNo = '',
    productId = '',
    productName = '',
    qty = 0,
    unit = 'KG',
    rate = 0,
    gstRate = 5,
    reason = '',
    returnDate = todayStr()
  } = returnData;

  if (!productId || qty <= 0) {
    toast('Invalid product or quantity for purchase return.', 'warning');
    return null;
  }

  const calc = calculateDocumentTotals([{ qty, rate, gstRate }]);

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      // ==========================================
      // PHASE 1: READ ALL DOCUMENTS FIRST
      // ==========================================
      const currentYear = new Date(returnDate).getFullYear();
      const counterRef = doc(db, 'counters', `purchase_returns_${currentYear}`);
      const counterSnap = await transaction.get(counterRef);

      const productRef = doc(db, 'products', productId);
      const prodSnap = await transaction.get(productRef);

      let supplierRef = null;
      let suppSnap = null;
      if (supplierId) {
        supplierRef = doc(db, 'suppliers', supplierId);
        suppSnap = await transaction.get(supplierRef);
      }

      // ==========================================
      // PHASE 2: PERFORM ALL WRITES SECOND
      // ==========================================
      let nextCounter = 1;
      if (counterSnap.exists()) {
        nextCounter = (Number(counterSnap.data().value) || 0) + 1;
        transaction.update(counterRef, { value: nextCounter });
      } else {
        transaction.set(counterRef, { value: 1 });
      }

      const returnNumber = formatDocumentNumber('DN', currentYear, nextCounter);

      // Decrease Stock for returned purchase item
      let calculatedStock = null;
      if (prodSnap.exists()) {
        const prevStock = Number(prodSnap.data().currentStock) || 0;
        calculatedStock = prevStock - Number(qty);
        transaction.update(productRef, {
          currentStock: calculatedStock,
          updatedAt: serverTimestamp()
        });

        // Stock movement log
        const movementRef = doc(collection(db, 'stock_movements'));
        transaction.set(movementRef, {
          productId,
          productName,
          type: 'PURCHASE_RETURN',
          referenceId: returnNumber,
          quantity: -Math.abs(Number(qty)),
          unit,
          previousStock: prevStock,
          newStock: calculatedStock,
          createdAt: serverTimestamp(),
          notes: `Purchase Return #${returnNumber} (Purchase Ref #${originalPurchaseNo || 'N/A'}) - Reason: ${reason}`
        });
      }

      // Supplier Ledger debit adjustment
      let calculatedOutstanding = null;
      if (supplierRef && suppSnap && suppSnap.exists()) {
        const prevOutstanding = Number(suppSnap.data().currentOutstanding) || 0;
        calculatedOutstanding = prevOutstanding - calc.grandTotal;

        transaction.update(supplierRef, {
          currentOutstanding: calculatedOutstanding,
          updatedAt: serverTimestamp()
        });

        // Ledger record
        const ledgerRef = doc(collection(db, 'supplier_ledger'));
        transaction.set(ledgerRef, {
          supplierId,
          supplierName,
          date: returnDate,
          referenceNumber: returnNumber,
          type: 'PURCHASE_RETURN',
          debit: calc.grandTotal,
          credit: 0,
          balance: calculatedOutstanding,
          createdAt: serverTimestamp()
        });
      }

      // Record Purchase Return document
      const returnRef = doc(collection(db, 'purchase_returns'));
      const record = {
        returnNumber,
        returnDate,
        supplierId: supplierId || null,
        supplierName,
        originalPurchaseNo,
        productId,
        productName,
        qty: Number(qty),
        unit,
        rate: Number(rate),
        gstRate: Number(gstRate),
        creditAmount: calc.grandTotal,
        reason,
        createdAt: serverTimestamp()
      };

      transaction.set(returnRef, record);
      return {
        id: returnRef.id,
        calculatedStock,
        calculatedOutstanding,
        ...record
      };
    });

    if (resultDoc.calculatedStock !== null && productId) {
      updateCachedProductStock(productId, resultDoc.calculatedStock);
      storeEvents.emit('stockUpdated', { productId, newStock: resultDoc.calculatedStock });
    }
    if (resultDoc.calculatedOutstanding !== null && supplierId) {
      updateCachedSupplierOutstanding(supplierId, resultDoc.calculatedOutstanding);
      storeEvents.emit('supplierBalanceUpdated', { supplierId, newOutstanding: resultDoc.calculatedOutstanding });
    }

    toast(`Purchase Return #${resultDoc.returnNumber} recorded! Stock reduced by -${qty} ${unit}.`, 'success');
    return resultDoc;
  } catch (err) {
    console.error('Purchase return error:', err);
    toast('Failed to record purchase return.', 'error');
    throw err;
  }
}
