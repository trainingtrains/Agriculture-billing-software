/**
 * Custom Billing Software - Product Master & Inventory Catalogue Module
 */

import { auth, db, collection, getDocs, doc, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, where, limit, startAfter, serverTimestamp } from './firebase.js';
import { money, esc, toast, normalizeBarcode, getExpiryInfo } from './utils.js';
import { cacheProduct, cacheProductsList, getCachedProduct } from './cache.js';

import { getAccessCategories, isCategoryAllowed, getUserAccessGroup } from './auth.js';

export let productsList = [];
export let lastProductDoc = null;

const DEFAULT_PRODUCTS = [];

/**
 * Loads products page with limit to prevent full database download.
 */
export async function loadProducts(pageSize = 25) {
  const result = await fetchProductsPage(pageSize, null);
  productsList = result.products;
  lastProductDoc = result.lastDoc;
  return productsList;
}

/**
 * Cursor-based pagination query for products collection with category access control.
 */
export async function fetchProductsPage(pageSize = 25, lastVisibleDoc = null) {
  if (!auth || !auth.currentUser) {
    productsList = [];
    cacheProductsList(productsList);
    return { products: productsList, lastDoc: null, hasMore: false };
  }

  const allowedCats = getAccessCategories();

  try {
    let q;
    if (allowedCats.length === 1) {
      q = query(
        collection(db, 'products'),
        where('category', '==', allowedCats[0]),
        limit(pageSize)
      );
    } else {
      q = query(
        collection(db, 'products'),
        where('category', 'in', allowedCats),
        limit(pageSize)
      );
    }

    if (lastVisibleDoc) {
      if (allowedCats.length === 1) {
        q = query(
          collection(db, 'products'),
          where('category', '==', allowedCats[0]),
          startAfter(lastVisibleDoc),
          limit(pageSize)
        );
      } else {
        q = query(
          collection(db, 'products'),
          where('category', 'in', allowedCats),
          startAfter(lastVisibleDoc),
          limit(pageSize)
        );
      }
    }

    const querySnapshot = await getDocs(q);
    const fetched = [];
    let newLastDoc = null;

    querySnapshot.forEach(docSnap => {
      const item = { id: docSnap.id, ...docSnap.data() };
      if (isCategoryAllowed(item.category)) {
        fetched.push(item);
        newLastDoc = docSnap;
      }
    });

    cacheProductsList(fetched);
    productsList = fetched;
    return {
      products: fetched,
      lastDoc: newLastDoc,
      hasMore: fetched.length === pageSize
    };
  } catch (err) {
    console.warn('Firestore load products query fallback (querying all & filtering):', err.message);
    try {
      const fallbackSnap = await getDocs(query(collection(db, 'products'), limit(100)));
      const fetched = [];
      fallbackSnap.forEach(d => {
        const item = { id: d.id, ...d.data() };
        if (isCategoryAllowed(item.category)) {
          fetched.push(item);
        }
      });
      cacheProductsList(fetched);
      productsList = fetched;
      return { products: fetched, lastDoc: null, hasMore: false };
    } catch (fallbackErr) {
      console.error('Products load failed completely:', fallbackErr.message);
      productsList = [];
      cacheProductsList(productsList);
      return { products: productsList, lastDoc: null, hasMore: false };
    }
  }
}

/**
 * Remote fast product search using Firestore prefix/barcode index.
 */
export async function searchProductsRemote(term) {
  if (!term || !term.trim()) return [];
  const cleanTerm = term.trim().toLowerCase();

  // 1. Check in-memory cache first
  const cachedHits = productsList.filter(p => 
    isCategoryAllowed(p.category) && (
      (p.productNameLower || p.productName || '').toLowerCase().includes(cleanTerm) ||
      (p.barcode || '').toLowerCase() === cleanTerm ||
      (p.sku || '').toLowerCase().includes(cleanTerm) ||
      (p.hsnCode || '').toLowerCase().includes(cleanTerm)
    )
  );

  if (cachedHits.length > 0) return cachedHits;

  // 2. Query Firestore using indexed prefix search on productNameLower or barcode
  if (!auth || !auth.currentUser) return cachedHits;

  try {
    const qName = query(
      collection(db, 'products'),
      orderBy('productNameLower'),
      where('productNameLower', '>=', cleanTerm),
      where('productNameLower', '<=', cleanTerm + '\uf8ff'),
      limit(15)
    );
    const snap = await getDocs(qName);
    const results = [];
    snap.forEach(d => {
      const p = { id: d.id, ...d.data() };
      if (isCategoryAllowed(p.category)) {
        cacheProduct(p);
        results.push(p);
      }
    });

    if (results.length === 0) {
      // Try exact barcode lookup
      const qBarcode = query(
        collection(db, 'products'),
        where('barcode', '==', cleanTerm),
        limit(5)
      );
      const snapB = await getDocs(qBarcode);
      snapB.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (isCategoryAllowed(p.category)) {
          cacheProduct(p);
          results.push(p);
        }
      });
    }

    return results;
  } catch (err) {
    console.warn('searchProductsRemote query error:', err.message);
    return cachedHits;
  }
}



import { storeEvents } from './store.js';

/**
 * Adds a new product document to Firestore.
 */
export async function saveProduct(productData) {
  try {
    const catVal = (productData.category || 'bio').trim().toLowerCase();
    if (!isCategoryAllowed(catVal)) {
      const allowed = getAccessCategories().join(', ');
      toast(`Category "${productData.category}" is not permitted for your access level (${getUserAccessGroup()}). Allowed: ${allowed}`, 'error');
      throw new Error(`Category not permitted for access group ${getUserAccessGroup()}`);
    }

    const normBarcode = normalizeBarcode(productData.barcode);

    // Duplicate Barcode Protection
    if (normBarcode && auth && auth.currentUser) {
      const qBar = query(
        collection(db, 'products'),
        where('barcode', '==', normBarcode),
        limit(2)
      );
      const barSnap = await getDocs(qBar);
      let isDuplicate = false;
      barSnap.forEach(d => {
        if (d.id !== (productData.id || '')) {
          isDuplicate = true;
        }
      });
      if (isDuplicate) {
        toast(`Barcode "${normBarcode}" is already assigned to another product.`, 'error');
        throw new Error(`Barcode "${normBarcode}" is already assigned to another product.`);
      }
    }

    const payload = {
      productName: productData.productName.trim(),
      productNameLower: productData.productName.trim().toLowerCase(),
      category: productData.category || 'General',
      brand: productData.brand || 'Generic',
      hsnCode: (productData.hsnCode || '').trim(),
      unit: productData.unit || 'KG',
      purchaseRate: Number(productData.purchaseRate) || 0,
      sellingRate: Number(productData.sellingRate) || 0,
      gstRate: Number(productData.gstRate) || 5,
      openingStock: Number(productData.openingStock) || 0,
      currentStock: Number(productData.currentStock ?? productData.openingStock) || 0,
      minimumStock: Number(productData.minimumStock) || 5,
      expiryDate: (productData.expiryDate || '').trim(),
      barcode: normBarcode,
      sku: productData.sku || '',
      status: productData.status || 'ACTIVE',
      updatedAt: serverTimestamp()
    };

    if (productData.id) {
      await updateDoc(doc(db, 'products', productData.id), payload);
      payload.id = productData.id;
      cacheProduct(payload);
      toast(`Product "${payload.productName}" updated successfully.`);
    } else {
      payload.createdAt = serverTimestamp();
      const newRef = await addDoc(collection(db, 'products'), payload);
      payload.id = newRef.id;
      cacheProduct(payload);
      toast(`Product "${payload.productName}" added successfully.`);
    }

    storeEvents.emit('productSaved', { product: payload });
    storeEvents.emit('stockUpdated', { productId: payload.id, newStock: payload.currentStock });
    return payload;
  } catch (err) {
    console.error('Save product error:', err);
    toast('Failed to save product to Firestore.', 'error');
    throw err;
  }
}

/**
 * Deletes a product document from Firestore.
 */
export async function deleteProduct(productId, productName) {
  if (!confirm(`Are you sure you want to delete "${productName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'products', productId));
    toast(`Product "${productName}" deleted.`);
    storeEvents.emit('productSaved', { deletedId: productId });
  } catch (err) {
    console.error('Delete product error:', err);
    toast('Failed to delete product.', 'error');
  }
}

/**
 * Renders the products management table.
 */
export function renderProductsTable(containerId = 'productsRows', filterOptions = {}, items = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const listToUse = items || productsList || [];
  const { search = '', category = '', status = '' } = filterOptions;
  const searchLower = search.toLowerCase().trim();

  const filtered = listToUse.filter(p => {
    if (!isCategoryAllowed(p.category)) return false;

    const matchesSearch = !searchLower || (
      (p.productName || '').toLowerCase().includes(searchLower) ||
      (p.hsnCode || '').toLowerCase().includes(searchLower) ||
      (p.barcode || '').toLowerCase().includes(searchLower)
    );
    const matchesCat = !category || p.category === category;
    let matchesStatus = true;
    if (status === 'instock') matchesStatus = (p.currentStock || 0) > (p.minimumStock || 0);
    if (status === 'lowstock') matchesStatus = (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.minimumStock || 0);
    if (status === 'outofstock') matchesStatus = (p.currentStock || 0) <= 0;
    if (status === 'expired') {
      const exp = getExpiryInfo(p.expiryDate);
      matchesStatus = exp.isExpired;
    }
    if (status === 'expiring') {
      const exp = getExpiryInfo(p.expiryDate);
      matchesStatus = exp.isAlert && !exp.isExpired;
    }

    return matchesSearch && matchesCat && matchesStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<tr><td colspan="11" class="text-center muted" style="padding:20px;">No products matching criteria found.</td></tr>`;
    return;
  }

  container.innerHTML = filtered.map(p => {
    let stockBadge = '<span class="badge success">In Stock</span>';
    if ((p.currentStock || 0) <= 0) {
      stockBadge = '<span class="badge danger">Out of Stock</span>';
    } else if ((p.currentStock || 0) <= (p.minimumStock || 0)) {
      stockBadge = '<span class="badge warning">Low Stock</span>';
    }

    // Expiry Status Badge calculation
    const expInfo = getExpiryInfo(p.expiryDate);
    let expiryHtml = `<span style="color:#94a3b8; font-size:12px;">—</span>`;
    if (p.expiryDate) {
      let bStyle = 'background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;';
      let icon = '📅';
      if (expInfo.level === 'EXPIRED') {
        bStyle = 'background:#fef2f2; color:#dc2626; border:1px solid #fca5a5; font-weight:700;';
        icon = '❌';
      } else if (expInfo.level === 'CRITICAL') {
        bStyle = 'background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; font-weight:700;';
        icon = '🔴';
      } else if (expInfo.level === 'HIGH' || expInfo.level === 'WARNING') {
        bStyle = 'background:#fffbeb; color:#d97706; border:1px solid #fde68a; font-weight:700;';
        icon = '⚠️';
      } else {
        bStyle = 'background:#f0fdf4; color:#166534; border:1px solid #bbf7d0;';
        icon = '✅';
      }

      expiryHtml = `
        <div style="font-size:12px; line-height:1.3;">
          <div style="font-weight:600; color:#1e293b;">${esc(p.expiryDate)}</div>
          <span class="badge" style="font-size:11px; padding:2px 6px; border-radius:4px; margin-top:2px; display:inline-block; ${bStyle}">
            ${icon} ${esc(expInfo.label)}
          </span>
        </div>
      `;
    }

    return `
      <tr>
        <td><strong>${esc(p.productName)}</strong></td>
        <td><code style="font-size:12px;background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;">${esc(p.barcode || '—')}</code></td>
        <td><span class="tag">${esc(p.category || 'General')}</span></td>
        <td>${esc(p.hsnCode || '—')}</td>
        <td>${esc(p.unit || 'KG')}</td>
        <td>${money(p.purchaseRate)}</td>
        <td><strong>${money(p.sellingRate)}</strong></td>
        <td>${p.gstRate || 0}%</td>
        <td><strong>${p.currentStock || 0} ${esc(p.unit || '')}</strong></td>
        <td>${stockBadge}</td>
        <td>${expiryHtml}</td>
        <td>
          <button class="small-btn edit-prod-btn" data-id="${p.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit
          </button>
          <button class="small-btn danger delete-prod-btn" data-id="${p.id}" data-name="${esc(p.productName)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.querySelectorAll('.edit-prod-btn').forEach(b => {
    b.addEventListener('click', () => {
      const prod = productsList.find(p => p.id === b.dataset.id) || getCachedProduct(b.dataset.id);
      if (prod && typeof window.openProductModal === 'function') {
        window.openProductModal(prod, 'EDIT');
      }
    });
  });

  container.querySelectorAll('.delete-prod-btn').forEach(b => {
    b.addEventListener('click', () => {
      deleteProduct(b.dataset.id, b.getAttribute('data-name') || '');
    });
  });
}

