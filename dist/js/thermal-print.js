/**
 * Custom Billing Software - Invoice & Thermal Receipt Printing Module
 */

import { money, numberToWords, formatDate, esc, getPaymentStatusInfo } from './utils.js';

/**
 * Generates HTML markup for A4 GST Tax Invoice / Commercial Quotation / Purchase Record or Thermal Receipt.
 */
export function generatePrintHTML(documentData, paperSize = 'a4') {
  const {
    invoiceNumber = '',
    quotationNumber = '',
    purchaseNumber = '',
    invoiceDate = '',
    quotationDate = '',
    purchaseDate = '',
    validUntil = '',
    customerName = 'Walk-in Customer',
    supplierName = '',
    contactPerson = 'Purchase Manager',
    phone = '',
    customerGstin = '',
    supplierGstin = '',
    customerStateCode = '33',
    billingAddress = '',
    paymentMode = 'Cash',
    companySnapshot = {},
    itemsSnapshot = [],
    totals: rawTotalsInput = {}
  } = documentData;

  const rawTotals = rawTotalsInput || {};
  const totals = {
    subtotal: rawTotals.subtotal ?? documentData.subtotal ?? documentData.taxableValue ?? documentData.grandTotal ?? 0,
    totalTaxable: rawTotals.totalTaxable ?? documentData.taxableValue ?? 0,
    totalDiscount: rawTotals.totalDiscount ?? documentData.totalDiscount ?? 0,
    totalCgst: rawTotals.totalCgst ?? documentData.cgst ?? 0,
    totalSgst: rawTotals.totalSgst ?? documentData.sgst ?? 0,
    totalIgst: rawTotals.totalIgst ?? documentData.igst ?? 0,
    totalGst: rawTotals.totalGst ?? ((documentData.cgst || 0) + (documentData.sgst || 0) + (documentData.igst || 0)),
    freight: rawTotals.freight ?? documentData.freight ?? 0,
    grandTotal: rawTotals.grandTotal ?? documentData.grandTotal ?? 0,
    isIntraState: rawTotals.isIntraState ?? (documentData.customerStateCode ? (documentData.customerStateCode === (companySnapshot.stateCode || '33')) : true)
  };

  const isQuotation = Boolean(quotationNumber) || (documentData.quotationDate !== undefined);
  const isPurchase = Boolean(purchaseNumber) || (documentData.purchaseDate !== undefined);
  const invType = (documentData.invoiceType || ((totals.totalGst > 0 || customerGstin || supplierGstin) ? 'GST' : 'NON_GST')).toUpperCase();
  const isNonGst = !isQuotation && !isPurchase && invType === 'NON_GST';

  const docNo = isQuotation ? (quotationNumber || 'AST/QTN/2026-27/0104') : (isPurchase ? (purchaseNumber || 'PUR-2026-0001') : (invoiceNumber || 'AST/INV/26-27/0215'));
  const docDate = isQuotation ? (quotationDate || invoiceDate) : (isPurchase ? (purchaseDate || invoiceDate) : invoiceDate);

  const payStatus = getPaymentStatusInfo(documentData, isPurchase ? 'purchase' : 'sales');

  const compName = (!companySnapshot.name || companySnapshot.name === 'CUSTOM BILLING SOFTWARE') ? 'S M AGRI TECH' : companySnapshot.name;
  const comp = {
    name: compName,
    subtitle: companySnapshot.subtitle || companySnapshot.tagline || 'Agriculture Chemicals & Fertilizers · Thalavadi',
    logoUrl: companySnapshot.logoUrl || 'logo.png',
    address: companySnapshot.address || 'Thalavadi, Erode District, Tamil Nadu',
    phone: companySnapshot.phone || '+91 98765 43210',
    email: companySnapshot.email || 'contact@smagritech.com',
    gstin: companySnapshot.gstin || '33AAAAA0000A1Z5',
    bankAccountName: companySnapshot.bankAccountName || compName,
    bankAccountType: companySnapshot.bankAccountType || 'Current Account',
    bankName: companySnapshot.bankName || 'State Bank of India',
    bankAccountNo: companySnapshot.bankAccountNo || '123456789012',
    bankIfsc: companySnapshot.bankIfsc || 'SBIN0001234',
    bankBranch: companySnapshot.bankBranch || 'Thalavadi Branch',
    terms: companySnapshot.terms || '1. Goods once sold are subject to standard company warranty policy.\n2. Interest @ 18% p.a. will be charged on overdue payments.\n3. Subject to local court jurisdiction.'
  };

  const isThermal = paperSize === '58' || paperSize === '80';

  // THERMAL RECEIPT LAYOUT WITH LOGO
  if (isThermal) {
    return `
      <div class="thermal-receipt paper-${paperSize}">
        <div style="text-align:center;margin-bottom:8px;">
          <img src="${esc(comp.logoUrl)}" alt="${esc(comp.name)} Logo" class="thermal-logo" style="width:65px;height:65px;object-fit:contain;margin:0 auto;display:block;" onerror="this.style.display='none'">
        </div>
        <div class="text-center bold title" style="font-size:15px;font-weight:800;color:#0B4D2C;">${esc(comp.name)}</div>
        <div class="text-center small" style="font-weight:700;color:#d97706;font-size:10px;margin-bottom:4px;">${esc(comp.subtitle)}</div>
        <div class="text-center small">${esc(comp.address)}</div>
        <div class="text-center small" style="font-weight:700;margin-top:2px;">${isNonGst ? `Ph: ${esc(comp.phone)}` : `GSTIN: ${esc(comp.gstin)} | Ph: ${esc(comp.phone)}`}</div>
        <div class="divider">--------------------------------</div>
        <div class="flex-between small" style="margin:4px 0;">
          <span><strong>${isQuotation ? 'Quotation #' : (isPurchase ? 'Purchase #' : (isNonGst ? 'Non-GST Bill #' : 'GST Invoice #'))}:</strong> ${esc(docNo)}</span>
        </div>
        <div class="flex-between small" style="margin:4px 0;">
          <span><strong>Date:</strong> ${formatDate(docDate)}</span>
        </div>
        <div class="small" style="margin:4px 0;"><strong>${isPurchase ? 'Supplier:' : 'Customer:'}</strong> ${esc(isPurchase ? (supplierName || customerName) : customerName)}</div>
        ${(!isNonGst && (customerGstin || supplierGstin)) ? `<div class="small" style="margin:4px 0;"><strong>GSTIN:</strong> ${esc(isPurchase ? supplierGstin : customerGstin)}</div>` : ''}
        <div class="divider">--------------------------------</div>
        <table class="thermal-table">
          <thead>
            <tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Total</th></tr>
          </thead>
          <tbody>
            ${itemsSnapshot.map(item => `
              <tr>
                <td><strong>${esc(item.productName || item.name)}</strong></td>
                <td style="text-align:center;">${item.qty} ${esc(item.unit || '')}</td>
                <td style="text-align:right;">${item.rate}</td>
                <td style="text-align:right;"><strong>${money(item.lineTotal || (item.qty * item.rate))}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="divider">--------------------------------</div>
        ${isNonGst ? `
          <div class="flex-between small"><span>Subtotal:</span><span>${money(totals.subtotal || totals.totalTaxable)}</span></div>
          ${totals.totalDiscount ? `<div class="flex-between small"><span>Discount:</span><span>${money(totals.totalDiscount)}</span></div>` : ''}
        ` : `
          <div class="flex-between small"><span>Taxable Value:</span><span>${money(totals.totalTaxable)}</span></div>
          ${totals.isIntraState ? `
            <div class="flex-between small"><span>CGST:</span><span>${money(totals.totalCgst)}</span></div>
            <div class="flex-between small"><span>SGST:</span><span>${money(totals.totalSgst)}</span></div>
          ` : `
            <div class="flex-between small"><span>IGST:</span><span>${money(totals.totalIgst)}</span></div>
          `}
        `}
        ${totals.freight ? `<div class="flex-between small"><span>Freight:</span><span>${money(totals.freight)}</span></div>` : ''}
        <div class="divider">--------------------------------</div>
        <div class="flex-between bold grand-total" style="font-size:14px;color:#0B4D2C;padding:4px 0;"><span>GRAND TOTAL:</span><span>${money(totals.grandTotal)}</span></div>
        <div class="small">Payment Mode: ${esc(paymentMode)}</div>
        <div class="small">Payment Status: <strong>${esc(payStatus.statusText)}</strong></div>
        ${documentData.payableStatus === 'advance' && documentData.advanceAmount ? `
          <div class="flex-between small"><span>Advance Paid:</span><span>${money(documentData.advanceAmount)}</span></div>
          <div class="flex-between small"><span>Balance Due:</span><span>${money(Math.max(0, totals.grandTotal - documentData.advanceAmount))}</span></div>
        ` : ''}
        <div class="divider">--------------------------------</div>
        <div class="text-center small margin-top" style="font-weight:700;">Thank you for your business</div>
        <div class="text-center extra-small">${esc(comp.subtitle)}</div>
      </div>
    `;
  }

  // A4 OFFICIAL PDF FORMAT MATCHING Akshara_Spices_Quotation_and_Billing_Format.pdf
  return `
    <div class="pdf-format">
      <!-- HEADER BRAND -->
      <div class="pdf-header">
        <div class="pdf-brand">
          <img src="${esc(comp.logoUrl)}" alt="${esc(comp.name)} Logo" class="pdf-logo" onerror="this.style.display='none'">
          <div>
            <h1 class="pdf-brand-title">${esc(comp.name)}</h1>
            <div class="pdf-brand-subtitle">${esc(comp.subtitle)}</div>
            <div class="pdf-brand-address">${esc(comp.address)}</div>
            <div class="pdf-brand-address">Mobile: ${esc(comp.phone)} | Email: ${esc(comp.email)}</div>
            ${isNonGst ? '' : `<div class="pdf-gstin-badge">GSTIN: ${esc(comp.gstin)}</div>`}
          </div>
        </div>
      </div>

      <!-- TITLE BANNER -->
      <div class="pdf-banner">
        ${isQuotation ? 'COMMERCIAL QUOTATION' : (isPurchase ? 'PURCHASE INVOICE RECORD' : (isNonGst ? 'NON-GST RETAIL BILL / BILL OF SUPPLY' : 'TAX INVOICE'))}
      </div>

      <!-- METADATA GRID -->
      <div class="pdf-meta-grid">
        <div class="pdf-box">
          <div class="pdf-box-title">${isQuotation ? 'QUOTATION DETAILS' : (isPurchase ? 'PURCHASE RECORD DETAILS' : 'INVOICE & DISPATCH DETAILS')}</div>
          <div class="pdf-box-content">
            <table>
              <tr><td class="label">${isQuotation ? 'Quotation No:' : (isPurchase ? 'Purchase No:' : 'Invoice No:')}</td><td><strong>${esc(docNo)}</strong></td></tr>
              <tr><td class="label">${isQuotation ? 'Date:' : (isPurchase ? 'Purchase Date:' : 'Invoice Date:')}</td><td>${formatDate(docDate)}</td></tr>
              ${isPurchase && documentData.supplierInvoiceNo ? `<tr><td class="label">Supplier Inv No:</td><td><strong>${esc(documentData.supplierInvoiceNo)}</strong></td></tr>` : ''}
              ${!isQuotation ? `<tr><td class="label">Payment Status:</td><td><span class="badge ${payStatus.badgeClass}" style="font-size:10.5px;padding:3px 10px;display:inline-block;">${esc(payStatus.statusText)}</span></td></tr>` : ''}
              ${!isQuotation && documentData.payableStatus === 'advance' && documentData.advanceAmount ? `
                <tr><td class="label">Advance Paid:</td><td><strong>${money(documentData.advanceAmount)}</strong></td></tr>
                <tr><td class="label">Balance Due:</td><td><strong style="color:#c2410c;">${money(Math.max(0, totals.grandTotal - documentData.advanceAmount))}</strong></td></tr>
              ` : ''}
              ${isQuotation ? `
                <tr><td class="label">Validity Period:</td><td>${validUntil ? formatDate(validUntil) : '7 Days from Date of Issue'}</td></tr>
                <tr><td class="label">Place of Supply:</td><td>Chennai, Tamil Nadu (33)</td></tr>
              ` : `
                <tr><td class="label">${isPurchase ? 'Record Type:' : 'Invoice Type:'}</td><td><strong>${isPurchase ? 'Stock Purchase' : (isNonGst ? 'Non-GST Bill' : 'GST Tax Invoice')}</strong></td></tr>
                <tr><td class="label">Dispatch Mode:</td><td>Road Transport / Courier</td></tr>
                <tr><td class="label">Place of Supply:</td><td>${totals.isIntraState ? 'Chennai, Tamil Nadu (33)' : 'Interstate'}</td></tr>
              `}
            </table>
          </div>
        </div>

        <div class="pdf-box">
          <div class="pdf-box-title">${isQuotation ? 'QUOTATION TO (CUSTOMER)' : (isPurchase ? 'SUPPLIER DETAILS' : 'BILLED TO (BUYER DETAILS)')}</div>
          <div class="pdf-box-content">
            <table>
              <tr><td class="label">${isPurchase ? 'Supplier Name:' : 'Customer Name:'}</td><td><strong>${esc(isPurchase ? (supplierName || customerName) : customerName)}</strong></td></tr>
              ${isPurchase ? `
                <tr><td class="label">Supplier GSTIN:</td><td><strong>${esc(supplierGstin || 'Unregistered')}</strong></td></tr>
                <tr><td class="label">State & Code:</td><td>${documentData.supplierStateCode || '33'}</td></tr>
              ` : `
                ${contactPerson ? `<tr><td class="label">Contact Person:</td><td>${esc(contactPerson)}</td></tr>` : ''}
                <tr><td class="label">Address:</td><td>${esc(billingAddress || 'Shop Counter, Chennai')}</td></tr>
                <tr><td class="label">Mobile / Phone:</td><td>${esc(phone || '—')}</td></tr>
                ${isNonGst ? '' : `
                  <tr><td class="label">Customer GSTIN:</td><td><strong>${esc(customerGstin || 'Unregistered B2C')}</strong></td></tr>
                  ${!isQuotation ? `<tr><td class="label">State & Code:</td><td>Tamil Nadu (33)</td></tr>` : ''}
                `}
              `}
            </table>
          </div>
        </div>
      </div>

      <!-- ITEMS TABLE -->
      <div class="pdf-table-wrap">
        <table class="pdf-table">
          <thead>
            ${isQuotation ? `
              <tr>
                <th style="width:40px;">S.No</th>
                <th>Item Description</th>
                <th style="width:70px;">HSN Code</th>
                <th style="width:90px;">Pack Size</th>
                <th style="width:50px;">Qty</th>
                <th style="width:85px;text-align:right;">Rate / Unit (₹)</th>
                <th style="width:55px;text-align:center;">GST %</th>
                <th style="width:95px;text-align:right;">Total (₹)</th>
              </tr>
            ` : (isNonGst ? `
              <tr>
                <th style="width:30px;">#</th>
                <th>Description of Goods</th>
                <th style="width:80px;">Pack Unit</th>
                <th style="width:60px;text-align:center;">Qty</th>
                <th style="width:100px;text-align:right;">Rate (₹)</th>
                <th style="width:120px;text-align:right;">Total Amount (₹)</th>
              </tr>
            ` : `
              <tr>
                <th style="width:30px;">#</th>
                <th>Description of Goods</th>
                <th style="width:65px;">HSN</th>
                <th style="width:45px;">Qty</th>
                <th style="width:75px;text-align:right;">Rate (₹)</th>
                <th style="width:85px;text-align:right;">Taxable (₹)</th>
                <th style="width:75px;text-align:right;">CGST (₹)</th>
                <th style="width:75px;text-align:right;">SGST (₹)</th>
                <th style="width:90px;text-align:right;">Total (₹)</th>
              </tr>
            `)}
          </thead>
          <tbody>
            ${itemsSnapshot.map((item, idx) => {
              if (isQuotation) {
                return `
                  <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td><strong>${esc(item.productName || item.name)}</strong></td>
                    <td>${esc(item.hsn || item.hsnCode || '—')}</td>
                    <td>${esc(item.unit || '250g Pouch')}</td>
                    <td style="text-align:center;">${item.qty} Nos</td>
                    <td style="text-align:right;">${(item.rate || 0).toFixed(2)}</td>
                    <td style="text-align:center;">${item.gstRate || item.gst || 5}%</td>
                    <td style="text-align:right;"><strong>${(item.lineTotal || (item.qty * item.rate)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                  </tr>
                `;
              } else if (isNonGst) {
                return `
                  <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td><strong>${esc(item.productName || item.name)}</strong></td>
                    <td>${esc(item.unit || 'KG')}</td>
                    <td style="text-align:center;">${item.qty}</td>
                    <td style="text-align:right;">${(item.rate || 0).toFixed(2)}</td>
                    <td style="text-align:right;"><strong>${(item.lineTotal || (item.qty * item.rate)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                  </tr>
                `;
              } else {
                return `
                  <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td><strong>${esc(item.productName || item.name)}</strong><br><small style="color:#666;">Pack: ${esc(item.unit || 'Zip Pouch')}</small></td>
                    <td>${esc(item.hsn || item.hsnCode || '—')}</td>
                    <td style="text-align:center;">${item.qty}</td>
                    <td style="text-align:right;">${(item.rate || 0).toFixed(2)}</td>
                    <td style="text-align:right;">${(item.taxableValue || (item.qty * item.rate)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td style="text-align:right;">${(item.cgstAmount || 0).toFixed(2)}<br><small>(${(item.appliedGstRate || item.gstRate || 5) / 2}%)</small></td>
                    <td style="text-align:right;">${(item.sgstAmount || 0).toFixed(2)}<br><small>(${(item.appliedGstRate || item.gstRate || 5) / 2}%)</small></td>
                    <td style="text-align:right;"><strong>${(item.lineTotal || (item.qty * item.rate)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                  </tr>
                `;
              }
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- BOTTOM GRID: BANK DETAILS & TOTALS -->
      <div class="pdf-bottom-grid">
        <div class="pdf-box">
          <div class="pdf-box-title">BANK ACCOUNT DETAILS (FOR NEFT / RTGS / UPI)</div>
          <div class="pdf-box-content">
            <table>
              <tr><td class="label">Account Name:</td><td><strong>${esc(comp.bankAccountName)}</strong></td></tr>
              <tr><td class="label">Account Type:</td><td>${esc(comp.bankAccountType)}</td></tr>
              <tr><td class="label">Bank Name:</td><td>${esc(comp.bankName)}</td></tr>
              <tr><td class="label">Account No:</td><td><strong>${esc(comp.bankAccountNo)}</strong></td></tr>
              <tr><td class="label">IFSC Code:</td><td><strong>${esc(comp.bankIfsc)}</strong></td></tr>
              <tr><td class="label">Branch:</td><td>${esc(comp.bankBranch)}</td></tr>
            </table>
          </div>
        </div>

        <div class="pdf-box" style="border-color:#0B4D2C;">
          <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
            ${isNonGst ? `
              <tr><td style="padding:6px 10px;font-weight:700;">Subtotal</td><td style="padding:6px 10px;text-align:right;">${money(totals.subtotal || totals.totalTaxable)}</td></tr>
              ${totals.totalDiscount ? `<tr><td style="padding:6px 10px;">Discount</td><td style="padding:6px 10px;text-align:right;">-${money(totals.totalDiscount)}</td></tr>` : ''}
            ` : `
              <tr><td style="padding:6px 10px;font-weight:700;">Taxable Subtotal</td><td style="padding:6px 10px;text-align:right;">${money(totals.totalTaxable)}</td></tr>
              ${totals.isIntraState ? `
                <tr><td style="padding:6px 10px;">CGST</td><td style="padding:6px 10px;text-align:right;">${money(totals.totalCgst)}</td></tr>
                <tr><td style="padding:6px 10px;">SGST</td><td style="padding:6px 10px;text-align:right;">${money(totals.totalSgst)}</td></tr>
              ` : `
                <tr><td style="padding:6px 10px;">IGST (Inter-state)</td><td style="padding:6px 10px;text-align:right;">${money(totals.totalIgst)}</td></tr>
              `}
            `}
            ${totals.freight ? `<tr><td style="padding:6px 10px;">Freight & Packaging</td><td style="padding:6px 10px;text-align:right;">${money(totals.freight)}</td></tr>` : ''}
            ${totals.roundOff ? `<tr><td style="padding:6px 10px;">Round Off (+/-)</td><td style="padding:6px 10px;text-align:right;">${totals.roundOff}</td></tr>` : ''}
            <tr style="background:#0B4D2C;color:white;font-weight:800;font-size:13px;">
              <td style="padding:8px 10px;">${isQuotation ? 'Grand Total' : (isNonGst ? 'Bill Total' : 'Invoice Total')}</td>
              <td style="padding:8px 10px;text-align:right;">${money(totals.grandTotal)}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- AMOUNT IN WORDS -->
      <div class="pdf-words-box">
        <strong>Amount in Words:</strong> ${numberToWords(totals.grandTotal)}
      </div>

      <!-- TERMS & SIGNATURE -->
      <div class="pdf-footer-grid">
        <div style="font-size:10.5px;color:#374151;">
          <strong>${isQuotation ? 'Terms & Conditions:' : 'Declaration & Terms:'}</strong>
          ${isQuotation ? `
            <ol style="margin:4px 0 0 16px;padding:0;line-height:1.4;">
              <li>Rates quoted are valid for 7 days from the date of quote due to agricultural price volatility.</li>
              <li>Payment Terms: 100% advance or against delivery as agreed prior to dispatch.</li>
              <li>Goods will be dispatched within 2 working days upon confirmation of Purchase Order.</li>
              <li>Disputes, if any, shall be subject to Chennai Jurisdiction only.</li>
            </ol>
          ` : `
            <ol style="margin:4px 0 0 16px;padding:0;line-height:1.4;">
              <li>We declare that this invoice/bill shows the actual price of the goods described and that all particulars are true and correct.</li>
              <li>Goods once sold will not be taken back or exchanged.</li>
              <li>Interest @ 18% p.a. will be charged if the bill is not paid within the credit period.</li>
              <li>Subject to Chennai Jurisdiction.</li>
            </ol>
          `}
        </div>

        <div class="pdf-sign-box">
          <div>For <strong>${esc(comp.name)}</strong></div>
          <div style="font-weight:700;margin-top:40px;border-top:1px solid #9ca3af;padding-top:4px;">Authorized Signatory</div>
        </div>
      </div>

      <!-- FOOTER THANK YOU -->
      <div class="pdf-thank-you" style="text-align:center;padding:10px 16px;border-top:1px solid #d1d5db;background:#f9fafb;">
        <div class="pdf-thank-you-title" style="font-weight:800;color:#0B4D2C;font-size:13px;letter-spacing:0.5px;">Thank you for your business</div>
        <div class="pdf-thank-you-subtitle" style="font-size:10.5px;color:#4b5563;margin-top:2px;">${esc(comp.subtitle)}</div>
      </div>
    </div>
  `;
}
