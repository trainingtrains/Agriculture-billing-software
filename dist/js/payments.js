/**
 * Akshara Spices Trades - Accounting & Payments Module
 */

import { db, doc, collection, getDocs, runTransaction, serverTimestamp, query, orderBy, limit } from './firebase.js';
import { loadCustomers } from './customers.js';
import { loadSuppliers } from './suppliers.js';
import { money, toast, todayStr } from './utils.js';
import { updateCachedCustomerOutstanding, updateCachedSupplierOutstanding } from './cache.js';
import { storeEvents } from './store.js';

/**
 * Record Customer Payment received.
 * Reduces Customer Outstanding and adds Credit entry in Customer Ledger.
 */
export async function recordCustomerPayment(paymentData) {
  const {
    customerId = '',
    customerName = '',
    amount = 0,
    paymentMode = 'Cash',
    referenceNo = '',
    paymentDate = todayStr(),
    notes = ''
  } = paymentData;

  const payAmount = Number(amount);
  if (!customerId || isNaN(payAmount) || payAmount <= 0) {
    toast('Please select a customer and enter a valid positive payment amount.', 'warning');
    return false;
  }

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      const customerRef = doc(db, 'customers', customerId);
      const custSnap = await transaction.get(customerRef);
      if (!custSnap.exists()) throw new Error('Customer record not found.');

      const prevOutstanding = Number(custSnap.data().currentOutstanding) || 0;
      const newOutstanding = prevOutstanding - payAmount;

      // Update customer outstanding
      transaction.update(customerRef, {
        currentOutstanding: newOutstanding,
        updatedAt: serverTimestamp()
      });

      // Customer Ledger entry
      const ledgerRef = doc(collection(db, 'customer_ledger'));
      transaction.set(ledgerRef, {
        customerId,
        customerName: customerName || custSnap.data().customerName,
        date: paymentDate,
        referenceNumber: referenceNo || `RCPT-${Date.now().toString().slice(-6)}`,
        type: 'PAYMENT',
        debit: 0,
        credit: payAmount,
        balance: newOutstanding,
        notes: `Payment received via ${paymentMode}. ${notes}`,
        createdAt: serverTimestamp()
      });

      // Customer Payment record
      const payRef = doc(collection(db, 'customer_payments'));
      const payload = {
        customerId,
        customerName: customerName || custSnap.data().customerName,
        paymentDate,
        amount: payAmount,
        paymentMode,
        referenceNo,
        notes,
        createdAt: serverTimestamp()
      };
      transaction.set(payRef, payload);

      return { id: payRef.id, newOutstanding, ...payload };
    });

    if (resultDoc.newOutstanding !== undefined && customerId) {
      updateCachedCustomerOutstanding(customerId, resultDoc.newOutstanding);
      storeEvents.emit('customerBalanceUpdated', { customerId, newOutstanding: resultDoc.newOutstanding });
    }

    toast(`Payment of ${money(payAmount)} received from ${customerName}! Outstanding updated.`, 'success');
    return resultDoc;
  } catch (err) {
    console.error('Customer payment error:', err);
    toast(err.message || 'Failed to record customer payment.', 'error');
    return false;
  }
}

/**
 * Record Supplier Payment made.
 * Reduces Supplier Outstanding and adds Debit entry in Supplier Ledger.
 */
export async function recordSupplierPayment(paymentData) {
  const {
    supplierId = '',
    supplierName = '',
    amount = 0,
    paymentMode = 'Bank Transfer',
    referenceNo = '',
    paymentDate = todayStr(),
    notes = ''
  } = paymentData;

  const payAmount = Number(amount);
  if (!supplierId || isNaN(payAmount) || payAmount <= 0) {
    toast('Please select a supplier and enter a valid positive payment amount.', 'warning');
    return false;
  }

  try {
    const resultDoc = await runTransaction(db, async (transaction) => {
      const supplierRef = doc(db, 'suppliers', supplierId);
      const suppSnap = await transaction.get(supplierRef);
      if (!suppSnap.exists()) throw new Error('Supplier record not found.');

      const prevOutstanding = Number(suppSnap.data().currentOutstanding) || 0;
      const newOutstanding = prevOutstanding - payAmount;

      // Update supplier outstanding
      transaction.update(supplierRef, {
        currentOutstanding: newOutstanding,
        updatedAt: serverTimestamp()
      });

      // Supplier Ledger entry
      const ledgerRef = doc(collection(db, 'supplier_ledger'));
      transaction.set(ledgerRef, {
        supplierId,
        supplierName: supplierName || suppSnap.data().supplierName,
        date: paymentDate,
        referenceNumber: referenceNo || `PAY-${Date.now().toString().slice(-6)}`,
        type: 'PAYMENT',
        debit: payAmount,
        credit: 0,
        balance: newOutstanding,
        notes: `Payment made via ${paymentMode}. ${notes}`,
        createdAt: serverTimestamp()
      });

      // Supplier Payment record
      const payRef = doc(collection(db, 'supplier_payments'));
      const payload = {
        supplierId,
        supplierName: supplierName || suppSnap.data().supplierName,
        paymentDate,
        amount: payAmount,
        paymentMode,
        referenceNo,
        notes,
        createdAt: serverTimestamp()
      };
      transaction.set(payRef, payload);

      return { id: payRef.id, newOutstanding, ...payload };
    });

    if (resultDoc.newOutstanding !== undefined && supplierId) {
      updateCachedSupplierOutstanding(supplierId, resultDoc.newOutstanding);
      storeEvents.emit('supplierBalanceUpdated', { supplierId, newOutstanding: resultDoc.newOutstanding });
    }

    toast(`Payment of ${money(payAmount)} to ${supplierName} recorded!`, 'success');
    return resultDoc;
  } catch (err) {
    console.error('Supplier payment error:', err);
    toast(err.message || 'Failed to record supplier payment.', 'error');
    return false;
  }
}

/**
 * Fetch customer payments history.
 */
export async function fetchCustomerPayments(limitCount = 50) {
  try {
    const q = query(collection(db, 'customer_payments'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const docs = [];
    snap.forEach(docSnap => docs.push({ id: docSnap.id, ...docSnap.data() }));
    return docs;
  } catch (err) {
    console.error('Fetch customer payments error:', err);
    return [];
  }
}

/**
 * Fetch supplier payments history.
 */
export async function fetchSupplierPayments(limitCount = 50) {
  try {
    const q = query(collection(db, 'supplier_payments'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const docs = [];
    snap.forEach(docSnap => docs.push({ id: docSnap.id, ...docSnap.data() }));
    return docs;
  } catch (err) {
    console.error('Fetch supplier payments error:', err);
    return [];
  }
}
