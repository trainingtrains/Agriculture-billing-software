/**
 * Akshara Spices Trades - In-Memory Session Cache Module
 * Provides fast session caching for static/master data while Firestore remains source of truth.
 */

export const appCache = {
  companySettings: null,
  productsMap: new Map(),
  customersMap: new Map(),
  suppliersMap: new Map(),
  lastDashboardSummary: null
};

export function getCachedCompanySettings() {
  return appCache.companySettings;
}

export function setCachedCompanySettings(settings) {
  appCache.companySettings = settings;
}

export function getCachedCustomer(id) {
  return appCache.customersMap.get(id) || null;
}

export function cacheCustomer(customer) {
  if (customer && customer.id) {
    appCache.customersMap.set(customer.id, customer);
  }
}

export function cacheCustomersList(customersList) {
  if (Array.isArray(customersList)) {
    customersList.forEach(c => cacheCustomer(c));
  }
}

export function getCachedProduct(id) {
  return appCache.productsMap.get(id) || null;
}

export function cacheProduct(product) {
  if (product && product.id) {
    appCache.productsMap.set(product.id, product);
  }
}

export function cacheProductsList(productsList) {
  if (Array.isArray(productsList)) {
    productsList.forEach(p => cacheProduct(p));
  }
}

export function updateCachedProductStock(productId, newStock) {
  if (!productId) return;
  const cached = appCache.productsMap.get(productId);
  if (cached) {
    cached.currentStock = Number(newStock);
  }
}

export function updateCachedCustomerOutstanding(customerId, newOutstanding) {
  if (!customerId) return;
  const cached = appCache.customersMap.get(customerId);
  if (cached) {
    cached.currentOutstanding = Number(newOutstanding);
  }
}

export function updateCachedSupplierOutstanding(supplierId, newOutstanding) {
  if (!supplierId) return;
  const cached = appCache.suppliersMap.get(supplierId);
  if (cached) {
    cached.currentOutstanding = Number(newOutstanding);
  }
}

export function cacheSupplier(supplier) {
  if (supplier && supplier.id) {
    appCache.suppliersMap.set(supplier.id, supplier);
  }
}

export function cacheSuppliersList(suppliersList) {
  if (Array.isArray(suppliersList)) {
    suppliersList.forEach(s => cacheSupplier(s));
  }
}

export function getCachedSupplier(id) {
  return appCache.suppliersMap.get(id) || null;
}

export function clearCache() {
  appCache.companySettings = null;
  appCache.productsMap.clear();
  appCache.customersMap.clear();
  appCache.suppliersMap.clear();
  appCache.lastDashboardSummary = null;
}
