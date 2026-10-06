import { initAuth, loginUser, logoutUser, currentUser, getUserAccessGroup, getAccessCategories, isCategoryAllowed } from './js/auth.js';
import { money, esc, toast, todayStr, formatDate, normalizePhone, normalizeBarcode, getExpiryInfo, getPaymentStatusInfo } from './js/utils.js';
import { loadProducts, productsList, saveProduct, deleteProduct, renderProductsTable, fetchProductsPage, searchProductsRemote } from './js/products.js';
import { loadCustomers, customersList, saveCustomer, deleteCustomer, fetchCustomerLedger, findCustomerByPhone, fetchCustomersPage, searchCustomersRemote } from './js/customers.js';
import { loadSuppliers, suppliersList, saveSupplier, deleteSupplier, fetchSupplierLedger, fetchSuppliersPage } from './js/suppliers.js';
import { loadCompanySettings, companySettings, saveCompanySettings, saveInvoice, fetchInvoices, fetchInvoicesPage, cancelInvoice, findProductByBarcodeRemote } from './js/billing.js';
import { savePurchase, fetchPurchases, fetchPurchasesPage } from './js/purchases.js';
import { saveSalesReturn, savePurchaseReturn } from './js/returns.js';
import { adjustStock, fetchStockMovements, getInventoryKPIs } from './js/inventory.js';
import { recordCustomerPayment, recordSupplierPayment, fetchCustomerPayments, fetchSupplierPayments } from './js/payments.js';
import { saveQuotation, convertQuotationToInvoice, fetchQuotations, fetchQuotationsPage } from './js/quotation.js';
import { loadExpenses, expensesList, saveExpense, deleteExpense, fetchExpensesPage } from './js/expenses.js';
import { getSalesReport, getPurchaseReport, getProductPerformanceReport, getProfitAndMarginReport, getGSTReport } from './js/reports.js';
import { exportToExcel } from './js/excel-export.js';
import { generatePrintHTML } from './js/thermal-print.js';
import { loadDashboardData } from './js/dashboard.js';
import { calculateDocumentTotals } from './js/gst.js';
import { db, auth, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from './js/firebase.js';
import { setButtonLoading, showPageLoading, hidePageLoading, showSkeleton, hideSkeleton, withLock, withAsyncFeedback } from './js/loading.js';
import { storeEvents, subscribeActiveProduct, subscribeActiveCustomer, subscribeCompanySettings } from './js/store.js';

let activePage = 'dashboard';
let invoiceItems = [];
let purchaseItems = [];
let activePreviewDoc = null;
let selectedCustomerId = null;
let selectedCustomer = null;
let phoneLookupTimer = null;
let phoneLookupSeqId = 0;
let activeCustomerUnsub = null;

// Barcode Scanning State Variables
let activeScannedProduct = null;
let isProcessingScan = false;
let cameraMediaStream = null;

// Sequence guards & Debounce timers for fast search
let custSearchSeqId = 0;
let custSearchTimer = null;
let prodSearchSeqId = 0;
let prodSearchTimer = null;

// Cursor-based pagination state
const paginationState = {
  history: { page: 1, lastDocs: [null], hasMore: true },
  quotations: { page: 1, lastDocs: [null], hasMore: true },
  purchaseHistory: { page: 1, lastDocs: [null], hasMore: true },
  products: { page: 1, lastDocs: [null], hasMore: true },
  customers: { page: 1, lastDocs: [null], hasMore: true },
  suppliers: { page: 1, lastDocs: [null], hasMore: true },
  expenses: { page: 1, lastDocs: [null], hasMore: true }
};

// Utility element selector
const $ = (id) => document.getElementById(id);

/**
 * Mobile Drawer Navigation Handlers
 */
function openMobileDrawer() {
  const backdrop = $('mobileDrawerBackdrop');
  const drawer = $('mobileMoreDrawer');
  if (backdrop) backdrop.classList.add('active');
  if (drawer) drawer.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileDrawer() {
  const backdrop = $('mobileDrawerBackdrop');
  const drawer = $('mobileMoreDrawer');
  if (backdrop) backdrop.classList.remove('active');
  if (drawer) drawer.classList.remove('open');
  document.body.style.overflow = '';
}

function setupMobileNavigation() {
  $('mobileMoreBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openMobileDrawer();
  });
  $('closeMobileDrawerBtn')?.addEventListener('click', () => closeMobileDrawer());
  $('mobileDrawerBackdrop')?.addEventListener('click', () => closeMobileDrawer());

  $('mobileSettingsBtn')?.addEventListener('click', () => {
    closeMobileDrawer();
    if (typeof syncSettingsFormFields === 'function') syncSettingsFormFields();
    $('settingsDialog')?.showModal();
  });

  $('mobileLogoutBtn')?.addEventListener('click', () => {
    closeMobileDrawer();
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) logoutBtn.click();
  });
}

/**
 * SPA Router with lazy data fetching per module
 */
function navigate(page) {
  if (!currentUser) return;
  activePage = page;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const sections = [
    'dashboardView', 'billing', 'history', 'quotationsView', 'purchasesView', 
    'purchaseHistoryView', 'salesReturnView', 'purchaseReturnView', 'productsView', 
    'inventory', 'customersView', 'suppliersView', 'paymentsView', 'expensesView', 'reportsView'
  ];

  sections.forEach(secId => {
    const el = $(secId);
    if (el) el.hidden = true;
  });

  const pageTitleEl = $('pageTitle');
  
  if (page === 'dashboard') {
    if ($('dashboardView')) $('dashboardView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Dashboard & Analytics';
    loadDashboardData();
  } else if (page === 'billing') {
    if ($('billing')) $('billing').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'GST Billing Desk';
    updateProductPickers();
    updateCustomerDatalist();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      $('customer')?.focus({ preventScroll: true });
    }, 50);
  } else if (page === 'history') {
    if ($('history')) $('history').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Saved Invoices';
    renderInvoiceHistoryPage(1);
  } else if (page === 'quotations') {
    if ($('quotationsView')) $('quotationsView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Quotations';
    renderQuotationsListPage(1);
  } else if (page === 'purchases') {
    if ($('purchasesView')) $('purchasesView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'New Purchase Invoice';
    updateSupplierDropdowns();
    updateProductPickers();
  } else if (page === 'purchaseHistory') {
    if ($('purchaseHistoryView')) $('purchaseHistoryView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Purchase History';
    renderPurchaseHistoryPage(1);
  } else if (page === 'salesReturn') {
    if ($('salesReturnView')) $('salesReturnView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Sales Return (Credit Note)';
    updateCustomerDatalist();
    updateProductPickers();
  } else if (page === 'purchaseReturn') {
    if ($('purchaseReturnView')) $('purchaseReturnView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Purchase Return (Debit Note)';
    updateSupplierDropdowns();
    updateProductPickers();
  } else if (page === 'products') {
    if ($('productsView')) $('productsView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Product Catalogue Master';
    syncCategoryDropdowns();
    renderProductsTablePage(1);
  } else if (page === 'inventory') {
    if ($('inventory')) $('inventory').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Stock Maintenance';
    showSkeleton('stockStatusRows', 7, 5);
    loadProducts(25).then(() => renderStockTable());
  } else if (page === 'customers') {
    if ($('customersView')) $('customersView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Customer Master Directory';
    renderCustomersTablePage(1);
  } else if (page === 'suppliers') {
    if ($('suppliersView')) $('suppliersView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Supplier Directory';
    renderSuppliersTablePage(1);
  } else if (page === 'payments') {
    if ($('paymentsView')) $('paymentsView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Payments & Accounting';
    updateCustomerDatalist();
    updateSupplierDropdowns();
  } else if (page === 'expenses') {
    if ($('expensesView')) $('expensesView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Expense Management';
    renderExpensesTablePage(1);
  } else if (page === 'reports') {
    if ($('reportsView')) $('reportsView').hidden = false;
    if (pageTitleEl) pageTitleEl.textContent = 'Financial & Statutory GST Reports';
  }

  document.querySelectorAll('[data-page]').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  closeMobileDrawer();
}

function syncCategoryDropdowns() {
  const allowed = getAccessCategories();
  const filterSelect = $('prodCatFilter');
  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = '<option value="">All Allowed Categories</option>';
    if (allowed.includes('bio')) {
      filterSelect.appendChild(new Option('Bio', 'bio'));
    }
    if (allowed.includes('nithish')) {
      filterSelect.appendChild(new Option('Nithish', 'nithish'));
    }
    if (allowed.includes('chemical')) {
      filterSelect.appendChild(new Option('Chemical', 'chemical'));
    }
    if (allowed.includes('micro_nutrients')) {
      filterSelect.appendChild(new Option('Micro Nutrients', 'micro_nutrients'));
    }
    if (allowed.includes(currentVal)) {
      filterSelect.value = currentVal;
    } else {
      filterSelect.value = '';
    }
  }
}

/**
 * Initialize Application
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupMobileNavigation();
  // Navigation event listeners
  document.querySelectorAll('[data-page]').forEach(b => {
    b.addEventListener('click', () => navigate(b.dataset.page));
  });

  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => {
      const modal = $(b.dataset.close);
      if (modal) modal.close();
    });
  });

  // Auth initialization with page overlay feedback
  showPageLoading('Initializing application...');
  initAuth(
    async (user) => {
      showPageLoading('Loading company settings & data...');
      $('loginScreen').hidden = true;
      $('appWorkspace').hidden = false;
      if ($('mobileBottomNav')) $('mobileBottomNav').hidden = false;
      syncCategoryDropdowns();
      await loadInitialData();
      navigate('dashboard');
      hidePageLoading();
    },
    () => {
      $('loginScreen').hidden = false;
      $('appWorkspace').hidden = true;
      if ($('mobileBottomNav')) $('mobileBottomNav').hidden = true;
      closeMobileDrawer();
      hidePageLoading();
    }
  );

  // Login form handler with immediate visual feedback & disabling
  $('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginSubmitBtn') || e.submitter;
    const emailInput = $('loginEmail');
    const pwdInput = $('loginPassword');
    const errEl = $('authError');

    if (errEl) errEl.hidden = true;
    setButtonLoading(btn, true, 'Logging in...');
    if (emailInput) emailInput.disabled = true;
    if (pwdInput) pwdInput.disabled = true;

    try {
      await loginUser(emailInput.value, pwdInput.value);
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Invalid username or password.';
        errEl.hidden = false;
      }
      toast('Invalid username or password.', 'error');
    } finally {
      setButtonLoading(btn, false);
      if (emailInput) emailInput.disabled = false;
      if (pwdInput) pwdInput.disabled = false;
    }
  });

  $('logoutBtn')?.addEventListener('click', async () => {
    setButtonLoading($('logoutBtn'), true, 'Logging out...');
    try {
      await logoutUser();
    } finally {
      setButtonLoading($('logoutBtn'), false);
    }
  });

  // New Quotation Button handler
  $('newQuotationBtn')?.addEventListener('click', () => {
    navigate('billing');
    if ($('type')) $('type').value = 'quotation';
    invoiceItems = [];
    renderInvoiceItems();
  });

  // Search Invoices handler
  $('searchInvoice')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll('#historyRows tr');
    rows.forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  });

  // Product Master filter handlers
  const filterProducts = () => {
    const query = $('prodSearchInput')?.value.toLowerCase().trim() || '';
    const cat = $('prodCatFilter')?.value || '';
    const status = $('prodStatusFilter')?.value || '';

    const rows = document.querySelectorAll('#productsRows tr');
    rows.forEach(tr => {
      const text = tr.textContent.toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const matchesCat = !cat || text.includes(cat.toLowerCase());
      let matchesStatus = true;
      if (status === 'instock') matchesStatus = text.includes('in stock');
      else if (status === 'lowstock') matchesStatus = text.includes('low stock');
      else if (status === 'outofstock') matchesStatus = text.includes('out of stock');

      tr.style.display = (matchesQuery && matchesCat && matchesStatus) ? '' : 'none';
    });
  };

  $('prodSearchInput')?.addEventListener('input', filterProducts);
  $('prodCatFilter')?.addEventListener('change', filterProducts);
  $('prodStatusFilter')?.addEventListener('change', filterProducts);

  // Billing desk handlers
  setupBillingDesk();

  // Dialog & Modal forms setup
  setupModals();

  // Setup Live Product Autocompletes across ERP
  setupProductAutocompletes();

  // Setup Application Realtime Event Listeners
  setupRealtimeEvents();

  // Setup Global Keyboard Shortcuts
  setupKeyboardShortcuts();

  // Setup Mobile Navigation & Drawer Handlers
  setupMobileNavigation();
});

function applyCompanyBrandingToUI() {
  const name = (!companySettings.name || companySettings.name === 'CUSTOM BILLING SOFTWARE') ? 'S M AGRI TECH' : companySettings.name;
  const subtitle = companySettings.subtitle || companySettings.tagline || 'Agriculture Chemicals & Fertilizers · Thalavadi';

  if ($('headerEyebrow')) $('headerEyebrow').textContent = name;
  if ($('brandTitle')) {
    if (name.toUpperCase().includes('S M AGRI TECH') || name.toUpperCase().includes('SM AGRI TECH')) {
      $('brandTitle').innerHTML = `S M <span>AGRI TECH</span>`;
    } else {
      const parts = name.trim().split(/\s+/);
      const firstWord = parts[0] || 'S M';
      const rest = parts.slice(1).join(' ') || 'AGRI TECH';
      $('brandTitle').innerHTML = `${esc(firstWord)}<span>${esc(rest)}</span>`;
    }
  }
  if ($('asideFootText')) $('asideFootText').innerHTML = `${esc(subtitle)}<br><small>Quality ERP & Billing Desk</small>`;
  if ($('noticeText')) $('noticeText').textContent = `${name} Cloud Billing & ERP · Thalavadi`;
  if ($('footerBrandSpan')) $('footerBrandSpan').textContent = `${name} · GST Billing & ERP Management System`;

  if (document.title && !document.title.includes(name)) {
    document.title = `${name} | GST Billing & ERP System`;
  }
}

function syncSettingsFormFields() {
  if ($('settName')) $('settName').value = companySettings.name || '';
  if ($('settSubtitle')) $('settSubtitle').value = companySettings.subtitle || companySettings.tagline || '';
  if ($('settLogoUrl')) $('settLogoUrl').value = companySettings.logoUrl || '';
  if ($('settTerms')) $('settTerms').value = companySettings.terms || '';
  if ($('settAddress')) $('settAddress').value = companySettings.address || '';
  if ($('settGstin')) $('settGstin').value = companySettings.gstin || '';
  if ($('settPhone')) $('settPhone').value = companySettings.phone || '';
  if ($('settEmail')) $('settEmail').value = companySettings.email || '';
  if ($('settStateCode')) $('settStateCode').value = companySettings.stateCode || '33';
  if ($('settInvoicePrefix')) $('settInvoicePrefix').value = companySettings.invoicePrefix || 'INV';
  if ($('settQuotationPrefix')) $('settQuotationPrefix').value = companySettings.quotationPrefix || 'QTN';
  if ($('settAllowNegativeStock')) $('settAllowNegativeStock').checked = Boolean(companySettings.allowNegativeStock);
  if ($('settBankName')) $('settBankName').value = companySettings.bankAccountName || '';
  if ($('settBankInst')) $('settBankInst').value = companySettings.bankName || '';
  if ($('settBankNo')) $('settBankNo').value = companySettings.bankAccountNo || '';
  if ($('settBankIfsc')) $('settBankIfsc').value = companySettings.bankIfsc || '';
  if ($('settBankBranch')) $('settBankBranch').value = companySettings.bankBranch || '';
  applyCompanyBrandingToUI();
}

async function loadInitialData() {
  await loadCompanySettings();
  syncSettingsFormFields();
  applyCompanyBrandingToUI();
  await Promise.all([
    loadProducts(100).then(() => evaluateLowStockAlerts()),
    loadCustomers(100).then(() => updateCustomerDatalist()),
    loadSuppliers(100).then(() => updateSupplierDropdowns())
  ]);
  updateCustomerDatalist();
  updateSupplierDropdowns();
}

/**
 * Realtime Event Subscriptions & View Synchronization Engine
 */
function setupRealtimeEvents() {
  storeEvents.on('stockUpdated', (data) => {
    if (data?.productId && Array.isArray(productsList)) {
      const item = productsList.find(p => p.id === data.productId);
      if (item) {
        if (data.newStock !== undefined) item.currentStock = data.newStock;
        if (data.product) Object.assign(item, data.product);

        if ((item.currentStock || 0) <= (item.minimumStock || 0)) {
          toast(`⚠️ Low Stock Alert: Product "${item.productName}" stock is low (${item.currentStock} ${item.unit || ''} remaining)!`, 'warning');
        }
      }
    } else if (data?.updates && Array.isArray(productsList)) {
      Object.entries(data.updates).forEach(([pId, newStk]) => {
        const item = productsList.find(p => p.id === pId);
        if (item) item.currentStock = newStk;
      });
    }

    if (activePage === 'inventory') {
      loadProducts(25).then(() => renderStockTable());
    } else if (activePage === 'products') {
      renderProductsTablePage(paginationState.products.page || 1);
    }

    evaluateLowStockAlerts();
  });

  storeEvents.on('productSaved', () => {
    evaluateLowStockAlerts();
  });

  storeEvents.on('customerBalanceUpdated', (data) => {
    if (data?.customerId && Array.isArray(customersList)) {
      const item = customersList.find(c => c.id === data.customerId);
      if (item) {
        if (data.newOutstanding !== undefined) item.outstandingBalance = data.newOutstanding;
        if (data.customer) Object.assign(item, data.customer);
      }
    }
    if (selectedCustomer && selectedCustomer.id === data?.customerId) {
      if (data.newOutstanding !== undefined) selectedCustomer.outstandingBalance = data.newOutstanding;
      if (data.customer) Object.assign(selectedCustomer, data.customer);
    }

    updateCustomerDatalist();
    if (activePage === 'customers') {
      renderCustomersTablePage(paginationState.customers.page || 1);
    }
  });

  storeEvents.on('customerSaved', async () => {
    await loadCustomers(100);
    updateCustomerDatalist();
  });

  storeEvents.on('supplierBalanceUpdated', (data) => {
    if (data?.supplierId && Array.isArray(suppliersList)) {
      const item = suppliersList.find(s => s.id === data.supplierId);
      if (item) {
        if (data.newOutstanding !== undefined) item.currentOutstanding = data.newOutstanding;
        if (data.supplier) Object.assign(item, data.supplier);
      }
    }

    updateSupplierDropdowns();
    if (activePage === 'suppliers') {
      renderSuppliersTablePage(paginationState.suppliers.page || 1);
    }
  });

  storeEvents.on('supplierSaved', async () => {
    await loadSuppliers(100);
    updateSupplierDropdowns();
  });

  storeEvents.on('invoiceSaved', () => {
    if (activePage === 'history') {
      renderInvoiceHistoryPage(paginationState.history.page || 1);
    }
  });

  storeEvents.on('invoiceCancelled', () => {
    if (activePage === 'history') {
      renderInvoiceHistoryPage(paginationState.history.page || 1);
    }
  });

  storeEvents.on('purchaseSaved', () => {
    if (activePage === 'purchaseHistory') {
      renderPurchaseHistoryPage(paginationState.purchaseHistory.page || 1);
    }
  });

  storeEvents.on('quotationSaved', () => {
    if (activePage === 'quotations') {
      renderQuotationsListPage(paginationState.quotations.page || 1);
    }
  });

  storeEvents.on('productSaved', () => {
    if (activePage === 'products') {
      renderProductsTablePage(paginationState.products.page || 1);
    }
  });

  storeEvents.on('customerSaved', () => {
    if (activePage === 'customers') {
      renderCustomersTablePage(paginationState.customers.page || 1);
    }
  });

  storeEvents.on('supplierSaved', () => {
    if (activePage === 'suppliers') {
      renderSuppliersTablePage(paginationState.suppliers.page || 1);
    }
  });

  subscribeCompanySettings((newSettings) => {
    if (newSettings) {
      Object.assign(companySettings, newSettings);
      syncSettingsFormFields();
      if ($('printDialog')?.open && activePreviewDoc) {
        activePreviewDoc.companySnapshot = { ...companySettings };
        renderPrintPreview();
      }
    }
  });

  storeEvents.on('companySettingsUpdated', (newSettings) => {
    if (newSettings) {
      Object.assign(companySettings, newSettings);
      syncSettingsFormFields();
      if ($('printDialog')?.open && activePreviewDoc) {
        activePreviewDoc.companySnapshot = { ...companySettings };
        renderPrintPreview();
      }
    }
  });
}

/**
 * Billing Desk Item Row Handlers & Calculations
 */
function setupBillingDesk() {
  if ($('date')) $('date').value = todayStr();

  // Unified Product Selection & Barcode Input Listeners
  setTimeout(() => $('customer')?.focus({ preventScroll: true }), 150);

  const searchInput = $('productSearch') || $('barcodeInput');
  const qtyInput = $('productQty') || $('barcodeQty');
  const addBtn = $('unifiedAddBtn') || $('barcodeAddBtn') || $('addBtn');

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUnifiedProductSearchOrScan();
    }
  });

  qtyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUnifiedProductToCart();
    }
  });

  addBtn?.addEventListener('click', () => {
    addUnifiedProductToCart();
  });

  $('startCameraScanBtn')?.addEventListener('click', () => {
    startCameraScan();
  });

  $('closeCameraScanBtn')?.addEventListener('click', () => {
    stopCameraScan();
  });

  // Overall Discount Input Change Handlers (Two-way synchronized)
  $('overallDiscountPercent')?.addEventListener('input', () => {
    onOverallDiscountPercentInput();
  });
  $('overallDiscountAmount')?.addEventListener('input', () => {
    onOverallDiscountAmountInput();
  });
  $('overallDiscountInput')?.addEventListener('input', () => {
    syncDocumentDiscountToItems();
    recalculateInvoice();
  });
  $('overallDiscountType')?.addEventListener('change', () => {
    syncDocumentDiscountToItems();
    recalculateInvoice();
  });

  // Invoice Type change handler
  $('invoiceType')?.addEventListener('change', () => {
    onInvoiceTypeChange();
  });

  // Payable Status change handlers
  $('payableStatus')?.addEventListener('change', (e) => {
    const isAdv = e.target.value === 'advance';
    if ($('advanceAmountWrap')) $('advanceAmountWrap').hidden = !isAdv;
    if (!isAdv && $('advanceAmount')) $('advanceAmount').value = '';
  });

  $('purPayableStatus')?.addEventListener('change', (e) => {
    const isAdv = e.target.value === 'advance';
    if ($('purAdvanceAmountWrap')) $('purAdvanceAmountWrap').hidden = !isAdv;
    if (!isAdv && $('purAdvanceAmount')) $('purAdvanceAmount').value = '';
  });

  // Document Type change handler (Invoice vs Quotation)
  $('type')?.addEventListener('change', (e) => {
    const isQuo = e.target.value === 'quotation';
    if ($('invoiceTypeWrap')) $('invoiceTypeWrap').hidden = false;
    if ($('validLabel')) $('validLabel').hidden = !isQuo;

    const invSelect = $('invoiceType');
    const labelText = $('invoiceTypeLabelText');
    if (invSelect) {
      const currentVal = invSelect.value;
      if (isQuo) {
        if (labelText) labelText.textContent = 'Quotation Type';
        invSelect.options[0].text = 'GST Quotation';
        invSelect.options[1].text = 'Non-GST Quotation';
      } else {
        if (labelText) labelText.textContent = 'Invoice Type';
        invSelect.options[0].text = 'GST Invoice';
        invSelect.options[1].text = 'Non-GST Bill';
      }
      invSelect.value = currentVal;
    }
    onInvoiceTypeChange();
  });

  // ==========================================
  // CUSTOMER AUTO-LOOKUP & AUTO-CREATE ENGINE
  // ==========================================

  function setDeskCustomer(cust, showToastNotice = false) {
    phoneLookupSeqId++;
    if (phoneLookupTimer) {
      clearTimeout(phoneLookupTimer);
      phoneLookupTimer = null;
    }

    selectedCustomer = cust || null;
    selectedCustomerId = cust ? (cust.id || null) : null;

    if (activeCustomerUnsub) {
      activeCustomerUnsub();
      activeCustomerUnsub = null;
    }

    if (cust && cust.id) {
      activeCustomerUnsub = subscribeActiveCustomer(cust.id, (updatedCust) => {
        if (updatedCust) {
          selectedCustomer = updatedCust;
          updateCustomerLookupStatusBadge('found', updatedCust);
        }
      });
    }

    if (cust) {
      if ($('customer')) $('customer').value = cust.customerName || '';
      if ($('phone')) $('phone').value = cust.phone || '';
      if ($('customerGstin')) $('customerGstin').value = cust.gstin || '';
      if ($('state')) $('state').value = cust.stateCode || '33';
      if ($('address')) $('address').value = cust.billingAddress || cust.address || '';

      const taxType = (cust.taxType || cust.customerTaxType || (cust.gstin ? 'GST' : 'NON_GST')).toUpperCase();
      if ($('invoiceType')) {
        $('invoiceType').value = taxType;
        onInvoiceTypeChange();
      }
      updateCustomerLookupStatusBadge('found', cust);
      if (showToastNotice) {
        toast(`✓ Customer "${cust.customerName}" loaded.`);
      }
    } else {
      updateCustomerLookupStatusBadge('clear');
    }
  }

  function updateCustomerLookupStatusBadge(status, data = null) {
    const badge = $('customerLookupStatus');
    const textEl = $('customerLookupText');
    const actionsEl = $('customerLookupActions');
    if (!badge || !textEl || !actionsEl) return;

    if (status === 'searching') {
      badge.style.display = 'flex';
      badge.style.borderColor = 'rgba(46, 125, 50, 0.4)';
      badge.style.background = 'rgba(46, 125, 50, 0.08)';
      textEl.innerHTML = `<span style="color:#1b4332; font-weight:600;">⏳ Searching customer in Firestore...</span>`;
      actionsEl.innerHTML = ``;
    } else if (status === 'found' && data) {
      badge.style.display = 'flex';
      badge.style.borderColor = '#2e7d32';
      badge.style.background = 'rgba(46, 125, 50, 0.12)';
      textEl.innerHTML = `<div><strong style="color:#1b4332;">✓ Existing customer found</strong><br><small style="color:#2d6a4f;">${esc(data.customerName)} ${data.phone ? ` | Phone: ${esc(data.phone)}` : ''} ${data.gstin ? ` | GSTIN: ${esc(data.gstin)}` : ''}</small></div>`;
      actionsEl.innerHTML = `<button type="button" id="editDeskCustomerBtn" class="small-btn secondary" style="cursor:pointer; background:#ffffff; color:#2e7d32; border:1px solid #2e7d32; padding:4px 12px; border-radius:5px; font-weight:600;">✎ Edit Customer</button>`;

      setTimeout(() => {
        $('editDeskCustomerBtn')?.addEventListener('click', () => {
          openCustomerModal(data, 'EDIT');
        });
      }, 0);
    } else if (status === 'not_found') {
      badge.style.display = 'flex';
      badge.style.borderColor = '#d32f2f';
      badge.style.background = 'rgba(211, 47, 47, 0.08)';
      textEl.innerHTML = `<div><span style="color:#d32f2f; font-weight:600;">⚠️ Customer not found</span></div>`;
      actionsEl.innerHTML = `<button type="button" id="createDeskCustomerBtn" class="small-btn primary" style="cursor:pointer; padding:5px 12px; font-weight:600;">＋ Create New Customer</button>`;

      setTimeout(() => {
        $('createDeskCustomerBtn')?.addEventListener('click', () => {
          const rawPhone = $('phone')?.value || (data ? data.phone : '');
          openCustomerModal({ phone: rawPhone }, 'CREATE');
        });
      }, 0);
    } else if (status === 'error') {
      badge.style.display = 'flex';
      badge.style.borderColor = '#d32f2f';
      badge.style.background = 'rgba(211, 47, 47, 0.08)';
      textEl.innerHTML = `<span style="color:#d32f2f; font-weight:600;">❌ Unable to search customer. Please check your connection and try again.</span>`;
      actionsEl.innerHTML = ``;
    } else {
      badge.style.display = 'none';
    }
  }

  // 1. Debounced Phone Lookup (Primary Key)
  $('phone')?.addEventListener('input', (e) => {
    clearTimeout(phoneLookupTimer);
    const rawVal = e.target.value;
    const normPhone = normalizePhone(rawVal);

    if (selectedCustomer && normalizePhone(selectedCustomer.phone) !== normPhone) {
      selectedCustomer = null;
      selectedCustomerId = null;
    }

    if (!normPhone || normPhone.length !== 10) {
      if (!normPhone) {
        updateCustomerLookupStatusBadge('clear');
      }
      return;
    }

    const currentSeq = ++phoneLookupSeqId;
    updateCustomerLookupStatusBadge('searching');

    phoneLookupTimer = setTimeout(async () => {
      try {
        const found = await findCustomerByPhone(normPhone);
        if (currentSeq !== phoneLookupSeqId) return;

        if (found) {
          setDeskCustomer(found);
          toast(`✓ Existing customer found: ${found.customerName}`);
        } else {
          selectedCustomer = null;
          selectedCustomerId = null;
          updateCustomerLookupStatusBadge('not_found', { phone: normPhone });
        }
      } catch (err) {
        if (currentSeq !== phoneLookupSeqId) return;
        console.error('Phone lookup error:', err);
        updateCustomerLookupStatusBadge('error');
      }
    }, 400);
  });

  // 2. Searchable Customer Name Dropdown (Indexed Remote Search with Debounce & Cancellation)
  const custInput = $('customer');
  const custDropdown = $('customerSearchResults');

  custInput?.addEventListener('input', (e) => {
    clearTimeout(custSearchTimer);
    const query = e.target.value.toLowerCase().trim();
    if (!custDropdown) return;

    if (!query) {
      custDropdown.hidden = true;
      return;
    }

    custSearchTimer = setTimeout(async () => {
      const seqId = ++custSearchSeqId;
      const matches = await searchCustomersRemote(query);
      if (seqId !== custSearchSeqId) return; // Stale search result guard

      if (!matches || matches.length === 0) {
        custDropdown.innerHTML = `<div class="search-result-item" style="color:#888;">No matching customer found.</div>`;
        custDropdown.hidden = false;
        return;
      }

      custDropdown.innerHTML = matches.slice(0, 8).map(c => {
        const taxType = (c.taxType || c.customerTaxType || (c.gstin ? 'GST' : 'NON_GST')).toUpperCase();
        return `
          <div class="search-result-item cust-search-item" data-id="${c.id}">
            <div>
              <div class="item-title">${esc(c.customerName)}</div>
              <small style="color:#666;">Phone: ${esc(c.phone || 'N/A')}${c.gstin ? ` | GSTIN: ${esc(c.gstin)}` : ''}</small>
            </div>
            <span class="badge ${taxType === 'NON_GST' ? 'warning' : 'success'}">${taxType === 'NON_GST' ? 'Non-GST' : 'GST'}</span>
          </div>
        `;
      }).join('');

      custDropdown.hidden = false;
    }, 300);
  });

  custDropdown?.addEventListener('click', (e) => {
    const item = e.target.closest('.cust-search-item');
    if (item) {
      const custId = item.dataset.id;
      const cust = customersList.find(c => c.id === custId) || { id: custId, customerName: item.querySelector('.item-title')?.textContent };
      if (cust) {
        setDeskCustomer(cust, true);
      }
      custDropdown.hidden = true;
    }
  });

  document.addEventListener('click', (e) => {
    if (custDropdown && !custDropdown.contains(e.target) && e.target !== custInput) {
      custDropdown.hidden = true;
    }
  });

  // Real-time Product Search Dropdown (Indexed Remote Search with Debounce & Cancellation)
  let lastProductSearchHits = [];

  $('productSearch')?.addEventListener('input', (e) => {
    clearTimeout(prodSearchTimer);
    const query = e.target.value.toLowerCase().trim();
    const dropdown = $('productSearchResults');
    if (!dropdown) return;
    if (!query) {
      dropdown.hidden = true;
      return;
    }

    prodSearchTimer = setTimeout(async () => {
      const seqId = ++prodSearchSeqId;
      const matches = await searchProductsRemote(query);
      if (seqId !== prodSearchSeqId) return; // Stale request cancellation guard

      lastProductSearchHits = matches;

      if (!matches || matches.length === 0) {
        dropdown.innerHTML = `<div class="search-result-item" style="color:#888;">No matching product found.</div>`;
        dropdown.hidden = false;
        return;
      }

      dropdown.innerHTML = matches.slice(0, 8).map(p => `
        <div class="search-result-item prod-search-item" data-id="${p.id}">
          <div>
            <div class="item-title">${esc(p.productName)}</div>
            <div class="item-meta">HSN: ${esc(p.hsnCode || '—')} | ${esc(p.category || 'General')}</div>
          </div>
          <div>
            <div class="item-price">${money(p.sellingRate)} / ${esc(p.unit || 'KG')}</div>
            <div class="item-stock">Stock: ${p.currentStock || 0} ${esc(p.unit || '')}</div>
          </div>
        </div>
      `).join('');

      dropdown.hidden = false;
    }, 300);
  });

  // Handle Search Result Selection
  $('productSearchResults')?.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.search-result-item');
    if (!itemEl || !itemEl.dataset.id) return;
    const prod = lastProductSearchHits.find(p => p.id === itemEl.dataset.id) || productsList.find(p => p.id === itemEl.dataset.id);
    if (prod) {
      selectUnifiedProduct(prod);
    }
  });

  // Add Item via Select Dropdown
  $('addBtn')?.addEventListener('click', () => {
    const select = $('productSelect');
    if (!select || !select.value) return;
    const prod = productsList.find(p => p.id === select.value);
    if (prod) addBillingItem(prod);
  });

  // Items table input changes (Two-way sync for line item % and ₹)
  $('items')?.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const index = +tr.dataset.index;
    const key = e.target.dataset.key;
    if (invoiceItems[index] && key) {
      const item = invoiceItems[index];
      const val = Number(e.target.value) || 0;

      if (key === 'discount') {
        item.discount = Math.max(0, Math.min(100, val));
        const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
        item.discountAmount = round2((gross * item.discount) / 100);
        const amountInput = tr.querySelector('input[data-key="discountAmount"]');
        if (amountInput) amountInput.value = item.discountAmount > 0 ? item.discountAmount : '0';
      } else if (key === 'discountAmount') {
        const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
        item.discountAmount = Math.max(0, Math.min(gross, val));
        item.discount = gross > 0 ? round2((item.discountAmount / gross) * 100) : 0;
        const pctInput = tr.querySelector('input[data-key="discount"]');
        if (pctInput) pctInput.value = item.discount > 0 ? item.discount : '0';
      } else if (key === 'qty' || key === 'rate') {
        item[key] = Math.max(0, val);
        const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
        item.discountAmount = round2((gross * (Number(item.discount) || 0)) / 100);
        const amountInput = tr.querySelector('input[data-key="discountAmount"]');
        if (amountInput) amountInput.value = item.discountAmount > 0 ? item.discountAmount : '0';
      } else if (key === 'gstRate') {
        item.gstRate = Math.max(0, val);
      } else {
        item[key] = e.target.value;
      }

      if (['qty', 'rate', 'discount', 'discountAmount'].includes(key)) {
        syncItemsDiscountToDocument();
      }
      recalculateInvoice();
    }
  });

  $('items')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) {
      invoiceItems.splice(+btn.dataset.remove, 1);
      renderInvoiceItems();
      syncItemsDiscountToDocument();
      recalculateInvoice();
    }
  });

  $('newBtn')?.addEventListener('click', () => {
    invoiceItems = [];
    selectedCustomerId = null;
    selectedCustomer = null;
    $('customer').value = '';
    $('phone').value = '';
    $('customerGstin').value = '';
    $('address').value = '';
    if ($('notes')) $('notes').value = '';
    if ($('overallDiscountInput')) $('overallDiscountInput').value = '0';
    if ($('overallDiscountPercent')) $('overallDiscountPercent').value = '0';
    if ($('overallDiscountAmount')) $('overallDiscountAmount').value = '0';
    if ($('overallDiscountType')) $('overallDiscountType').value = 'amount';
    if ($('payableStatus')) $('payableStatus').value = 'full_payment';
    if ($('advanceAmountWrap')) $('advanceAmountWrap').hidden = true;
    if ($('advanceAmount')) $('advanceAmount').value = '';
    updateCustomerLookupStatusBadge('clear');
    renderInvoiceItems();
  });

  // Save Invoice Button with immediate loading & operation lock
  $('saveBtn')?.addEventListener('click', async () => {
    const saveBtnEl = $('saveBtn');
    const docType = $('type').value;
    const invType = $('invoiceType')?.value || 'GST';
    const isQuo = docType === 'quotation';

    await withLock('save_invoice', async () => {
      setButtonLoading(saveBtnEl, true, isQuo ? 'Saving Quotation...' : 'Saving Invoice...');
      try {
        const payload = {
          invoiceType: invType,
          overallDiscountVal: Number($('overallDiscountInput')?.value) || 0,
          overallDiscountType: $('overallDiscountType')?.value || 'amount',
          customerId: selectedCustomerId || null,
          customerName: $('customer').value || 'Walk-in Customer',
          phone: $('phone').value || '',
          customerGstin: $('customerGstin').value || '',
          customerStateCode: $('state').value || '33',
          billingAddress: $('address').value || '',
          deliveryAddress: selectedCustomer ? (selectedCustomer.deliveryAddress || $('address').value) : $('address').value || '',
          customerType: selectedCustomer ? (selectedCustomer.customerType || 'B2B') : 'B2B',
          customerTaxType: selectedCustomer ? (selectedCustomer.taxType || selectedCustomer.customerTaxType) : (invType === 'GST' ? 'GST' : 'NON_GST'),
          customerSnapshot: selectedCustomer ? {
            customerId: selectedCustomer.id || selectedCustomerId,
            customerName: selectedCustomer.customerName || $('customer').value,
            phone: selectedCustomer.phone || $('phone').value,
            customerType: selectedCustomer.customerType || 'B2B',
            taxType: selectedCustomer.taxType || selectedCustomer.customerTaxType || invType,
            gstin: selectedCustomer.gstin || $('customerGstin').value || '',
            state: selectedCustomer.state || 'Tamil Nadu',
            stateCode: selectedCustomer.stateCode || $('state').value || '33',
            billingAddress: selectedCustomer.billingAddress || $('address').value || '',
            deliveryAddress: selectedCustomer.deliveryAddress || $('address').value || ''
          } : {
            customerId: selectedCustomerId || null,
            customerName: $('customer').value || 'Walk-in Customer',
            phone: $('phone').value || '',
            customerType: 'B2B',
            taxType: invType,
            gstin: $('customerGstin').value || '',
            state: 'Tamil Nadu',
            stateCode: $('state').value || '33',
            billingAddress: $('address').value || '',
            deliveryAddress: $('address').value || ''
          },
          paymentMode: $('payment').value,
          payableStatus: $('payableStatus')?.value || 'full_payment',
          advanceAmount: $('payableStatus')?.value === 'advance' ? (Number($('advanceAmount')?.value) || 0) : 0,
          notes: $('notes').value,
          date: $('date').value || todayStr(),
          items: invoiceItems
        };

        if (isQuo) {
          const qDoc = await saveQuotation(payload);
          if (qDoc) {
            toast('✓ Quotation saved successfully!', 'success');
            activePreviewDoc = qDoc;
            $('printDialog').showModal();
            renderPrintPreview();
          }
        } else {
          const invDoc = await saveInvoice(payload);
          if (invDoc) {
            toast(`✓ Invoice ${invDoc.invoiceNumber || ''} saved successfully!`, 'success');
            activePreviewDoc = invDoc;
            invoiceItems = [];
            selectedCustomerId = null;
            selectedCustomer = null;
            updateCustomerLookupStatusBadge('clear');
            renderInvoiceItems();
            $('printDialog').showModal();
            renderPrintPreview();
          }
        }
      } catch (err) {
        console.error('Invoice save error:', err);
        toast('Failed to save document. Please check inputs and try again.', 'error');
      } finally {
        setButtonLoading(saveBtnEl, false);
      }
    });
  });

  // Preview Button
  $('previewBtn')?.addEventListener('click', () => {
    if (invoiceItems.length === 0) {
      toast('Please add items to preview invoice.', 'warning');
      return;
    }
    const invType = $('invoiceType')?.value || 'GST';
    const tempTotals = calculateDocumentTotals(invoiceItems, companySettings.stateCode, $('state').value || '33', 0, 0, invType);
    activePreviewDoc = {
      invoiceType: invType,
      invoiceNumber: 'DRAFT-PREVIEW',
      invoiceDate: $('date').value || todayStr(),
      customerName: $('customer').value || 'Walk-in Customer',
      phone: $('phone').value,
      customerGstin: $('customerGstin').value,
      billingAddress: $('address').value,
      paymentMode: $('payment').value,
      payableStatus: $('payableStatus')?.value || 'full_payment',
      advanceAmount: $('payableStatus')?.value === 'advance' ? (Number($('advanceAmount')?.value) || 0) : 0,
      companySnapshot: companySettings,
      itemsSnapshot: tempTotals.items,
      totals: tempTotals
    };
    $('printDialog').showModal();
    renderPrintPreview();
  });

  // History Filter listener
  $('historyFilterSelect')?.addEventListener('change', renderInvoiceHistory);

  // Print Dialog actions
  $('paper')?.addEventListener('change', renderPrintPreview);
  $('printBtn')?.addEventListener('click', () => window.print());
}

function onInvoiceTypeChange() {
  const invType = $('invoiceType')?.value || 'GST';
  const isNonGst = invType === 'NON_GST';
  const isQuo = $('type')?.value === 'quotation';

  document.querySelectorAll('.gst-col').forEach(el => el.hidden = isNonGst);
  document.querySelectorAll('.gst-row').forEach(el => el.hidden = isNonGst);

  const gstinInput = $('customerGstin');
  if (gstinInput) {
    gstinInput.placeholder = isNonGst ? (isQuo ? 'Optional for Non-GST Quotation' : 'Optional for Non-GST Bill') : (isQuo ? 'Optional / Required for GST Quotation' : 'Required for GST Invoice (e.g. 33AAACS1234F1Z5)');
  }

  const summaryTitle = $('summaryTitle');
  if (summaryTitle) {
    if (isQuo) {
      summaryTitle.textContent = isNonGst ? 'Non-GST Quotation' : 'GST Quotation';
    } else {
      summaryTitle.textContent = isNonGst ? 'Non-GST Bill' : 'GST Invoice';
    }
  }

  renderInvoiceItems();
}

let isSyncingDiscount = false;

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

function onOverallDiscountPercentInput() {
  if (isSyncingDiscount) return;
  isSyncingDiscount = true;
  try {
    const pct = Math.max(0, Math.min(100, Number($('overallDiscountPercent')?.value) || 0));
    const grossSubtotal = invoiceItems.reduce((acc, item) => acc + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
    const amount = round2((grossSubtotal * pct) / 100);

    if ($('overallDiscountAmount')) {
      $('overallDiscountAmount').value = amount > 0 ? amount : '0';
    }
    if ($('overallDiscountInput')) {
      $('overallDiscountInput').value = amount;
    }
    if ($('overallDiscountType')) {
      $('overallDiscountType').value = 'amount';
    }

    // Distribute discount percentage to line items
    invoiceItems.forEach((item) => {
      item.discount = pct;
      const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
      item.discountAmount = round2((gross * pct) / 100);
    });

    const rows = document.querySelectorAll('#items tr');
    rows.forEach((tr, idx) => {
      const pInput = tr.querySelector('input[data-key="discount"]');
      const aInput = tr.querySelector('input[data-key="discountAmount"]');
      if (invoiceItems[idx]) {
        if (pInput) pInput.value = invoiceItems[idx].discount;
        if (aInput) aInput.value = invoiceItems[idx].discountAmount;
      }
    });
  } finally {
    isSyncingDiscount = false;
  }
  recalculateInvoice();
}

function onOverallDiscountAmountInput() {
  if (isSyncingDiscount) return;
  isSyncingDiscount = true;
  try {
    const grossSubtotal = invoiceItems.reduce((acc, item) => acc + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
    const amount = Math.max(0, Number($('overallDiscountAmount')?.value) || 0);
    const pct = grossSubtotal > 0 ? round2(Math.min(100, (amount / grossSubtotal) * 100)) : 0;

    if ($('overallDiscountPercent')) {
      $('overallDiscountPercent').value = pct > 0 ? pct : '0';
    }
    if ($('overallDiscountInput')) {
      $('overallDiscountInput').value = amount;
    }
    if ($('overallDiscountType')) {
      $('overallDiscountType').value = 'amount';
    }

    // Distribute proportionally across line items
    invoiceItems.forEach((item) => {
      item.discount = pct;
      const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
      item.discountAmount = round2((gross * pct) / 100);
    });

    const rows = document.querySelectorAll('#items tr');
    rows.forEach((tr, idx) => {
      const pInput = tr.querySelector('input[data-key="discount"]');
      const aInput = tr.querySelector('input[data-key="discountAmount"]');
      if (invoiceItems[idx]) {
        if (pInput) pInput.value = invoiceItems[idx].discount;
        if (aInput) aInput.value = invoiceItems[idx].discountAmount;
      }
    });
  } finally {
    isSyncingDiscount = false;
  }
  recalculateInvoice();
}

function syncDocumentDiscountToItems() {
  if (isSyncingDiscount) return;
  isSyncingDiscount = true;
  try {
    const val = Number($('overallDiscountInput')?.value) || 0;
    const type = $('overallDiscountType')?.value || 'amount';
    if (invoiceItems.length === 0) return;

    const grossSubtotal = invoiceItems.reduce((acc, item) => acc + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);

    let docPct = 0;
    let docAmt = 0;
    if (type === 'percent') {
      docPct = Math.max(0, Math.min(100, val));
      docAmt = round2((grossSubtotal * docPct) / 100);
    } else {
      docAmt = Math.max(0, val);
      docPct = grossSubtotal > 0 ? round2(Math.min(100, (docAmt / grossSubtotal) * 100)) : 0;
    }

    if ($('overallDiscountPercent')) $('overallDiscountPercent').value = docPct;
    if ($('overallDiscountAmount')) $('overallDiscountAmount').value = docAmt;

    invoiceItems.forEach((item) => {
      item.discount = docPct;
      const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
      item.discountAmount = round2((gross * docPct) / 100);
    });

    const rows = document.querySelectorAll('#items tr');
    rows.forEach((tr, idx) => {
      const pInput = tr.querySelector('input[data-key="discount"]');
      const aInput = tr.querySelector('input[data-key="discountAmount"]');
      if (invoiceItems[idx]) {
        if (pInput) pInput.value = invoiceItems[idx].discount;
        if (aInput) aInput.value = invoiceItems[idx].discountAmount;
      }
    });
  } finally {
    isSyncingDiscount = false;
  }
}

function syncItemsDiscountToDocument() {
  if (isSyncingDiscount) return;
  isSyncingDiscount = true;
  try {
    const grossSubtotal = invoiceItems.reduce((acc, item) => acc + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
    const totalItemDisc = invoiceItems.reduce((acc, item) => {
      const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
      const discAmt = item.discountAmount !== undefined && item.discountAmount !== null
        ? Number(item.discountAmount)
        : ((gross * (Number(item.discount) || 0)) / 100);
      return acc + (Number(discAmt) || 0);
    }, 0);

    const roundedDisc = round2(totalItemDisc);
    const pct = grossSubtotal > 0 ? round2(Math.min(100, (roundedDisc / grossSubtotal) * 100)) : 0;

    if ($('overallDiscountAmount')) $('overallDiscountAmount').value = roundedDisc > 0 ? roundedDisc : '0';
    if ($('overallDiscountPercent')) $('overallDiscountPercent').value = pct > 0 ? pct : '0';
    if ($('overallDiscountInput')) $('overallDiscountInput').value = roundedDisc;
    if ($('overallDiscountType')) $('overallDiscountType').value = 'amount';
  } finally {
    isSyncingDiscount = false;
  }
}

function addBillingItem(prod) {
  const currentPct = Number($('overallDiscountPercent')?.value) || 0;
  const currentAmt = Number($('overallDiscountAmount')?.value) || 0;
  let initialDiscount = currentPct;

  if (initialDiscount === 0 && currentAmt > 0 && invoiceItems.length > 0) {
    const grossSubtotal = invoiceItems.reduce((acc, item) => acc + ((Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
    if (grossSubtotal > 0) {
      initialDiscount = (currentAmt / grossSubtotal) * 100;
    }
  }

  const rate = prod.sellingRate || 0;
  const initialDiscAmt = round2((rate * initialDiscount) / 100);

  invoiceItems.push({
    productId: prod.id,
    productName: prod.productName,
    hsn: prod.hsnCode || '',
    unit: prod.unit || 'KG',
    rate: rate,
    gstRate: prod.gstRate || 5,
    qty: 1,
    discount: round2(initialDiscount),
    discountAmount: initialDiscAmt
  });
  renderInvoiceItems();
  syncItemsDiscountToDocument();
}

function renderInvoiceItems() {
  const container = $('items');
  if (!container) return;
  const invType = $('invoiceType')?.value || 'GST';
  const isNonGst = invType === 'NON_GST';

  container.innerHTML = invoiceItems.map((item, idx) => {
    const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
    const discAmt = item.discountAmount !== undefined && item.discountAmount !== null
      ? item.discountAmount
      : round2((gross * (Number(item.discount) || 0)) / 100);
    item.discountAmount = discAmt;

    return `
    <tr data-index="${idx}">
      <td>
        <input data-key="productName" value="${esc(item.productName)}" placeholder="Product name">
        <input data-key="hsn" value="${esc(item.hsn)}" placeholder="HSN" ${isNonGst ? 'style="display:none;"' : ''}>
      </td>
      <td>
        <input data-key="qty" type="number" step="0.001" value="${item.qty}">
        <input class="unit" data-key="unit" value="${esc(item.unit)}">
      </td>
      <td><input data-key="rate" type="number" step="0.01" value="${item.rate}"></td>
      <td class="gst-col" ${isNonGst ? 'hidden' : ''}><input data-key="gstRate" type="number" step="0.01" value="${item.gstRate}"></td>
      <td><input data-key="discount" type="number" step="0.01" min="0" max="100" value="${item.discount ?? 0}" placeholder="0" style="width:55px; text-align:right;"></td>
      <td><input data-key="discountAmount" type="number" step="0.01" min="0" value="${discAmt}" placeholder="0.00" style="width:65px; text-align:right;"></td>
      <td class="line-total font-bold">₹0.00</td>
      <td><button class="remove" data-remove="${idx}">×</button></td>
    </tr>
  `;
  }).join('');

  if ($('empty')) $('empty').hidden = invoiceItems.length > 0;
  if ($('itemCount')) $('itemCount').textContent = invoiceItems.length;
  recalculateInvoice();
}

function recalculateInvoice() {
  const invType = $('invoiceType')?.value || 'GST';
  const overallDiscountVal = Number($('overallDiscountAmount')?.value ?? $('overallDiscountInput')?.value) || 0;
  const overallDiscountType = 'amount';

  const totals = calculateDocumentTotals(
    invoiceItems,
    companySettings.stateCode || '33',
    $('state')?.value || '33',
    0,
    0,
    invType,
    overallDiscountVal,
    overallDiscountType
  );

  const rows = document.querySelectorAll('#items tr');
  rows.forEach((tr, i) => {
    const totalCell = tr.querySelector('.line-total');
    if (totalCell && totals.items[i]) {
      totalCell.textContent = money(totals.items[i].lineTotal);
    }
  });

  if ($('subtotal')) $('subtotal').textContent = money(totals.subtotal);
  if ($('discount')) $('discount').textContent = money(totals.totalDiscount);

  if ($('taxable')) $('taxable').textContent = money(totals.totalTaxable);
  if ($('grand')) $('grand').textContent = money(totals.grandTotal);

  const taxRows = $('taxRows');
  if (taxRows) {
    if (invType === 'NON_GST') {
      taxRows.innerHTML = '';
    } else if (totals.isIntraState) {
      taxRows.innerHTML = `
        <div class="summary-row"><span>CGST</span><b>${money(totals.totalCgst)}</b></div>
        <div class="summary-row"><span>SGST</span><b>${money(totals.totalSgst)}</b></div>
      `;
    } else {
      taxRows.innerHTML = `<div class="summary-row"><span>IGST</span><b>${money(totals.totalIgst)}</b></div>`;
    }
  }
}

/**
 * Render Data Tables with Firestore Cursor Pagination
 */

// 1. INVOICE HISTORY PAGINATION
async function renderInvoiceHistoryPage(page = 1) {
  showSkeleton('historyRows', 6, 9);
  const state = paginationState.history;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchInvoicesPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('historyRows');
  if (!container) return;

  const filterVal = $('historyFilterSelect')?.value || 'ALL';
  const invoices = res.invoices.filter(inv => {
    const invType = (inv.invoiceType || 'GST').toUpperCase();
    if (filterVal === 'GST') return invType === 'GST';
    if (filterVal === 'NON_GST') return invType === 'NON_GST';
    return true;
  });

  if (invoices.length === 0) {
    container.innerHTML = `<tr><td colspan="9" class="empty">No saved invoices found on this page.</td></tr>`;
  } else {
    container.innerHTML = invoices.map(inv => {
      const invType = (inv.invoiceType || 'GST').toUpperCase();
      const isCancelled = inv.status === 'CANCELLED';
      const payStatus = getPaymentStatusInfo(inv, 'sales');
      return `
        <tr style="${isCancelled ? 'opacity:0.6;background-color:#fff5f5;' : ''}">
          <td><strong>${esc(inv.invoiceNumber)}</strong></td>
          <td>${formatDate(inv.invoiceDate)}</td>
          <td><span class="badge ${invType === 'NON_GST' ? 'warning' : 'success'}">${invType === 'NON_GST' ? 'Non-GST' : 'GST'}</span></td>
          <td>${esc(inv.customerName)}</td>
          <td><strong>${money(inv.grandTotal ?? inv.totals?.grandTotal)}</strong></td>
          <td><span class="tag">${esc(inv.paymentMode)}</span></td>
          <td><span class="badge ${payStatus.badgeClass}">${esc(payStatus.statusText)}</span></td>
          <td><span class="badge ${isCancelled ? 'danger' : 'success'}">${isCancelled ? 'CANCELLED' : 'PAID'}</span></td>
          <td>
            <button class="small-btn view-inv-btn" data-id="${inv.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Print
            </button>
            ${!isCancelled ? `<button class="small-btn danger cancel-inv-btn" data-id="${inv.id}" data-num="${esc(inv.invoiceNumber)}">Cancel</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    container.querySelectorAll('.view-inv-btn').forEach(b => {
      b.addEventListener('click', () => {
        const inv = res.invoices.find(i => i.id === b.dataset.id);
        if (inv) {
          activePreviewDoc = inv;
          $('printDialog').showModal();
          renderPrintPreview();
        }
      });
    });

    container.querySelectorAll('.cancel-inv-btn').forEach(b => {
      b.addEventListener('click', () => {
        if ($('cancelInvId')) $('cancelInvId').value = b.dataset.id;
        if ($('cancelInvNumText')) $('cancelInvNumText').textContent = `Cancelling Invoice #${b.dataset.num}`;
        if ($('cancelReason')) $('cancelReason').value = '';
        if ($('cancelInvoiceDialog')) $('cancelInvoiceDialog').showModal();
      });
    });
  }

  // Update Pagination Controls
  if ($('historyPrevBtn')) {
    $('historyPrevBtn').disabled = (page <= 1);
    $('historyPrevBtn').onclick = () => renderInvoiceHistoryPage(page - 1);
  }
  if ($('historyNextBtn')) {
    $('historyNextBtn').disabled = !res.hasMore;
    $('historyNextBtn').onclick = () => renderInvoiceHistoryPage(page + 1);
  }
  if ($('historyPageLabel')) $('historyPageLabel').textContent = `Page ${page}`;
}

async function renderInvoiceHistory() {
  await renderInvoiceHistoryPage(1);
}

// 2. QUOTATIONS PAGINATION
async function renderQuotationsListPage(page = 1) {
  showSkeleton('quotationRows', 5, 5);
  const state = paginationState.quotations;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchQuotationsPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('quotationRows');
  if (!container) return;

  if (res.quotations.length === 0) {
    container.innerHTML = `<tr><td colspan="7" class="empty">No quotations found on this page.</td></tr>`;
  } else {
    container.innerHTML = res.quotations.map(q => `
      <tr>
        <td><strong>${esc(q.quotationNumber)}</strong></td>
        <td>${formatDate(q.quotationDate)}</td>
        <td>${formatDate(q.validUntil)}</td>
        <td>${esc(q.customerName)}</td>
        <td><strong>${money(q.totals?.grandTotal)}</strong></td>
        <td><span class="badge ${q.status === 'CONVERTED' ? 'success' : 'warning'}">${q.status}</span></td>
        <td>
          <button class="small-btn print-quo-btn" data-id="${q.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Print
          </button>
          ${q.status !== 'CONVERTED' ? `<button class="small-btn primary convert-quo-btn" data-id="${q.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg> Convert to Invoice</button>` : ''}
        </td>
      </tr>
    `).join('');

    container.querySelectorAll('.print-quo-btn').forEach(b => {
      b.addEventListener('click', () => {
        const q = res.quotations.find(item => item.id === b.dataset.id);
        if (q) {
          activePreviewDoc = q;
          $('printDialog').showModal();
          renderPrintPreview();
        }
      });
    });

    container.querySelectorAll('.convert-quo-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const q = res.quotations.find(item => item.id === b.dataset.id);
        if (q) {
          await withLock(`convert_quo_${q.id}`, async () => {
            setButtonLoading(b, true, 'Converting to Invoice...');
            try {
              const inv = await convertQuotationToInvoice(q);
              if (inv) {
                toast(`✓ Quotation converted to Invoice #${inv.invoiceNumber}!`, 'success');
                navigate('history');
              }
            } finally {
              setButtonLoading(b, false);
            }
          });
        }
      });
    });
  }

  // Update Controls
  if ($('quotationsPrevBtn')) {
    $('quotationsPrevBtn').disabled = (page <= 1);
    $('quotationsPrevBtn').onclick = () => renderQuotationsListPage(page - 1);
  }
  if ($('quotationsNextBtn')) {
    $('quotationsNextBtn').disabled = !res.hasMore;
    $('quotationsNextBtn').onclick = () => renderQuotationsListPage(page + 1);
  }
  if ($('quotationsPageLabel')) $('quotationsPageLabel').textContent = `Page ${page}`;
}

async function renderQuotationsList() {
  await renderQuotationsListPage(1);
}

// 3. PURCHASE HISTORY PAGINATION
async function renderPurchaseHistoryPage(page = 1) {
  showSkeleton('purchaseHistoryRows', 6, 7);
  const state = paginationState.purchaseHistory;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchPurchasesPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('purchaseHistoryRows');
  if (!container) return;

  if (res.purchases.length === 0) {
    container.innerHTML = `<tr><td colspan="7" class="empty">No purchase records found on this page.</td></tr>`;
  } else {
    container.innerHTML = res.purchases.map(p => {
      const payStatus = getPaymentStatusInfo(p, 'purchase');
      return `
        <tr>
          <td><strong>${esc(p.purchaseNumber)}</strong></td>
          <td>${formatDate(p.purchaseDate)}</td>
          <td>${esc(p.supplierName)}</td>
          <td>${esc(p.supplierInvoiceNo || '—')}</td>
          <td><strong>${money(p.totals?.grandTotal)}</strong></td>
          <td><span class="badge ${payStatus.badgeClass}">${esc(payStatus.statusText)}</span></td>
          <td>
            <button class="small-btn print-pur-btn" data-id="${p.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> View
            </button>
          </td>
        </tr>
      `;
    }).join('');

    container.querySelectorAll('.print-pur-btn').forEach(b => {
      b.addEventListener('click', () => {
        const p = res.purchases.find(item => item.id === b.dataset.id);
        if (p) {
          activePreviewDoc = p;
          $('printDialog').showModal();
          renderPrintPreview();
        }
      });
    });
  }

  if ($('purchaseHistoryPrevBtn')) {
    $('purchaseHistoryPrevBtn').disabled = (page <= 1);
    $('purchaseHistoryPrevBtn').onclick = () => renderPurchaseHistoryPage(page - 1);
  }
  if ($('purchaseHistoryNextBtn')) {
    $('purchaseHistoryNextBtn').disabled = !res.hasMore;
    $('purchaseHistoryNextBtn').onclick = () => renderPurchaseHistoryPage(page + 1);
  }
  if ($('purchaseHistoryPageLabel')) $('purchaseHistoryPageLabel').textContent = `Page ${page}`;
}

async function renderPurchaseHistory() {
  await renderPurchaseHistoryPage(1);
}

// 4. PRODUCTS MASTER PAGINATION
async function renderProductsTablePage(page = 1) {
  showSkeleton('productsRows', 7, 5);
  const state = paginationState.products;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchProductsPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  renderProductsTable('productsRows', {}, res.products);

  const container = $('productsRows');
  if (container) {
    container.querySelectorAll('.edit-prod-btn').forEach(b => {
      b.addEventListener('click', () => {
        const prod = res.products.find(p => p.id === b.dataset.id) || productsList.find(p => p.id === b.dataset.id);
        if (prod) openProductModal(prod, 'EDIT');
      });
    });
    container.querySelectorAll('.delete-prod-btn').forEach(b => {
      b.addEventListener('click', () => deleteProduct(b.dataset.id, b.getAttribute('data-name') || ''));
    });
  }

  if ($('productsPrevBtn')) {
    $('productsPrevBtn').disabled = (page <= 1);
    $('productsPrevBtn').onclick = () => renderProductsTablePage(page - 1);
  }
  if ($('productsNextBtn')) {
    $('productsNextBtn').disabled = !res.hasMore;
    $('productsNextBtn').onclick = () => renderProductsTablePage(page + 1);
  }
  if ($('productsPageLabel')) $('productsPageLabel').textContent = `Page ${page}`;
}

function renderStockTable() {
  const container = $('stockStatusRows');
  if (!container) return;
  container.innerHTML = productsList.map(p => `
    <tr>
      <td><strong>${esc(p.productName)}</strong></td>
      <td>${esc(p.category || 'General')}</td>
      <td>${esc(p.unit || 'KG')}</td>
      <td><strong>${p.currentStock || 0}</strong></td>
      <td>${p.minimumStock || 5}</td>
      <td>${money((p.currentStock || 0) * (p.purchaseRate || p.sellingRate || 0))}</td>
      <td>
        <button class="small-btn primary adj-stock-btn" data-id="${p.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Adjust
        </button>
      </td>
    </tr>
  `).join('');

  container.querySelectorAll('.adj-stock-btn').forEach(b => {
    b.addEventListener('click', () => {
      const pId = b.dataset.id;
      if ($('adjProdSelect')) $('adjProdSelect').value = pId;
      $('restockDialog').showModal();
    });
  });
}

// 5. CUSTOMERS DIRECTORY PAGINATION
async function renderCustomersTablePage(page = 1) {
  showSkeleton('customerRows', 6, 5);
  const state = paginationState.customers;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchCustomersPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('customerRows');
  if (!container) return;

  if (res.customers.length === 0) {
    container.innerHTML = `<tr><td colspan="7" class="empty">No customers found on this page.</td></tr>`;
  } else {
    container.innerHTML = res.customers.map(c => {
      const taxType = (c.customerTaxType || (c.gstin ? 'GST' : 'NON_GST')).toUpperCase();
      return `
        <tr>
          <td><strong>${esc(c.customerName)}</strong>${c.businessName ? `<br><small style="color:#666;">${esc(c.businessName)}</small>` : ''}</td>
          <td><span class="badge ${taxType === 'NON_GST' ? 'warning' : 'success'}">${taxType === 'NON_GST' ? 'Non-GST' : 'GST'}</span> <span class="tag">${esc(c.customerType || 'Retail')}</span></td>
          <td>${esc(c.phone || '—')}</td>
          <td>${esc(c.gstin || 'Unregistered')}</td>
          <td>${esc(c.city || 'Chennai')}, ${esc(c.state || 'Tamil Nadu')}</td>
          <td><strong style="color:${(c.currentOutstanding || 0) > 0 ? '#d32f2f' : '#137333'}">${money(c.currentOutstanding)}</strong></td>
          <td>
            <button class="small-btn edit-cust-btn" data-id="${c.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit
            </button>
            <button class="small-btn danger del-cust-btn" data-id="${c.id}" data-name="${esc(c.customerName)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    container.querySelectorAll('.edit-cust-btn').forEach(b => {
      b.addEventListener('click', () => {
        const cust = res.customers.find(c => c.id === b.dataset.id);
        if (cust) openCustomerModal(cust, 'EDIT');
      });
    });

    container.querySelectorAll('.del-cust-btn').forEach(b => {
      b.addEventListener('click', () => deleteCustomer(b.dataset.id, b.dataset.name));
    });
  }

  if ($('customersPrevBtn')) {
    $('customersPrevBtn').disabled = (page <= 1);
    $('customersPrevBtn').onclick = () => renderCustomersTablePage(page - 1);
  }
  if ($('customersNextBtn')) {
    $('customersNextBtn').disabled = !res.hasMore;
    $('customersNextBtn').onclick = () => renderCustomersTablePage(page + 1);
  }
  if ($('customersPageLabel')) $('customersPageLabel').textContent = `Page ${page}`;
}

async function renderCustomersTable() {
  await renderCustomersTablePage(1);
}

// 6. SUPPLIERS DIRECTORY PAGINATION
async function renderSuppliersTablePage(page = 1) {
  showSkeleton('supplierRows', 6, 5);
  const state = paginationState.suppliers;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchSuppliersPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('supplierRows');
  if (!container) return;

  if (res.suppliers.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="empty">No suppliers found on this page.</td></tr>`;
  } else {
    container.innerHTML = res.suppliers.map(s => `
      <tr>
        <td><strong>${esc(s.supplierName)}</strong></td>
        <td>${esc(s.phone || '—')}</td>
        <td>${esc(s.gstin || '—')}</td>
        <td>${esc(s.city || '—')}, ${esc(s.state || '—')}</td>
        <td><strong style="color:${(s.currentOutstanding || 0) > 0 ? '#d32f2f' : '#137333'}">${money(s.currentOutstanding)}</strong></td>
        <td>
          <button class="small-btn edit-supp-btn" data-id="${s.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit
          </button>
          <button class="small-btn danger del-supp-btn" data-id="${s.id}" data-name="${esc(s.supplierName)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `).join('');

    container.querySelectorAll('.edit-supp-btn').forEach(b => {
      b.addEventListener('click', () => {
        const supp = res.suppliers.find(s => s.id === b.dataset.id);
        if (supp) openSupplierModal(supp, 'EDIT');
      });
    });

    container.querySelectorAll('.del-supp-btn').forEach(b => {
      b.addEventListener('click', () => deleteSupplier(b.dataset.id, b.dataset.name));
    });
  }

  if ($('suppliersPrevBtn')) {
    $('suppliersPrevBtn').disabled = (page <= 1);
    $('suppliersPrevBtn').onclick = () => renderSuppliersTablePage(page - 1);
  }
  if ($('suppliersNextBtn')) {
    $('suppliersNextBtn').disabled = !res.hasMore;
    $('suppliersNextBtn').onclick = () => renderSuppliersTablePage(page + 1);
  }
  if ($('suppliersPageLabel')) $('suppliersPageLabel').textContent = `Page ${page}`;
}

async function renderSuppliersTable() {
  await renderSuppliersTablePage(1);
}

// 7. EXPENSES MANAGEMENT PAGINATION
async function renderExpensesTablePage(page = 1) {
  showSkeleton('expenseRows', 6, 5);
  const state = paginationState.expenses;
  const lastDoc = state.lastDocs[page - 1] || null;
  const res = await fetchExpensesPage(25, lastDoc);

  state.page = page;
  state.hasMore = res.hasMore;
  if (res.lastDoc && state.lastDocs.length <= page) {
    state.lastDocs.push(res.lastDoc);
  }

  const container = $('expenseRows');
  if (!container) return;

  if (res.expenses.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="empty">No expense records found on this page.</td></tr>`;
  } else {
    container.innerHTML = res.expenses.map(exp => `
      <tr>
        <td>${formatDate(exp.expenseDate)}</td>
        <td><span class="tag">${esc(exp.category)}</span></td>
        <td><strong>${money(exp.amount)}</strong></td>
        <td>${esc(exp.paymentMode)}</td>
        <td>${esc(exp.description || '—')}</td>
        <td>
          <button class="small-btn danger del-exp-btn" data-id="${exp.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `).join('');

    container.querySelectorAll('.del-exp-btn').forEach(b => {
      b.addEventListener('click', () => deleteExpense(b.dataset.id));
    });
  }

  if ($('expensesPrevBtn')) {
    $('expensesPrevBtn').disabled = (page <= 1);
    $('expensesPrevBtn').onclick = () => renderExpensesTablePage(page - 1);
  }
  if ($('expensesNextBtn')) {
    $('expensesNextBtn').disabled = !res.hasMore;
    $('expensesNextBtn').onclick = () => renderExpensesTablePage(page + 1);
  }
  if ($('expensesPageLabel')) $('expensesPageLabel').textContent = `Page ${page}`;
}

function renderExpensesTable() {
  const container = $('expenseRows');
  if (!container) return;
  if (expensesList.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="empty">No expenses recorded yet.</td></tr>`;
    return;
  }

  container.innerHTML = expensesList.map(exp => `
    <tr>
      <td>${formatDate(exp.expenseDate)}</td>
      <td><span class="tag">${esc(exp.category)}</span></td>
      <td><strong>${money(exp.amount)}</strong></td>
      <td>${esc(exp.paymentMode)}</td>
      <td>${esc(exp.description || '—')}</td>
      <td>
        <button class="small-btn danger del-exp-btn" data-id="${exp.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    </tr>
  `).join('');

  container.querySelectorAll('.del-exp-btn').forEach(b => {
    b.addEventListener('click', () => deleteExpense(b.dataset.id));
  });
}

/**
 * Dropdowns & Options Helpers
 */
function updateProductPickers() {
  const allowedProds = (productsList || []).filter(p => isCategoryAllowed(p.category));
  const options = allowedProds.map(p => `<option value="${p.id}">${esc(p.productName)} (Stock: ${p.currentStock || 0} ${esc(p.unit || '')})</option>`).join('');
  
  if ($('productSelect')) $('productSelect').innerHTML = `<option value="">Choose product…</option>` + options;
  if ($('purProductSelect')) $('purProductSelect').innerHTML = `<option value="">Choose product…</option>` + options;
  if ($('srProductSelect')) $('srProductSelect').innerHTML = `<option value="">Choose product…</option>` + options;
  if ($('prProductSelect')) $('prProductSelect').innerHTML = `<option value="">Choose product…</option>` + options;
  if ($('adjProdSelect')) $('adjProdSelect').innerHTML = `<option value="">Choose product…</option>` + options;
}

function updateCustomerDatalist() {
  const options = customersList.map(c => `<option value="${esc(c.customerName)}">${esc(c.customerName)} — ${esc(c.phone || '')}</option>`).join('');
  if ($('customerDatalist')) $('customerDatalist').innerHTML = options;

  const selectOpts = customersList.map(c => {
    const phone = c.phone ? ` (${esc(c.phone)})` : '';
    const gstin = c.gstin ? ` [GST: ${esc(c.gstin)}]` : '';
    return `<option value="${c.id}">${esc(c.customerName)}${phone}${gstin}</option>`;
  }).join('');

  if ($('payCustSelect')) $('payCustSelect').innerHTML = `<option value="">Choose customer...</option>` + selectOpts;
  if ($('srCustomerSelect')) $('srCustomerSelect').innerHTML = `<option value="">Choose customer...</option>` + selectOpts;
}

function updateSupplierDropdowns() {
  const options = suppliersList.map(s => {
    const phone = s.phone ? ` (${esc(s.phone)})` : '';
    const gstin = s.gstin ? ` [GST: ${esc(s.gstin)}]` : '';
    const out = (s.currentOutstanding !== undefined && s.currentOutstanding !== null) ? ` (Bal: ${money(s.currentOutstanding)})` : '';
    return `<option value="${s.id}">${esc(s.supplierName)}${phone}${gstin}${out}</option>`;
  }).join('');

  if ($('purSupplierSelect')) $('purSupplierSelect').innerHTML = `<option value="">Select Supplier...</option>` + options;
  if ($('paySuppSelect')) $('paySuppSelect').innerHTML = `<option value="">Choose supplier...</option>` + options;
  if ($('prSupplierSelect')) $('prSupplierSelect').innerHTML = `<option value="">Choose supplier...</option>` + options;
}

function openCustomerModal(custData = {}, mode = 'CREATE') {
  if (!$('customerDialog')) return;
  if ($('custModalTitle')) $('custModalTitle').textContent = mode === 'EDIT' ? 'Edit Customer' : 'Create New Customer';
  if ($('custId')) $('custId').value = custData.id || '';
  if ($('custName')) $('custName').value = custData.customerName || (mode === 'CREATE' ? ($('customer')?.value || '') : '');
  if ($('custPhone')) $('custPhone').value = custData.phone || normalizePhone($('phone')?.value) || '';

  const taxType = custData.taxType || custData.customerTaxType || (custData.gstin ? 'GST' : 'NON_GST');
  if ($('custTaxType')) $('custTaxType').value = taxType;
  if ($('custType')) $('custType').value = custData.customerType || 'B2B';
  if ($('custGstin')) $('custGstin').value = custData.gstin || '';
  if ($('custState')) $('custState').value = custData.state || 'Tamil Nadu';
  if ($('custStateCode')) $('custStateCode').value = custData.stateCode || '33';
  if ($('custOpeningBalance')) $('custOpeningBalance').value = custData.openingBalance || 0;
  if ($('custCreditLimit')) $('custCreditLimit').value = custData.creditLimit || 0;
  if ($('custPaymentTerms')) $('custPaymentTerms').value = custData.paymentTerms || 'Net 15';
  if ($('custAddress')) $('custAddress').value = custData.billingAddress || custData.address || ($('address')?.value || '');
  if ($('custDeliveryAddress')) $('custDeliveryAddress').value = custData.deliveryAddress || custData.address || ($('address')?.value || '');

  syncModalGstinState();
  $('customerDialog').showModal();
}

function openSupplierModal(suppData = {}, mode = 'CREATE') {
  if (!$('supplierDialog')) return;
  if ($('suppModalTitle')) $('suppModalTitle').textContent = mode === 'EDIT' ? 'Edit Supplier' : 'Add Supplier';
  if ($('suppId')) $('suppId').value = suppData.id || '';
  if ($('suppName')) $('suppName').value = suppData.supplierName || '';
  if ($('suppPhone')) $('suppPhone').value = suppData.phone || '';
  if ($('suppGstin')) $('suppGstin').value = suppData.gstin || '';
  if ($('suppStateCode')) $('suppStateCode').value = suppData.stateCode || '32';
  if ($('suppAddress')) $('suppAddress').value = suppData.address || '';
  if ($('suppOpening')) $('suppOpening').value = suppData.openingBalance || 0;
  $('supplierDialog').showModal();
}

function syncModalGstinState() {
  const isGst = $('custTaxType')?.value === 'GST';
  const gstinInput = $('custGstin');
  const gstinWrap = $('modalCustGstinWrap');
  if (gstinInput) {
    gstinInput.required = isGst;
    gstinInput.disabled = !isGst;
    if (!isGst) gstinInput.value = '';
  }
  if (gstinWrap) {
    gstinWrap.style.opacity = isGst ? '1' : '0.6';
  }
}

/**
 * Setup Modals & Forms
 */
function setupModals() {
  // Product Modal
  $('openAddProdBtn')?.addEventListener('click', () => {
    openProductModal({}, 'CREATE');
  });

  $('quickAddProductBtn')?.addEventListener('click', () => {
    openProductModal({}, 'CREATE');
  });

  $('productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('productForm').querySelector('button[type="submit"]');
    const isEdit = !!$('prodId').value;
    setButtonLoading(btn, true, isEdit ? 'Updating Product...' : 'Saving Product...');
    try {
      const payload = {
        id: $('prodId').value,
        productName: $('prodName').value,
        barcode: $('prodBarcode')?.value || '',
        category: $('prodCategory').value,
        hsnCode: $('prodHsn').value,
        unit: $('prodUnit').value,
        purchaseRate: $('prodPurchaseRate').value,
        sellingRate: $('prodSellingRate').value,
        gstRate: $('prodGstRate').value,
        openingStock: $('prodOpeningStock').value,
        minimumStock: $('prodMinStock').value,
        expiryDate: $('prodExpiryDate')?.value || ''
      };
      const savedProd = await saveProduct(payload);
      $('productDialog').close();
      updateProductPickers();
      if (activePage === 'products') renderProductsTable();

      // If created from search, barcode, or billing desk, automatically select and add to billing items table
      if (savedProd && !isEdit) {
        navigate('billing');
        selectUnifiedProduct(savedProd);
        addUnifiedProductToCart();
        toast(`✓ Created and added product "${savedProd.productName}" to billing items list!`, 'success');
      }
    } catch (err) {
      console.error('Product save error:', err);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Customer Modal
  $('openAddCustomerBtn')?.addEventListener('click', () => {
    openCustomerModal({}, 'CREATE');
  });

  $('custTaxType')?.addEventListener('change', syncModalGstinState);

  $('customerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('customerForm').querySelector('button[type="submit"]');
    const isEdit = !!$('custId').value;
    setButtonLoading(btn, true, isEdit ? 'Updating Customer...' : 'Saving Customer...');

    try {
      const payload = {
        id: $('custId').value,
        customerName: $('custName').value,
        phone: $('custPhone').value,
        customerTaxType: $('custTaxType')?.value || 'GST',
        taxType: $('custTaxType')?.value || 'GST',
        customerType: $('custType').value,
        gstin: $('custGstin').value,
        state: $('custState')?.value || 'Tamil Nadu',
        stateCode: $('custStateCode').value || '33',
        openingBalance: $('custOpeningBalance')?.value || 0,
        creditLimit: $('custCreditLimit')?.value || 0,
        paymentTerms: $('custPaymentTerms')?.value || 'Net 15',
        billingAddress: $('custAddress').value,
        deliveryAddress: $('custDeliveryAddress')?.value || $('custAddress').value,
        address: $('custAddress').value
      };

      const res = await saveCustomer(payload);

      if (res !== false) {
        $('customerDialog').close();

        if (res.isDuplicate) {
          setDeskCustomer(res, true);
          toast(`Loaded existing customer "${res.customerName}" for this phone number.`, 'info');
        } else {
          setDeskCustomer(res);
          toast(`✓ Customer "${res.customerName}" ${isEdit ? 'updated' : 'created'} successfully!`, 'success');
        }

        await loadCustomers();
        updateCustomerDatalist();
        if (activePage === 'customers') renderCustomersTable();
      }
    } catch (err) {
      console.error('Customer save error:', err);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Cancel Invoice Form
  $('cancelInvoiceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('cancelInvoiceForm').querySelector('button[type="submit"]');
    const invId = $('cancelInvId').value;
    const reason = $('cancelReason').value;

    setButtonLoading(btn, true, 'Cancelling Invoice...');
    try {
      const ok = await cancelInvoice(invId, reason);
      if (ok) {
        $('cancelInvoiceDialog').close();
        await renderInvoiceHistory();
        await loadDashboardData();
      }
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Stock Notification Bell
  $('stockNotificationBtn')?.addEventListener('click', async () => {
    await evaluateLowStockAlerts();
    if ($('lowStockDialog')) $('lowStockDialog').showModal();
  });

  // Supplier Modal
  $('openAddSupplierBtn')?.addEventListener('click', () => {
    $('supplierForm').reset();
    $('suppId').value = '';
    $('supplierDialog').showModal();
  });

  $('supplierForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('supplierForm').querySelector('button[type="submit"]');
    const isEdit = !!$('suppId').value;
    setButtonLoading(btn, true, isEdit ? 'Updating Supplier...' : 'Saving Supplier...');

    try {
      const payload = {
        id: $('suppId').value,
        supplierName: $('suppName').value,
        phone: $('suppPhone').value,
        gstin: $('suppGstin').value,
        stateCode: $('suppStateCode').value,
        address: $('suppAddress').value,
        openingBalance: $('suppOpening').value
      };
      await saveSupplier(payload);
      $('supplierDialog').close();
      updateSupplierDropdowns();
      if (activePage === 'suppliers') renderSuppliersTable();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Stock Adjustment Form
  $('openStockAdjBtn')?.addEventListener('click', () => {
    $('restockForm').reset();
    updateProductPickers();
    $('restockDialog').showModal();
  });

  $('restockForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('restockForm').querySelector('button[type="submit"]');
    const prodId = $('adjProdSelect').value;
    const actionType = $('adjAction').value;
    const qty = $('adjQty').value;
    const reason = $('adjReason').value;

    setButtonLoading(btn, true, 'Updating Stock...');
    try {
      await adjustStock(prodId, { actionType, qty, reason });
      $('restockDialog').close();
      renderStockTable();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Purchase Line Item Addition
  $('addPurItemBtn')?.addEventListener('click', () => {
    const prodId = $('purProductSelect').value;
    const prod = productsList.find(p => p.id === prodId);
    if (!prod) {
      toast('Please select a valid product first.', 'warning');
      return;
    }

    purchaseItems.push({
      productId: prod.id,
      productName: prod.productName,
      hsn: prod.hsnCode || '',
      qty: Number($('purQty').value) || 1,
      rate: Number($('purRate').value) || prod.purchaseRate || 0,
      gstRate: Number($('purGst').value) || 5,
      unit: prod.unit || 'KG'
    });
    renderPurchaseItemsTable();

    // Reset picker & return focus to product search box
    if ($('purProductSearch')) $('purProductSearch').value = '';
    if ($('purProductSelect')) $('purProductSelect').value = '';
    if ($('purRate')) $('purRate').value = '';
    if ($('purQty')) $('purQty').value = '10';
    $('purProductSearch')?.focus();
  });

  $('purQty')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('addPurItemBtn')?.click();
    }
  });

  $('purRate')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('addPurItemBtn')?.click();
    }
  });

  $('purchaseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('purchaseForm').querySelector('button[type="submit"]');
    await withLock('save_purchase', async () => {
      setButtonLoading(btn, true, 'Saving Purchase...');
      try {
        const supplierId = $('purSupplierSelect').value;
        const supp = suppliersList.find(s => s.id === supplierId);
        const payload = {
          supplierId,
          supplierName: supp ? supp.supplierName : 'Unknown Supplier',
          supplierGstin: supp ? supp.gstin : '',
          supplierInvoiceNo: $('purSupplierInvNo').value,
          purchaseDate: $('purDate').value || todayStr(),
          freight: $('purFreight').value,
          otherCharges: $('purOtherCharges').value,
          payableStatus: $('purPayableStatus')?.value || 'full_payment',
          advanceAmount: $('purPayableStatus')?.value === 'advance' ? (Number($('purAdvanceAmount')?.value) || 0) : 0,
          items: purchaseItems
        };

        const res = await savePurchase(payload);
        if (res) {
          purchaseItems = [];
          renderPurchaseItemsTable();
          $('purchaseForm').reset();
          navigate('purchaseHistory');
        }
      } finally {
        setButtonLoading(btn, false);
      }
    });
  });

  // Returns Handlers
  $('salesReturnForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('salesReturnForm').querySelector('button[type="submit"]');
    await withLock('sales_return', async () => {
      setButtonLoading(btn, true, 'Processing Return...');
      try {
        const custId = $('srCustomerSelect').value;
        const cust = customersList.find(c => c.id === custId);
        const prodId = $('srProductSelect').value;
        const prod = productsList.find(p => p.id === prodId);

        await saveSalesReturn({
          customerId: custId,
          customerName: cust ? cust.customerName : 'Walk-in',
          originalInvoiceNo: $('srInvoiceNo').value,
          productId: prodId,
          productName: prod ? prod.productName : '',
          unit: prod ? prod.unit : 'KG',
          qty: $('srQty').value,
          rate: $('srRate').value,
          gstRate: $('srGst').value,
          reason: $('srReason').value
        });
        $('salesReturnForm').reset();
      } finally {
        setButtonLoading(btn, false);
      }
    });
  });

  $('purchaseReturnForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('purchaseReturnForm').querySelector('button[type="submit"]');
    await withLock('purchase_return', async () => {
      setButtonLoading(btn, true, 'Processing Purchase Return...');
      try {
        const suppId = $('prSupplierSelect').value;
        const supp = suppliersList.find(s => s.id === suppId);
        const prodId = $('prProductSelect').value;
        const prod = productsList.find(p => p.id === prodId);

        await savePurchaseReturn({
          supplierId: suppId,
          supplierName: supp ? supp.supplierName : '',
          originalPurchaseNo: $('prPurchaseNo').value,
          productId: prodId,
          productName: prod ? prod.productName : '',
          unit: prod ? prod.unit : 'KG',
          qty: $('prQty').value,
          rate: $('prRate').value,
          gstRate: $('prGst').value,
          reason: $('prReason').value
        });
        $('purchaseReturnForm').reset();
      } finally {
        setButtonLoading(btn, false);
      }
    });
  });

  // Payments Form Submission
  $('custPayForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('custPayForm').querySelector('button[type="submit"]');
    await withLock('cust_payment', async () => {
      setButtonLoading(btn, true, 'Saving Payment...');
      try {
        const custId = $('payCustSelect').value;
        const cust = customersList.find(c => c.id === custId);
        await recordCustomerPayment({
          customerId: custId,
          customerName: cust ? cust.customerName : '',
          amount: $('payCustAmount').value,
          paymentMode: $('payCustMode').value,
          referenceNo: $('payCustRef').value,
          paymentDate: $('payCustDate').value || todayStr()
        });
        $('custPayForm').reset();
      } finally {
        setButtonLoading(btn, false);
      }
    });
  });

  $('suppPayForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('suppPayForm').querySelector('button[type="submit"]');
    await withLock('supp_payment', async () => {
      setButtonLoading(btn, true, 'Saving Payment...');
      try {
        const suppId = $('paySuppSelect').value;
        const supp = suppliersList.find(s => s.id === suppId);
        await recordSupplierPayment({
          supplierId: suppId,
          supplierName: supp ? supp.supplierName : '',
          amount: $('paySuppAmount').value,
          paymentMode: $('paySuppMode').value,
          referenceNo: $('paySuppRef').value,
          paymentDate: $('paySuppDate').value || todayStr()
        });
        $('suppPayForm').reset();
      } finally {
        setButtonLoading(btn, false);
      }
    });
  });

  // Expense Form
  $('openAddExpenseBtn')?.addEventListener('click', () => {
    $('expenseForm').reset();
    $('expDate').value = todayStr();
    $('expenseDialog').showModal();
  });

  $('expenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('expenseForm').querySelector('button[type="submit"]');
    setButtonLoading(btn, true, 'Saving Expense...');
    try {
      await saveExpense({
        expenseDate: $('expDate').value,
        category: $('expCategory').value,
        amount: $('expAmount').value,
        paymentMode: $('expMode').value,
        description: $('expDesc').value
      });
      $('expenseDialog').close();
      renderExpensesTable();
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Settings Button & Form
  $('settingsBtn')?.addEventListener('click', () => {
    syncSettingsFormFields();
    $('settingsDialog').showModal();
  });

  $('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('settingsForm').querySelector('button[type="submit"]');
    setButtonLoading(btn, true, 'Saving Settings...');
    try {
      const payload = {
        name: $('settName')?.value || '',
        subtitle: $('settSubtitle')?.value || '',
        logoUrl: $('settLogoUrl')?.value || '',
        terms: $('settTerms')?.value || '',
        address: $('settAddress')?.value || '',
        gstin: $('settGstin')?.value || '',
        phone: $('settPhone')?.value || '',
        email: $('settEmail')?.value || '',
        stateCode: $('settStateCode')?.value || '33',
        invoicePrefix: $('settInvoicePrefix')?.value || 'INV',
        quotationPrefix: $('settQuotationPrefix')?.value || 'QTN',
        allowNegativeStock: Boolean($('settAllowNegativeStock')?.checked),
        bankAccountName: $('settBankName')?.value || '',
        bankName: $('settBankInst')?.value || '',
        bankAccountNo: $('settBankNo')?.value || '',
        bankIfsc: $('settBankIfsc')?.value || '',
        bankBranch: $('settBankBranch')?.value || ''
      };
      await saveCompanySettings(payload);
      applyCompanyBrandingToUI();
      toast('✓ Business Settings saved & synchronized system-wide!', 'success');
      $('settingsDialog').close();
    } catch (err) {
      console.error('Settings save error:', err);
      toast('Failed to save settings: ' + err.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Report Generator Handler
  $('runReportBtn')?.addEventListener('click', async () => {
    const btn = $('runReportBtn');
    const fromDate = $('repFromDate').value;
    const toDate = $('repToDate').value;
    const type = $('repTypeSelect').value;
    const area = $('reportOutputArea');

    setButtonLoading(btn, true, 'Generating Report...');
    try {
      if (type === 'sales') {
        const rep = await getSalesReport(fromDate, toDate);
        area.innerHTML = `
          <h3>Sales & Transaction Report (${rep.totalInvoices} Invoices / Bills)</h3>
          <div class="kpi-grid" style="margin-bottom:15px;">
            <div class="kpi-card"><span>GST Sales</span><strong>${money(rep.gstSales)}</strong></div>
            <div class="kpi-card"><span>Non-GST Sales</span><strong>${money(rep.nonGstSales)}</strong></div>
            <div class="kpi-card"><span>Total Sales</span><strong>${money(rep.totalSales)}</strong></div>
            <div class="kpi-card"><span>Total Taxable</span><strong>${money(rep.totalTaxable)}</strong></div>
            <div class="kpi-card"><span>GST Collected</span><strong>${money(rep.totalGst)}</strong></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Invoice #</th><th>Date</th><th>Type</th><th>Customer</th><th>Taxable ₹</th><th>GST ₹</th><th>Total ₹</th></tr></thead>
              <tbody>
                ${rep.invoices.map(i => {
                  const iType = (i.invoiceType || 'GST').toUpperCase();
                  return `<tr>
                    <td>${esc(i.invoiceNumber)}</td>
                    <td>${formatDate(i.invoiceDate)}</td>
                    <td><span class="badge ${iType === 'NON_GST' ? 'warning' : 'success'}">${iType === 'NON_GST' ? 'Non-GST' : 'GST'}</span></td>
                    <td>${esc(i.customerName)}</td>
                    <td>${money(i.taxableValue ?? i.totals?.totalTaxable)}</td>
                    <td>${money(i.totals?.totalGst || 0)}</td>
                    <td><strong>${money(i.grandTotal ?? i.totals?.grandTotal)}</strong></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else if (type === 'profit') {
        const rep = await getProfitAndMarginReport(fromDate, toDate);
        area.innerHTML = `
          <h3>Profit & Margin Analysis</h3>
          <div class="kpi-grid">
            <div class="kpi-card"><span>Total Revenue</span><strong>${money(rep.revenue)}</strong></div>
            <div class="kpi-card"><span>Purchase Cost</span><strong>${money(rep.directPurchaseCost)}</strong></div>
            <div class="kpi-card"><span>Operating Expenses</span><strong>${money(rep.totalExpenses)}</strong></div>
            <div class="kpi-card"><span>Net Profit</span><strong style="color:${rep.netProfit >= 0 ? '#10b981' : '#d32f2f'}">${money(rep.netProfit)}</strong></div>
            <div class="kpi-card"><span>Net Profit Margin</span><strong>${rep.marginPct}%</strong></div>
          </div>
        `;
      } else if (type === 'gst') {
        const rep = await getGSTReport(fromDate, toDate);
        if (rep) {
          area.innerHTML = `
            <h3>Statutory GST Returns Summary (Applicable GST Invoices Only)</h3>
            <div class="notice" style="margin-bottom:15px;background:#e8f5e9;border-color:#81c784;color:#1b5e20;">
              Includes <strong>${rep.gstInvoices ? rep.gstInvoices.length : 0} GST Transactions</strong>. Non-GST Bills are excluded from tax return calculations.
            </div>
            <div class="kpi-grid" style="margin-bottom:15px;">
              <div class="kpi-card"><span>GST Sales Volume</span><strong>${money(rep.totalGstSales)}</strong></div>
              <div class="kpi-card"><span>GST Taxable Value</span><strong>${money(rep.totalGstTaxable)}</strong></div>
              <div class="kpi-card"><span>Total Output Tax</span><strong>${money(rep.outputTax.total)}</strong></div>
              <div class="kpi-card"><span>Total Input Tax Credit</span><strong>${money(rep.inputTax.total)}</strong></div>
            </div>
            <div class="grid2">
              <div class="panel">
                <h4>Output Tax Collected (GST Sales)</h4>
                <p>Output CGST: <strong>${money(rep.outputTax.cgst)}</strong></p>
                <p>Output SGST: <strong>${money(rep.outputTax.sgst)}</strong></p>
                <p>Output IGST: <strong>${money(rep.outputTax.igst)}</strong></p>
                <p>Total Output Tax: <strong>${money(rep.outputTax.total)}</strong></p>
              </div>
              <div class="panel">
                <h4>Input Tax Credit (Purchases)</h4>
                <p>Input CGST: <strong>${money(rep.inputTax.cgst)}</strong></p>
                <p>Input SGST: <strong>${money(rep.inputTax.sgst)}</strong></p>
                <p>Input IGST: <strong>${money(rep.inputTax.igst)}</strong></p>
                <p>Total Input Tax: <strong>${money(rep.inputTax.total)}</strong></p>
              </div>
            </div>
            <div class="notice" style="margin-top:15px;font-size:16px;">
              Net GST Liability Payable: <strong style="font-size:20px;color:#24527A;">${money(rep.netTaxPayable)}</strong>
            </div>
          `;
        }
      } else if (type === 'purchases') {
        const rep = await getPurchaseReport(fromDate, toDate);
        area.innerHTML = `
          <h3>Purchase History & Supplier Taxable Summary (${rep.totalPurchases} Purchases)</h3>
          <div class="kpi-grid" style="margin-bottom:15px;">
            <div class="kpi-card"><span>Total Purchase Cost</span><strong>${money(rep.totalCost)}</strong></div>
            <div class="kpi-card"><span>Taxable Purchase Value</span><strong>${money(rep.totalTaxable)}</strong></div>
            <div class="kpi-card"><span>Input GST (ITC)</span><strong>${money(rep.totalGst)}</strong></div>
            <div class="kpi-card"><span>Total Transactions</span><strong>${rep.totalPurchases}</strong></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Purchase #</th><th>Date</th><th>Supplier Name</th><th>Supplier Invoice #</th><th>Taxable ₹</th><th>GST ₹</th><th>Total ₹</th></tr></thead>
              <tbody>
                ${rep.purchases.length > 0 ? rep.purchases.map(p => `
                  <tr>
                    <td><strong>${esc(p.purchaseNumber)}</strong></td>
                    <td>${formatDate(p.purchaseDate)}</td>
                    <td>${esc(p.supplierName)}</td>
                    <td>${esc(p.supplierInvoiceNo || '—')}</td>
                    <td>${money(p.totals?.totalTaxable || 0)}</td>
                    <td>${money(p.totals?.totalGst || 0)}</td>
                    <td><strong>${money(p.totals?.grandTotal || 0)}</strong></td>
                  </tr>
                `).join('') : '<tr><td colspan="7" class="empty">No purchase records found in selected date range.</td></tr>'}
              </tbody>
            </table>
          </div>
        `;
      } else if (type === 'fastMoving') {
        const rep = await getProductPerformanceReport(fromDate, toDate);
        area.innerHTML = `
          <h3>Fast & Slow Moving Products Analysis</h3>
          <div class="grid2" style="margin-top:15px;">
            <div class="panel">
              <h4 style="color:#15803d;margin-top:0;">🔥 Top Fast Moving Products (High Demand)</h4>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Product Name</th><th>Qty Sold</th><th>Revenue ₹</th></tr></thead>
                  <tbody>
                    ${rep.fastMoving.length > 0 ? rep.fastMoving.map(p => `
                      <tr>
                        <td><strong>${esc(p.productName)}</strong></td>
                        <td><span class="badge success">${p.qtySold} ${esc(p.unit)}</span></td>
                        <td><strong>${money(p.revenue)}</strong></td>
                      </tr>
                    `).join('') : '<tr><td colspan="3" class="empty">No sales recorded in period.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="panel">
              <h4 style="color:#b91c1c;margin-top:0;">❄️ Slow Moving Products (Low Turnover)</h4>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Product Name</th><th>Qty Sold</th><th>Revenue ₹</th></tr></thead>
                  <tbody>
                    ${rep.slowMoving.length > 0 ? rep.slowMoving.map(p => `
                      <tr>
                        <td><strong>${esc(p.productName)}</strong></td>
                        <td><span class="badge warning">${p.qtySold} ${esc(p.unit)}</span></td>
                        <td><strong>${money(p.revenue)}</strong></td>
                      </tr>
                    `).join('') : '<tr><td colspan="3" class="empty">No sales recorded in period.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Excel Export Handler
  $('exportExcelBtn')?.addEventListener('click', async () => {
    const btn = $('exportExcelBtn');
    const fromDate = $('repFromDate').value;
    const toDate = $('repToDate').value;
    const type = $('repTypeSelect').value;

    setButtonLoading(btn, true, 'Preparing Excel...');
    try {
      if (type === 'purchases') {
        const rep = await getPurchaseReport(fromDate, toDate);
        const rows = rep.purchases.map(p => ({
          'Purchase Number': p.purchaseNumber,
          'Purchase Date': formatDate(p.purchaseDate),
          'Supplier Name': p.supplierName,
          'Supplier Invoice No': p.supplierInvoiceNo || '—',
          'Taxable Value': (p.totals?.totalTaxable) || 0,
          'CGST Amount': (p.totals?.totalCgst) || 0,
          'SGST Amount': (p.totals?.totalSgst) || 0,
          'IGST Amount': (p.totals?.totalIgst) || 0,
          'Grand Total': (p.totals?.grandTotal) || 0
        }));
        await exportToExcel(rows, 'Purchase_Register_Report', 'Purchase Register', companySettings);
      } else if (type === 'fastMoving') {
        const rep = await getProductPerformanceReport(fromDate, toDate);
        const rows = rep.allProducts.map(p => ({
          'Product Name': p.productName,
          'HSN Code': p.hsn,
          'Unit': p.unit,
          'Total Quantity Sold': p.qtySold,
          'Total Revenue Generated (₹)': p.revenue
        }));
        await exportToExcel(rows, 'Product_Performance_Report', 'Fast & Slow Moving Products', companySettings);
      } else if (type === 'profit') {
        const rep = await getProfitAndMarginReport(fromDate, toDate);
        const rows = [{
          'Total Revenue (₹)': rep.revenue,
          'Direct Purchase Cost (₹)': rep.directPurchaseCost,
          'Operating Expenses (₹)': rep.totalExpenses,
          'Net Profit (₹)': rep.netProfit,
          'Profit Margin (%)': rep.marginPct
        }];
        await exportToExcel(rows, 'Profit_Margin_Report', 'Profit & Margin Statement', companySettings);
      } else if (type === 'gst') {
        const rep = await getGSTReport(fromDate, toDate);
        const rows = [{
          'GST Sales Volume (₹)': rep.totalGstSales,
          'GST Taxable Value (₹)': rep.totalGstTaxable,
          'Output CGST (₹)': rep.outputTax.cgst,
          'Output SGST (₹)': rep.outputTax.sgst,
          'Output IGST (₹)': rep.outputTax.igst,
          'Total Output Tax (₹)': rep.outputTax.total,
          'Input CGST (₹)': rep.inputTax.cgst,
          'Input SGST (₹)': rep.inputTax.sgst,
          'Input IGST (₹)': rep.inputTax.igst,
          'Total Input Tax (ITC) (₹)': rep.inputTax.total,
          'Net GST Payable (₹)': rep.netTaxPayable
        }];
        await exportToExcel(rows, 'GST_Tax_Report', 'GST Return Summary', companySettings);
      } else {
        const rep = await getSalesReport(fromDate, toDate);
        const rows = rep.invoices.map(i => ({
          'Invoice Number': i.invoiceNumber,
          'Invoice Date': formatDate(i.invoiceDate),
          'Invoice Type': (i.invoiceType || 'GST').toUpperCase() === 'NON_GST' ? 'Non-GST Bill' : 'GST Invoice',
          'Customer Name': i.customerName,
          'Customer GSTIN': i.customerGstin || i.customerGSTIN || 'Unregistered / Non-GST',
          'Taxable Value': (i.taxableValue ?? i.totals?.totalTaxable) || 0,
          'CGST Amount': (i.cgst ?? i.totals?.totalCgst) || 0,
          'SGST Amount': (i.sgst ?? i.totals?.totalSgst) || 0,
          'IGST Amount': (i.igst ?? i.totals?.totalIgst) || 0,
          'Grand Total': (i.grandTotal ?? i.totals?.grandTotal) || 0,
          'Payment Mode': i.paymentMode
        }));
        await exportToExcel(rows, 'Sales_Bill_Register', 'Sales & Bill Register', companySettings);
      }
      toast('✓ Excel file generated and ready for download!', 'success');
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

function renderPurchaseItemsTable() {
  const container = $('purItemsTable');
  if (!container) return;
  container.innerHTML = purchaseItems.map((item, idx) => `
    <tr>
      <td>${esc(item.productName)}</td>
      <td>${item.qty} ${esc(item.unit)}</td>
      <td>${money(item.rate)}</td>
      <td>${item.gstRate}%</td>
      <td>${money(item.qty * item.rate)}</td>
      <td><strong>${money((item.qty * item.rate) * (1 + item.gstRate / 100))}</strong></td>
      <td><button type="button" class="remove" onclick="removePurItem(${idx})">×</button></td>
    </tr>
  `).join('');
}

window.removePurItem = (idx) => {
  purchaseItems.splice(idx, 1);
  renderPurchaseItemsTable();
};

function renderPrintPreview() {
  const container = $('receipt');
  const paper = $('paper')?.value || 'a4';
  if (container && activePreviewDoc) {
    container.innerHTML = generatePrintHTML(activePreviewDoc, paper);
  }
}

/**
 * Barcode Scanner & Quick Billing Engine
 */
function selectUnifiedProduct(prod) {
  if (!prod) return;
  activeScannedProduct = prod;
  const searchInput = $('productSearch') || $('barcodeInput');
  const statusArea = $('productStatusArea') || $('barcodeStatusArea');
  const qtyInput = $('productQty') || $('barcodeQty');

  if (searchInput) searchInput.value = prod.productName;
  if ($('productSearchResults')) $('productSearchResults').hidden = true;

  if (statusArea) {
    statusArea.style.display = 'block';
    statusArea.innerHTML = `
      <div class="selected-product-badge">
        <div>
          <strong style="color:#15803d; font-size:15px;">✓ Selected: ${esc(prod.productName)}</strong>
          <div style="font-size:13px; color:#4b5563; margin-top:2px;">
            Barcode: <code>${esc(prod.barcode || '—')}</code> | Stock: <strong>${prod.currentStock || 0} ${esc(prod.unit || '')}</strong> | Rate: <strong>${money(prod.sellingRate || 0)} / ${esc(prod.unit || 'KG')}</strong> | GST: <strong>${prod.gstRate || 0}%</strong>
          </div>
        </div>
        <div>
          <span class="badge success" style="font-size:12px;">Ready for Qty</span>
        </div>
      </div>
    `;
  }

  if (qtyInput) {
    qtyInput.focus();
    qtyInput.select();
  }
}

async function handleUnifiedProductSearchOrScan() {
  if (isProcessingScan) return;
  const searchInput = $('productSearch') || $('barcodeInput');
  const qtyInput = $('productQty') || $('barcodeQty');
  const statusArea = $('productStatusArea') || $('barcodeStatusArea');

  if (activeScannedProduct) {
    if (qtyInput) {
      qtyInput.focus();
      qtyInput.select();
    }
    return;
  }

  const rawVal = searchInput?.value?.trim() || '';
  if (!rawVal) {
    toast('Please scan barcode or search product name.', 'warning');
    if (statusArea) statusArea.style.display = 'none';
    return;
  }

  isProcessingScan = true;
  if (statusArea) {
    statusArea.style.display = 'block';
    statusArea.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:10px 14px; color:#166534; font-weight:600; display:flex; align-items:center; gap:8px;">
        <span>⏳ Finding product for <code>"${esc(rawVal)}"</code>...</span>
      </div>
    `;
  }

  try {
    const normVal = normalizeBarcode(rawVal);
    let prod = Array.isArray(productsList) ? productsList.find(p => 
      (p.barcode && normalizeBarcode(p.barcode) === normVal) ||
      (p.productName && p.productName.toLowerCase() === rawVal.toLowerCase()) ||
      (p.hsnCode && p.hsnCode === rawVal)
    ) : null;

    if (!prod && normVal) {
      prod = await findProductByBarcodeRemote(normVal);
    }

    if (!prod && rawVal.length >= 2) {
      const remoteMatches = await searchProductsRemote(rawVal);
      if (remoteMatches && remoteMatches.length === 1) {
        prod = remoteMatches[0];
      }
    }

    if (prod) {
      selectUnifiedProduct(prod);
      toast(`✓ Product "${prod.productName}" found!`);
    } else {
      activeScannedProduct = null;
      if (statusArea) {
        statusArea.innerHTML = `
          <div class="unknown-product-alert">
            <div>
              <strong style="color:#9f1239; font-size:14px;">⚠️ Product Not Found</strong>
              <div style="font-size:13px; color:#be123c; margin-top:2px;">
                No registered product matches <code>"${esc(rawVal)}"</code>
              </div>
            </div>
            <button type="button" id="createProductFromSearchBtn" class="primary small-btn" style="background:#e11d48; border-color:#e11d48; color:#ffffff; font-weight:600; cursor:pointer;">＋ Create New Product</button>
          </div>
        `;
        setTimeout(() => {
          $('createProductFromSearchBtn')?.addEventListener('click', () => {
            openProductModalWithBarcode(normVal || rawVal);
          });
        }, 0);
      }
      toast(`Product not found for: ${rawVal}`, 'warning');
    }
  } catch (err) {
    console.error('Unified product search error:', err);
    if (statusArea) {
      statusArea.innerHTML = `<div style="color:#d32f2f; font-weight:600;">❌ Connection error searching product. Please try again.</div>`;
    }
  } finally {
    isProcessingScan = false;
  }
}

async function handleBarcodeScanned() {
  return handleUnifiedProductSearchOrScan();
}

function addUnifiedProductToCart() {
  const searchInput = $('productSearch') || $('barcodeInput');
  const qtyInput = $('productQty') || $('barcodeQty');
  const statusArea = $('productStatusArea') || $('barcodeStatusArea');

  const prod = activeScannedProduct || getSelectedPickerProduct();
  if (!prod) {
    const rawVal = searchInput?.value?.trim() || '';
    if (rawVal) {
      handleUnifiedProductSearchOrScan().then(() => {
        if (activeScannedProduct) addUnifiedProductToCart();
      });
      return;
    }
    toast('No product selected or scanned. Please scan or select a product.', 'warning');
    searchInput?.focus();
    return;
  }

  const reqQty = Number(qtyInput?.value) || 1;
  if (reqQty <= 0) {
    toast('Quantity must be greater than zero.', 'warning');
    return;
  }

  // PREVENT SALE OF EXPIRED PRODUCTS
  if (prod.expiryDate) {
    const expInfo = getExpiryInfo(prod.expiryDate);
    if (expInfo.isExpired) {
      toast(`❌ CANNOT SELL EXPIRED PRODUCT: "${prod.productName}" expired on ${prod.expiryDate}.`, 'error');
      if (statusArea) {
        statusArea.style.display = 'block';
        statusArea.innerHTML = `
          <div style="background:#fef2f2; border:1.5px solid #fca5a5; border-radius:8px; padding:12px 16px; color:#9f1239; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:14px; font-weight:700;">❌ CANNOT SELL EXPIRED PRODUCT</div>
              <div style="font-size:12.5px; color:#be123c; margin-top:2px;">
                Product <strong>"${esc(prod.productName)}"</strong> expired on <strong>${esc(prod.expiryDate)}</strong>. Sale is prevented by system.
              </div>
            </div>
            <span class="badge danger" style="padding:4px 8px;">EXPIRED</span>
          </div>
        `;
      }
      return;
    } else if (expInfo.isAlert) {
      toast(`⚠️ ${expInfo.alertText} for "${prod.productName}"`, 'warning');
    }
  }

  const unitUpper = (prod.unit || 'KG').toUpperCase();
  if (['PACKET', 'BOX', 'PIECE', 'BOTTLE'].includes(unitUpper) && reqQty % 1 !== 0) {
    toast(`Product unit "${unitUpper}" requires whole integer quantity.`, 'warning');
    return;
  }

  // MERGE QUANTITY IF ALREADY IN CART (Requirement #6)
  const existingIdx = invoiceItems.findIndex(i => (i.productId === prod.id) || (i.barcode && prod.barcode && i.barcode === prod.barcode));
  const currentCartQty = existingIdx !== -1 ? (invoiceItems[existingIdx].qty || 0) : 0;
  const newTotalQty = currentCartQty + reqQty;

  const availStock = Number(prod.currentStock) || 0;
  if (!companySettings.allowNegativeStock && newTotalQty > availStock) {
    toast(`⚠️ Insufficient stock! Available: ${availStock} ${prod.unit || ''}, Requested total: ${newTotalQty} ${prod.unit || ''}`, 'warning');
    return;
  }

  if (existingIdx !== -1) {
    invoiceItems[existingIdx].qty = newTotalQty;
    toast(`✓ Updated quantity for "${prod.productName}" (Total: ${newTotalQty} ${prod.unit || ''})`);
  } else {
    invoiceItems.push({
      productId: prod.id,
      productName: prod.productName,
      barcode: prod.barcode || '',
      hsn: prod.hsnCode || '',
      unit: prod.unit || 'KG',
      qty: reqQty,
      rate: prod.sellingRate || 0,
      gstRate: prod.gstRate || 5,
      discount: 0
    });
    toast(`✓ Added "${prod.productName}" to cart.`);
  }

  renderInvoiceItems();

  if (searchInput) searchInput.value = '';
  if (qtyInput) qtyInput.value = '1';
  if (statusArea) statusArea.style.display = 'none';
  if ($('productSearchResults')) $('productSearchResults').hidden = true;
  activeScannedProduct = null;

  // Auto-focus search input for continuous scanning (Requirement #13)
  setTimeout(() => {
    searchInput?.focus();
  }, 50);
}

function addScannedProductToCart() {
  return addUnifiedProductToCart();
}

function getSelectedPickerProduct() {
  const selVal = $('productSelect')?.value;
  if (selVal && Array.isArray(productsList)) {
    return productsList.find(p => p.id === selVal);
  }
  return null;
}

function openProductModalWithBarcode(barcode) {
  openProductModal({ barcode: barcode }, 'CREATE');
}

function openProductModal(prodData = {}, mode = 'CREATE') {
  if (!$('productDialog')) return;
  $('productForm').reset();
  if ($('productModalTitle')) $('productModalTitle').textContent = mode === 'EDIT' ? 'Edit Product' : 'Add New Product';
  if ($('prodId')) $('prodId').value = prodData.id || '';
  if ($('prodName')) $('prodName').value = prodData.productName || '';
  if ($('prodBarcode')) $('prodBarcode').value = prodData.barcode || '';

  const allowed = getAccessCategories();
  const catSelect = $('prodCategory');
  if (catSelect) {
    catSelect.innerHTML = '';
    if (allowed.includes('bio')) {
      catSelect.appendChild(new Option('Bio', 'bio'));
    }
    if (allowed.includes('nithish')) {
      catSelect.appendChild(new Option('Nithish', 'nithish'));
    }
    if (allowed.includes('chemical')) {
      catSelect.appendChild(new Option('Chemical', 'chemical'));
    }
    if (allowed.includes('micro_nutrients')) {
      catSelect.appendChild(new Option('Micro Nutrients', 'micro_nutrients'));
    }
    const currentCat = (prodData.category || allowed[0]).toLowerCase();
    catSelect.value = allowed.includes(currentCat) ? currentCat : allowed[0];
  }

  if ($('prodHsn')) $('prodHsn').value = prodData.hsnCode || '';
  if ($('prodUnit')) $('prodUnit').value = prodData.unit || 'KG';
  if ($('prodPurchaseRate')) $('prodPurchaseRate').value = prodData.purchaseRate || 0;
  if ($('prodSellingRate')) $('prodSellingRate').value = prodData.sellingRate || 0;
  if ($('prodGstRate')) $('prodGstRate').value = prodData.gstRate || 5;
  if ($('prodOpeningStock')) $('prodOpeningStock').value = prodData.openingStock || 50;
  if ($('prodMinStock')) $('prodMinStock').value = prodData.minimumStock || 10;
  if ($('prodExpiryDate')) $('prodExpiryDate').value = prodData.expiryDate || '';
  $('productDialog').showModal();
}

async function startCameraScan() {
  const dialog = $('cameraScanDialog');
  const video = $('cameraScanVideo');
  const status = $('cameraScanStatus');
  if (!dialog || !video) return;

  dialog.showModal();

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (status) status.textContent = 'Camera not supported in this browser. Please use physical scanner.';
      return;
    }

    cameraMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = cameraMediaStream;

    if (status) status.textContent = 'Camera active. Align product barcode inside camera view...';

    if ('BarcodeDetector' in window) {
      const barcodeDetector = new window.BarcodeDetector();
      const detectLoop = async () => {
        if (!cameraMediaStream || dialog.open === false) return;
        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes.length > 0) {
            const rawVal = barcodes[0].rawValue;
            stopCameraScan();
            const searchInput = $('productSearch') || $('barcodeInput');
            if (searchInput) searchInput.value = rawVal;
            handleUnifiedProductSearchOrScan();
            return;
          }
        } catch (e) {}
        if (dialog.open) requestAnimationFrame(detectLoop);
      };
      requestAnimationFrame(detectLoop);
    }
  } catch (err) {
    console.error('Camera access error:', err);
    if (status) status.textContent = 'Camera permission denied or device camera unavailable.';
  }
}

function stopCameraScan() {
  if (cameraMediaStream) {
    cameraMediaStream.getTracks().forEach(track => track.stop());
    cameraMediaStream = null;
  }
  const dialog = $('cameraScanDialog');
  if (dialog && dialog.open) dialog.close();
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      stopCameraScan();
      return;
    }

    const activeEl = document.activeElement;
    const isInsideDialog = activeEl && activeEl.closest('dialog');

    if (e.key === 'F2') {
      e.preventDefault();
      navigate('billing');
      setTimeout(() => ($('productSearch') || $('barcodeInput'))?.focus(), 50);
    } else if (e.key === 'F4') {
      e.preventDefault();
      navigate('billing');
      setTimeout(() => $('customer')?.focus(), 50);
    } else if (e.key === 'F8') {
      e.preventDefault();
      navigate('billing');
      setTimeout(() => $('payment')?.focus(), 50);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (activePage === 'billing' && !isInsideDialog) {
        e.preventDefault();
        $('saveBtn')?.click();
      }
    }
  });
}

window.openProductModal = openProductModal;
window.openCustomerModal = openCustomerModal;
window.openSupplierModal = openSupplierModal;

/**
 * Live Searchable Product Autocomplete Engine
 */
function attachProductAutocomplete({ inputEl, selectEl, onSelect }) {
  if (!inputEl) return;

  let wrapper = inputEl.closest('.autocomplete-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-wrapper';
    inputEl.parentNode.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputEl);
  }

  let dropdown = wrapper.querySelector('.autocomplete-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    wrapper.appendChild(dropdown);
  }

  let activeIndex = -1;

  async function renderMatches(term) {
    const cleanTerm = (term || '').trim().toLowerCase();
    if (!cleanTerm) {
      dropdown.style.display = 'none';
      return;
    }

    let matches = (productsList || []).filter(p => {
      const name = (p.productName || '').toLowerCase();
      const code = (p.barcode || p.sku || '').toLowerCase();
      const hsn = (p.hsnCode || '').toLowerCase();
      return name.includes(cleanTerm) || code.includes(cleanTerm) || hsn.includes(cleanTerm);
    }).slice(0, 15);

    if (matches.length === 0 && typeof searchProductsRemote === 'function') {
      try {
        matches = await searchProductsRemote(cleanTerm);
      } catch (e) {
        console.warn('Remote product autocomplete search error:', e);
      }
    }

    if (!matches || matches.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;color:#888;font-size:13px;text-align:center;">No matching products found.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map((p, idx) => `
      <div class="autocomplete-item ${idx === activeIndex ? 'active' : ''}" data-id="${p.id}">
        <div class="autocomplete-item-main">
          <span class="autocomplete-item-title">${esc(p.productName)}</span>
          ${p.barcode ? `<span class="autocomplete-item-code">Code: ${esc(p.barcode)}</span>` : (p.hsnCode ? `<span class="autocomplete-item-code">HSN: ${esc(p.hsnCode)}</span>` : '')}
        </div>
        <div class="autocomplete-item-right">
          <div class="autocomplete-item-stock">Stock: ${p.currentStock || 0} ${esc(p.unit || 'KG')}</div>
          <div class="autocomplete-item-price">₹${p.sellingRate || p.purchaseRate || 0}</div>
        </div>
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.autocomplete-item').forEach((itemEl) => {
      itemEl.addEventListener('click', () => {
        const prodId = itemEl.dataset.id;
        const prod = matches.find(p => p.id === prodId) || (productsList || []).find(p => p.id === prodId);
        if (prod) {
          selectProduct(prod);
        }
      });
    });
  }

  function selectProduct(prod) {
    inputEl.value = prod.productName;
    if (selectEl) selectEl.value = prod.id;
    dropdown.style.display = 'none';
    if (typeof onSelect === 'function') {
      onSelect(prod);
    }
  }

  inputEl.addEventListener('input', (e) => {
    activeIndex = -1;
    renderMatches(e.target.value);
  });

  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim()) {
      renderMatches(inputEl.value);
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length || dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActive(items);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        items[activeIndex].click();
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  function updateActive(items) {
    items.forEach((item, idx) => {
      if (idx === activeIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function setupProductAutocompletes() {
  // 1. Purchase Entry Autocomplete
  if ($('purProductSearch')) {
    attachProductAutocomplete({
      inputEl: $('purProductSearch'),
      selectEl: $('purProductSelect'),
      onSelect: (prod) => {
        if ($('purRate')) $('purRate').value = prod.purchaseRate || 0;
        if ($('purGst')) $('purGst').value = prod.gstRate || 5;
        if ($('purQty')) {
          $('purQty').focus();
          $('purQty').select();
        }
      }
    });
  }

  // 2. Billing Desk Manual Autocomplete
  if ($('productSearchInput')) {
    attachProductAutocomplete({
      inputEl: $('productSearchInput'),
      selectEl: $('productSelect'),
      onSelect: (prod) => {
        selectUnifiedProduct(prod);
      }
    });
  }

  // 3. Sales Return Autocomplete
  if ($('srProductSearch')) {
    attachProductAutocomplete({
      inputEl: $('srProductSearch'),
      selectEl: $('srProductSelect'),
      onSelect: (prod) => {
        if ($('srRate')) $('srRate').value = prod.sellingRate || prod.purchaseRate || 0;
        if ($('srGst')) $('srGst').value = prod.gstRate || 5;
        if ($('srQty')) $('srQty').focus();
      }
    });
  }

  // 4. Purchase Return Autocomplete
  if ($('prProductSearch')) {
    attachProductAutocomplete({
      inputEl: $('prProductSearch'),
      selectEl: $('prProductSelect'),
      onSelect: (prod) => {
        if ($('prRate')) $('prRate').value = prod.purchaseRate || 0;
        if ($('prGst')) $('prGst').value = prod.gstRate || 5;
        if ($('prQty')) $('prQty').focus();
      }
    });
  }

  // 5. Stock Adjustment Autocomplete
  if ($('adjProductSearch')) {
    attachProductAutocomplete({
      inputEl: $('adjProductSearch'),
      selectEl: $('adjProdSelect'),
      onSelect: (prod) => {
        if ($('adjQty')) $('adjQty').focus();
      }
    });
  }
}

/**
 * Real-Time Low Stock, Expiry & Overdue Payment Notification Engine
 */
async function evaluateLowStockAlerts() {
  if (!Array.isArray(productsList)) return;

  const lowStockItems = productsList.filter(p => (p.currentStock || 0) <= (p.minimumStock || 0));
  
  // Expiry alerts evaluation (&le;60 days & expired)
  const expiringItems = productsList.filter(p => {
    if (!p.expiryDate) return false;
    const expInfo = getExpiryInfo(p.expiryDate);
    return expInfo.isAlert;
  }).map(p => ({ product: p, expInfo: getExpiryInfo(p.expiryDate) }));

  expiringItems.sort((a, b) => (a.expInfo.daysRemaining ?? 999) - (b.expInfo.daysRemaining ?? 999));

  // Overdue Payment Alerts evaluation (&gt;30d Sales / &gt;75d Purchase)
  let overdueItems = [];
  try {
    const invRes = await fetchInvoicesPage(100);
    const purRes = await fetchPurchasesPage(100);

    (invRes?.invoices || []).forEach(inv => {
      if (inv.status === 'CANCELLED') return;
      const payStatus = getPaymentStatusInfo(inv, 'sales');
      if (payStatus.isOverdue) {
        const grand = Number(inv.grandTotal ?? inv.totals?.grandTotal) || 0;
        overdueItems.push({
          docType: 'sales',
          docNo: inv.invoiceNumber,
          date: inv.invoiceDate || todayStr(),
          partyName: inv.customerName || 'Walk-in Customer',
          grandTotal: grand,
          balanceAmount: inv.balanceAmount ?? (grand - (inv.advanceAmount || 0)),
          payStatus
        });
      }
    });

    (purRes?.purchases || []).forEach(pur => {
      const payStatus = getPaymentStatusInfo(pur, 'purchase');
      if (payStatus.isOverdue) {
        const grand = Number(pur.totals?.grandTotal) || 0;
        overdueItems.push({
          docType: 'purchase',
          docNo: pur.purchaseNumber,
          date: pur.purchaseDate || todayStr(),
          partyName: pur.supplierName || 'Unknown Supplier',
          grandTotal: grand,
          balanceAmount: pur.balanceAmount ?? (grand - (pur.advanceAmount || 0)),
          payStatus
        });
      }
    });

    overdueItems.sort((a, b) => (b.payStatus.pendingDays || 0) - (a.payStatus.pendingDays || 0));
  } catch (err) {
    console.warn('Error fetching overdue payments for alerts modal:', err);
  }

  const totalCount = lowStockItems.length + expiringItems.length + overdueItems.length;

  const badge = $('lowStockBadge');
  if (badge) {
    badge.textContent = totalCount;
    badge.hidden = (totalCount === 0);
  }

  // Populate Overdue Payment Alerts Table in Notification Modal
  const overdueContainer = $('overdueAlertModalRows');
  if (overdueContainer) {
    if (overdueItems.length === 0) {
      overdueContainer.innerHTML = `<tr><td colspan="7" class="text-center muted" style="padding:15px;">✓ No overdue advance payments found. All accounts are up-to-date!</td></tr>`;
    } else {
      overdueContainer.innerHTML = overdueItems.map(item => `
        <tr>
          <td><span class="badge ${item.docType === 'sales' ? 'warning' : 'muted'}" style="font-size:11px;">${item.docType === 'sales' ? 'SALES' : 'PURCHASE'}</span></td>
          <td><strong>${esc(item.docNo)}</strong></td>
          <td>${formatDate(item.date)}</td>
          <td>${esc(item.partyName)}</td>
          <td><strong>${money(item.grandTotal)}</strong></td>
          <td><strong style="color:#b91c1c;">${money(item.balanceAmount)}</strong></td>
          <td><span class="badge danger">${esc(item.payStatus.statusText)}</span></td>
        </tr>
      `).join('');
    }
  }

  // Populate Expiry Alerts Table in Notification Modal
  const expContainer = $('expiryAlertModalRows');
  if (expContainer) {
    if (expiringItems.length === 0) {
      expContainer.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding:15px;">✓ No products expiring within 60 days. All product stocks are fresh!</td></tr>`;
    } else {
      expContainer.innerHTML = expiringItems.map(({ product: p, expInfo }) => `
        <tr>
          <td><strong>${esc(p.productName)}</strong></td>
          <td><code style="font-size:12px;background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;">${esc(p.barcode || '—')}</code></td>
          <td><strong>${esc(p.expiryDate)}</strong></td>
          <td><strong>${expInfo.daysRemaining <= 0 ? 'Expired' : `${expInfo.daysRemaining} Days`}</strong></td>
          <td><span class="badge ${expInfo.badgeClass}">${esc(expInfo.label)}</span></td>
          <td>
            <button class="small-btn edit-prod-btn" data-id="${p.id}" onclick="if($('lowStockDialog'))$('lowStockDialog').close();openProductModal(productsList.find(x=>x.id==='${p.id}'),'EDIT');">
              ✏️ Edit Product
            </button>
          </td>
        </tr>
      `).join('');
    }
  }

  // Populate Low Stock Alerts Table in Notification Modal
  const container = $('lowStockAlertRows');
  if (container) {
    if (lowStockItems.length === 0) {
      container.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding:15px;">✓ All products have healthy stock levels above minimum thresholds!</td></tr>`;
    } else {
      container.innerHTML = lowStockItems.map(p => {
        const isOutOfStock = (p.currentStock || 0) <= 0;
        return `
          <tr>
            <td><strong>${esc(p.productName)}</strong></td>
            <td><code style="font-size:12px;background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;">${esc(p.barcode || '—')}</code></td>
            <td><strong style="color:${isOutOfStock ? '#d32f2f' : '#b88617'};">${p.currentStock || 0} ${esc(p.unit || '')}</strong></td>
            <td>${p.minimumStock || 0} ${esc(p.unit || '')}</td>
            <td><span class="badge ${isOutOfStock ? 'danger' : 'warning'}">${isOutOfStock ? 'OUT OF STOCK' : 'LOW STOCK'}</span></td>
            <td>
              <button class="small-btn primary restock-item-btn" data-id="${p.id}">
                ＋ Adjust / Restock
              </button>
            </td>
          </tr>
        `;
      }).join('');

      container.querySelectorAll('.restock-item-btn').forEach(b => {
        b.addEventListener('click', () => {
          const pId = b.dataset.id;
          if ($('lowStockDialog')) $('lowStockDialog').close();
          if ($('adjProdSelect')) $('adjProdSelect').value = pId;
          if ($('adjProductSearch')) {
            const prod = productsList.find(p => p.id === pId);
            if (prod) $('adjProductSearch').value = prod.productName;
          }
          if ($('restockDialog')) $('restockDialog').showModal();
        });
      });
    }
  }
}
