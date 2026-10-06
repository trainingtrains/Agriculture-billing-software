/**
 * Akshara Spices Trades - Excel Export Helper (SheetJS / XLSX Integration)
 */

import { formatDate, money } from './utils.js';

/**
 * Dynamically ensures XLSX (SheetJS) CDN library is loaded.
 */

export async function ensureSheetJSLoaded() {
  if (window.XLSX) return true;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('Failed to load SheetJS library.'));
    document.head.appendChild(script);
  });
}

/**
 * Exports data to an Excel .xlsx file with company header and totals.
 * 
 * @param {Array<Object>} rowsData - Array of objects representing rows
 * @param {string} fileName - File name without extension
 * @param {string} reportTitle - Report Title
 * @param {Object} companyInfo - Company Details
 */
export async function exportToExcel(rowsData, fileName = 'Report', reportTitle = 'Financial Report', companyInfo = {}) {
  try {
    await ensureSheetJSLoaded();
    const XLSX = window.XLSX;

    const companyName = (!companyInfo.name || companyInfo.name === 'CUSTOM BILLING SOFTWARE') ? 'S M AGRI TECH' : companyInfo.name;
    const gstin = companyInfo.gstin || '';
    const generatedDate = formatDate(new Date());

    // Create WorkSheet header rows
    const headerRows = [
      [companyName.toUpperCase()],
      [`GSTIN: ${gstin}`],
      [`REPORT: ${reportTitle.toUpperCase()}`],
      [`Generated Date: ${generatedDate}`],
      [] // blank line before table
    ];

    const worksheet = XLSX.utils.json_to_sheet(rowsData, { origin: 'A6' });
    XLSX.utils.sheet_add_aoa(worksheet, headerRows, { origin: 'A1' });

    // Set column widths automatically
    const maxCols = Object.keys(rowsData[0] || {}).length;
    worksheet['!cols'] = Array(maxCols).fill({ wch: 20 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');

    XLSX.writeFile(workbook, `${fileName}_${Date.now()}.xlsx`);
  } catch (err) {
    console.error('Export to Excel failed:', err);
    alert('Failed to export Excel file. Please try again.');
  }
}
