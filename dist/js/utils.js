/**
 * Akshara Spices Trades - Utilities Module
 */

export const money = (num) => {
  const val = Number(num) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

export const formatQty = (num, unit = '') => {
  const val = Number(num) || 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(val);
  return unit ? `${formatted} ${unit}` : formatted;
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

export const todayStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const addDaysStr = (days = 15) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const esc = (str) => {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
};

import { showToast } from './loading.js';

export const toast = (message, type = 'info') => {
  showToast(message, type);
};

export const validateGSTIN = (gstin) => {
  if (!gstin) return true; // Optional for B2C
  const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return regex.test(gstin.trim().toUpperCase());
};

export const validatePhone = (phone) => {
  if (!phone) return true;
  const regex = /^[0-9+\-\s]{10,15}$/;
  return regex.test(phone.trim());
};

export const normalizePhone = (phone) => {
  if (!phone) return '';
  let str = String(phone).replace(/\D/g, ''); // Extract only digits
  if (str.length > 10 && (str.startsWith('91') || str.startsWith('0'))) {
    str = str.slice(-10);
  }
  return str;
};

export const normalizeBarcode = (barcode) => {
  if (barcode === undefined || barcode === null) return '';
  return String(barcode).trim();
};

export const numberToWords = (num) => {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  num = Math.floor(Number(num) || 0);
  if (num === 0) return 'Zero Rupees Only';

  const inWords = (n) => {
    let str = '';
    if (n > 99) {
      str += a[Math.floor(n / 100)] + 'Hundred ';
      n %= 100;
    }
    if (n > 19) {
      str += b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ' ');
    } else if (n > 0) {
      str += a[n];
    }
    return str;
  };

  let result = '';
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;

  if (crore > 0) result += inWords(crore) + 'Crore ';
  if (lakh > 0) result += inWords(lakh) + 'Lakh ';
  if (thousand > 0) result += inWords(thousand) + 'Thousand ';
  if (num > 0) result += inWords(num);

  return result.trim() + ' Rupees Only';
};

/**
 * Calculates remaining days until product expiry date and determines alert tier.
 */
export const getExpiryInfo = (expiryDateStr) => {
  if (!expiryDateStr) {
    return { daysRemaining: null, level: 'NONE', label: 'No Expiry', badgeClass: 'muted', alertText: '', isExpired: false, isAlert: false };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expDate = new Date(expiryDateStr);
  if (isNaN(expDate.getTime())) {
    return { daysRemaining: null, level: 'NONE', label: 'Invalid Date', badgeClass: 'muted', alertText: '', isExpired: false, isAlert: false };
  }
  expDate.setHours(0, 0, 0, 0);

  const diffTime = expDate - today;
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return {
      daysRemaining,
      level: 'EXPIRED',
      label: 'Expired',
      badgeClass: 'danger',
      alertText: '❌ Product Expired',
      isExpired: true,
      isAlert: true
    };
  } else if (daysRemaining === 0) {
    return {
      daysRemaining: 0,
      level: 'EXPIRED',
      label: 'Expires Today!',
      badgeClass: 'danger',
      alertText: '❌ Product Expired Today',
      isExpired: true,
      isAlert: true
    };
  } else if (daysRemaining <= 7) {
    return {
      daysRemaining,
      level: 'CRITICAL',
      label: `Expires in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}`,
      badgeClass: 'danger',
      alertText: `🔴 Critical Expiry Warning (${daysRemaining} days left)`,
      isExpired: false,
      isAlert: true
    };
  } else if (daysRemaining <= 30) {
    return {
      daysRemaining,
      level: 'HIGH',
      label: `Expires in ${daysRemaining} days`,
      badgeClass: 'warning',
      alertText: `⚠️ High-Priority Expiry Warning (${daysRemaining} days left)`,
      isExpired: false,
      isAlert: true
    };
  } else if (daysRemaining <= 60) {
    return {
      daysRemaining,
      level: 'WARNING',
      label: `Expires in ${daysRemaining} days`,
      badgeClass: 'warning',
      alertText: `⚠️ Expiry Warning (${daysRemaining} days left)`,
      isExpired: false,
      isAlert: true
    };
  } else {
    return {
      daysRemaining,
      level: 'SAFE',
      label: `Expires in ${daysRemaining} days`,
      badgeClass: 'info',
      alertText: `Safe (${daysRemaining} days remaining)`,
      isExpired: false,
      isAlert: false
    };
  }
};

/**
 * Calculates payment status info for Sales Invoice or Purchase record.
 * @param {Object} docData - Invoice or Purchase document data
 * @param {'sales' | 'purchase'} type - Type of record
 * @returns {{ statusText: string, isOverdue: boolean, badgeClass: string, rawStatus: string, pendingDays: number|null }}
 */
export const getPaymentStatusInfo = (docData, type = 'sales') => {
  const payableStatus = docData?.payableStatus;

  if (!payableStatus || (payableStatus !== 'advance' && payableStatus !== 'full_payment')) {
    return {
      statusText: 'NOT SET',
      isOverdue: false,
      badgeClass: 'muted',
      rawStatus: 'NOT_SET',
      pendingDays: null
    };
  }

  if (payableStatus === 'full_payment') {
    return {
      statusText: 'FULL PAYMENT',
      isOverdue: false,
      badgeClass: 'success',
      rawStatus: 'FULL_PAYMENT',
      pendingDays: null
    };
  }

  // payableStatus === 'advance'
  const dateStr = type === 'sales'
    ? (docData?.invoiceDate || docData?.date)
    : (docData?.purchaseDate || docData?.date);

  let pendingDays = 1;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const d1 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const today = new Date();
      const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const diffTime = d2 - d1;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      pendingDays = Math.max(1, diffDays + 1);
    }
  }

  const overdueThreshold = type === 'sales' ? 30 : 75;
  const isOverdue = pendingDays > overdueThreshold;
  const dayLabel = pendingDays === 1 ? 'day' : 'days';

  if (isOverdue) {
    return {
      statusText: `ADVANCE • OVERDUE ${pendingDays} ${dayLabel}`,
      isOverdue: true,
      badgeClass: 'danger',
      rawStatus: 'ADVANCE_OVERDUE',
      pendingDays
    };
  } else {
    return {
      statusText: `ADVANCE • Pending ${pendingDays} ${dayLabel}`,
      isOverdue: false,
      badgeClass: 'warning',
      rawStatus: 'ADVANCE_PENDING',
      pendingDays
    };
  }
};

