/**
 * Akshara Spices Trades - Reusable GST Tax Engine & Numbering Helper
 */

/**
 * Calculates item totals including discount and GST split (Intra-state vs Interstate).
 * 
 * @param {Object} item 
 * @param {number} item.qty - Quantity
 * @param {number} item.rate - Unit Price Rate
 * @param {number} [item.discount=0] - Discount Percentage
 * @param {number} [item.gstRate=5] - GST Percentage (0, 5, 12, 18, 28)
 * @param {string} companyStateCode - Company State Code (e.g., "33")
 * @param {string} customerStateCode - Customer State Code (e.g., "33")
 * @returns {Object} Tax breakdown details
 */
export function calculateLineItem(item, companyStateCode = "33", customerStateCode = "33", invoiceType = "GST") {
  const qty = Math.max(0, Number(item.qty) || 0);
  const rate = Math.max(0, Number(item.rate) || 0);
  const grossAmount = qty * rate;
  let discountPct = 0;
  let discountAmount = 0;

  if (item.discountAmount !== undefined && item.discountAmount !== null && item.discountAmount !== '' && (item.discount === undefined || item.discount === null || item.discount === '' || Number(item.discount) === 0)) {
    discountAmount = Math.max(0, Math.min(grossAmount, Number(item.discountAmount) || 0));
    discountPct = grossAmount > 0 ? (discountAmount / grossAmount) * 100 : 0;
  } else {
    discountPct = Math.max(0, Math.min(100, Number(item.discount) || 0));
    discountAmount = (grossAmount * discountPct) / 100;
  }

  const isNonGst = String(invoiceType).toUpperCase() === 'NON_GST';
  const rawGstRate = Number(
    (item.gstRate !== undefined && item.gstRate !== null && item.gstRate !== '')
      ? item.gstRate
      : ((item.gst !== undefined && item.gst !== null && item.gst !== '') ? item.gst : 5)
  ) || 0;
  const gstRate = isNonGst ? 0 : rawGstRate;

  const taxableValue = Math.max(0, grossAmount - discountAmount);
  const totalGstAmount = isNonGst ? 0 : (taxableValue * gstRate) / 100;

  const isIntraState = String(companyStateCode).trim() === String(customerStateCode).trim();

  let cgstRate = 0, sgstRate = 0, igstRate = 0;
  let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

  if (!isNonGst) {
    if (isIntraState) {
      cgstRate = gstRate / 2;
      sgstRate = gstRate / 2;
      cgstAmount = totalGstAmount / 2;
      sgstAmount = totalGstAmount / 2;
    } else {
      igstRate = gstRate;
      igstAmount = totalGstAmount;
    }
  }

  const lineTotal = taxableValue + totalGstAmount;

  return {
    grossAmount: round2(grossAmount),
    discountAmount: round2(discountAmount),
    taxableValue: round2(taxableValue),
    gstRate: rawGstRate,
    appliedGstRate: gstRate,
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmount: round2(cgstAmount),
    sgstAmount: round2(sgstAmount),
    igstAmount: round2(igstAmount),
    totalGstAmount: round2(totalGstAmount),
    lineTotal: round2(lineTotal),
    isIntraState
  };
}

/**
 * Calculates aggregate totals for an invoice or purchase order.
 * 
 * @param {Array} items - List of item objects
 * @param {string} companyStateCode 
 * @param {string} customerStateCode 
 * @param {number} [freight=0] - Additional Freight/Transport charges
 * @param {number} [otherCharges=0] - Additional charges
 * @param {string} [invoiceType="GST"] - "GST" or "NON_GST"
 * @returns {Object} Aggregate document totals
 */
export function calculateDocumentTotals(items = [], companyStateCode = "33", customerStateCode = "33", freight = 0, otherCharges = 0, invoiceType = "GST", overallDiscountVal = 0, overallDiscountType = "amount") {
  // Support overload where caller passes: (items, companyState, customerState, overallDiscountVal, overallDiscountType, invoiceType)
  if (typeof otherCharges === 'string' && (otherCharges === 'amount' || otherCharges === 'percent')) {
    const passedOverallDiscountVal = freight;
    const passedOverallDiscountType = otherCharges;
    const passedInvoiceType = invoiceType;
    freight = 0;
    otherCharges = 0;
    invoiceType = passedInvoiceType || 'GST';
    overallDiscountVal = passedOverallDiscountVal;
    overallDiscountType = passedOverallDiscountType;
  }

  let subtotal = 0;
  let itemDiscountSum = 0;
  let itemTaxableSum = 0;

  const calculatedItems = items.map(item => {
    const calc = calculateLineItem(item, companyStateCode, customerStateCode, invoiceType);
    subtotal += calc.grossAmount;
    itemDiscountSum += calc.discountAmount;
    itemTaxableSum += calc.taxableValue;
    return { ...item, ...calc };
  });

  // Calculate overall document discount if provided
  let docDiscount = 0;
  const numDiscVal = Math.max(0, Number(overallDiscountVal) || 0);
  if (numDiscVal > 0) {
    let targetDocDisc = 0;
    if (overallDiscountType === 'percent') {
      targetDocDisc = (subtotal * Math.min(100, numDiscVal)) / 100;
    } else {
      targetDocDisc = Math.min(subtotal, numDiscVal);
    }
    if (targetDocDisc > itemDiscountSum) {
      docDiscount = targetDocDisc - itemDiscountSum;
    }
  }

  const totalDiscount = itemDiscountSum + docDiscount;
  const totalTaxable = Math.max(0, subtotal - totalDiscount);

  const isNonGst = String(invoiceType).toUpperCase() === 'NON_GST';
  const isIntraState = String(companyStateCode).trim() === String(customerStateCode).trim();

  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  if (!isNonGst) {
    calculatedItems.forEach(i => {
      const weight = itemTaxableSum > 0 ? (i.taxableValue / itemTaxableSum) : (1 / (calculatedItems.length || 1));
      const effectiveItemTaxable = Math.max(0, i.taxableValue - (docDiscount * weight));
      const itemGst = (effectiveItemTaxable * (i.appliedGstRate || 0)) / 100;
      if (isIntraState) {
        totalCgst += itemGst / 2;
        totalSgst += itemGst / 2;
      } else {
        totalIgst += itemGst;
      }
    });
  }

  totalCgst = round2(totalCgst);
  totalSgst = round2(totalSgst);
  totalIgst = round2(totalIgst);

  const totalGst = totalCgst + totalSgst + totalIgst;
  const extraCharges = (Number(freight) || 0) + (Number(otherCharges) || 0);
  const rawGrandTotal = totalTaxable + totalGst + extraCharges;

  const roundedGrandTotal = Math.round(rawGrandTotal);
  const roundOff = round2(roundedGrandTotal - rawGrandTotal);

  return {
    items: calculatedItems,
    subtotal: round2(subtotal),
    totalDiscount: round2(totalDiscount),
    overallDiscountVal: numDiscVal,
    overallDiscountType: overallDiscountType || 'amount',
    totalTaxable: round2(totalTaxable),
    totalCgst,
    totalSgst,
    totalIgst,
    totalGst,
    freight: round2(freight),
    otherCharges: round2(otherCharges),
    rawGrandTotal: round2(rawGrandTotal),
    roundOff,
    grandTotal: roundedGrandTotal,
    isIntraState
  };
}

/**
 * Returns Indian Financial Year format string e.g. "2026-27"
 */
export function getCurrentFinancialYear(date = new Date()) {
  const d = new Date(date);
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

/**
 * Generates formatted document number string (e.g. AST-2026-0001)
 */
export function formatDocumentNumber(prefix = "AST", year = new Date().getFullYear(), counter = 1) {
  const padded = String(counter).padStart(4, '0');
  return `${prefix}-${year}-${padded}`;
}

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}
