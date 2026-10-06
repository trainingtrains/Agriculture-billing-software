/**
 * Akshara Spices Trades - Quotation & Estimation Module
 */

import { auth, db, doc, collection, getDocs, addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, query, orderBy, limit, startAfter } from './firebase.js';
import { calculateDocumentTotals, formatDocumentNumber } from './gst.js';
import { companySettings, saveInvoice } from './billing.js';
import { money, toast, todayStr, addDaysStr } from './utils.js';

/**
 * Saves a Quotation to Firestore.
 * Does NOT deduct stock.
 */
export async function saveQuotation(quotationData) {
  if (!quotationData.items || quotationData.items.length === 0) {
    toast('Cannot save empty quotation.', 'warning');
    return null;
  }

  const {
    customerName = 'Prospective Customer',
    customerId = '',
    phone = '',
    customerGstin = '',
    customerStateCode = '33',
    billingAddress = '',
    validUntil = addDaysStr(15),
    notes = '',
    date = todayStr()
  } = quotationData;

  const invType = (quotationData.invoiceType || ((customerGstin || quotationData.customerGstin) ? 'GST' : 'NON_GST')).toUpperCase() === 'NON_GST' ? 'NON_GST' : 'GST';

  const totals = calculateDocumentTotals(
    quotationData.items,
    companySettings.stateCode || '33',
    customerStateCode || '33',
    0,
    0,
    invType,
    quotationData.overallDiscountVal || 0,
    quotationData.overallDiscountType || 'amount'
  );

  try {
    const currentYear = new Date(date).getFullYear();
    // Atomic numbering counter for quotations
    let quotationNumber = '';
    await runTransaction(db, async (transaction) => {
      const counterRef = doc(db, 'counters', `quotations_${currentYear}`);
      const counterSnap = await transaction.get(counterRef);
      let nextCounter = 1;
      if (counterSnap.exists()) {
        nextCounter = (Number(counterSnap.data().value) || 0) + 1;
        transaction.update(counterRef, { value: nextCounter });
      } else {
        transaction.set(counterRef, { value: 1 });
      }
      quotationNumber = formatDocumentNumber('QUO', currentYear, nextCounter);
    });

    const payload = {
      quotationNumber,
      quotationDate: date,
      validUntil,
      invoiceType: invType,
      overallDiscountVal: quotationData.overallDiscountVal || 0,
      overallDiscountType: quotationData.overallDiscountType || 'amount',
      customerId: customerId || null,
      customerName,
      phone,
      customerGstin,
      customerStateCode,
      billingAddress,
      notes,
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
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal
      },
      status: 'DRAFT',
      createdAt: serverTimestamp()
    };

    const ref = await addDoc(collection(db, 'quotations'), payload);
    toast(`Quotation #${quotationNumber} saved successfully!`, 'success');
    return { id: ref.id, ...payload };
  } catch (err) {
    console.error('Save quotation error:', err);
    toast('Failed to save quotation.', 'error');
    throw err;
  }
}

/**
 * Converts a Quotation into a live GST Invoice.
 * Deducts stock & updates customer ledger upon conversion.
 */
export async function convertQuotationToInvoice(quotation) {
  const hasGstin = Boolean(quotation.customerGstin && quotation.customerGstin.trim());
  const invType = quotation.invoiceType || (hasGstin ? 'GST' : 'NON_GST');

  if (!confirm(`Convert Quotation #${quotation.quotationNumber} to ${invType === 'NON_GST' ? 'Non-GST Bill' : 'GST Invoice'}? This will deduct stock and generate an invoice.`)) return null;

  try {
    const invoicePayload = {
      invoiceType: invType,
      overallDiscountVal: quotation.overallDiscountVal || 0,
      overallDiscountType: quotation.overallDiscountType || 'amount',
      customerId: quotation.customerId || null,
      customerName: quotation.customerName || 'Walk-in Customer',
      phone: quotation.phone || '',
      customerGstin: hasGstin ? quotation.customerGstin.trim().toUpperCase() : '',
      customerStateCode: quotation.customerStateCode || '33',
      billingAddress: quotation.billingAddress || '',
      paymentMode: 'Cash',
      notes: `Converted from Quotation #${quotation.quotationNumber}. ${quotation.notes || ''}`,
      date: todayStr(),
      items: (quotation.itemsSnapshot || []).map(i => ({
        productId: i.productId || null,
        productName: i.productName || i.name,
        hsn: i.hsn || i.hsnCode || '',
        qty: Number(i.qty),
        unit: i.unit || 'KG',
        rate: Number(i.rate),
        discount: Number(i.discount || 0),
        gstRate: Number(i.gstRate || i.gst || 0)
      }))
    };

    const createdInvoice = await saveInvoice(invoicePayload);
    if (createdInvoice) {
      // Mark quotation as CONVERTED
      await updateDoc(doc(db, 'quotations', quotation.id), {
        status: 'CONVERTED',
        convertedInvoiceNumber: createdInvoice.invoiceNumber,
        updatedAt: serverTimestamp()
      });
      toast(`Quotation #${quotation.quotationNumber} converted to Invoice #${createdInvoice.invoiceNumber}!`, 'success');
    }
    return createdInvoice;
  } catch (err) {
    console.error('Convert quotation error:', err);
    toast(err.message || 'Failed to convert quotation to invoice.', 'error');
    return null;
  }
}

/**
 * Fetch quotations list.
 */
export async function fetchQuotations(limitCount = 50) {
  if (!auth || !auth.currentUser) return [];
  try {
    const q = query(collection(db, 'quotations'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const docs = [];
    snap.forEach(docSnap => docs.push({ id: docSnap.id, ...docSnap.data() }));
    return docs;
  } catch (err) {
    console.error('Fetch quotations error:', err);
    return [];
  }
}

/**
 * Fetch paginated quotations using Firestore cursor.
 */
export async function fetchQuotationsPage(pageSize = 25, lastVisibleDoc = null) {
  if (!auth || !auth.currentUser) return { quotations: [], lastDoc: null, hasMore: false };
  try {
    let q = query(collection(db, 'quotations'), orderBy('createdAt', 'desc'), limit(pageSize));
    if (lastVisibleDoc) {
      q = query(collection(db, 'quotations'), orderBy('createdAt', 'desc'), startAfter(lastVisibleDoc), limit(pageSize));
    }
    const snap = await getDocs(q);
    const docs = [];
    let newLastDoc = null;
    snap.forEach(docSnap => {
      docs.push({ id: docSnap.id, ...docSnap.data() });
      newLastDoc = docSnap;
    });
    return {
      quotations: docs,
      lastDoc: newLastDoc,
      hasMore: docs.length === pageSize
    };
  } catch (err) {
    console.error('Fetch quotations page error:', err);
    return { quotations: [], lastDoc: null, hasMore: false };
  }
}
