/**
 * Akshara Spices Trades - Supplier Management & Ledger Module
 */

import { auth, db, collection, getDocs, doc, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, where, limit, startAfter, serverTimestamp } from './firebase.js';
import { money, esc, toast, validateGSTIN } from './utils.js';
import { cacheSupplier, cacheSuppliersList, getCachedSupplier } from './cache.js';
import { storeEvents } from './store.js';

export let suppliersList = [];
export let lastSupplierDoc = null;

const DEFAULT_SUPPLIERS = [];

/**
 * Loads bounded suppliers list for current view.
 */
export async function loadSuppliers(pageSize = 100) {
  const result = await fetchSuppliersPage(pageSize, null);
  suppliersList = result.suppliers;
  lastSupplierDoc = result.lastDoc;
  return suppliersList;
}

/**
 * Cursor-based pagination query for suppliers.
 */
export async function fetchSuppliersPage(pageSize = 25, lastVisibleDoc = null) {
  if (!auth || !auth.currentUser) {
    suppliersList = [];
    cacheSuppliersList(suppliersList);
    return { suppliers: suppliersList, lastDoc: null, hasMore: false };
  }
  try {
    let q = query(collection(db, 'suppliers'), orderBy('supplierName', 'asc'), limit(pageSize));
    if (lastVisibleDoc) {
      q = query(collection(db, 'suppliers'), orderBy('supplierName', 'asc'), startAfter(lastVisibleDoc), limit(pageSize));
    }
    const querySnapshot = await getDocs(q);
    const fetched = [];
    let newLastDoc = null;
    querySnapshot.forEach(docSnap => {
      const item = { id: docSnap.id, ...docSnap.data() };
      fetched.push(item);
      newLastDoc = docSnap;
    });

    if (!lastVisibleDoc) {
      suppliersList = fetched;
    }
    cacheSuppliersList(fetched);
    return {
      suppliers: fetched,
      lastDoc: newLastDoc,
      hasMore: fetched.length === pageSize
    };
  } catch (err) {
    console.warn('Suppliers load fallback:', err.message);
    suppliersList = [];
    cacheSuppliersList(suppliersList);
    return { suppliers: suppliersList, lastDoc: null, hasMore: false };
  }
}



/**
 * Creates or updates a supplier document.
 */
export async function saveSupplier(supplierData) {
  try {
    if (supplierData.gstin && !validateGSTIN(supplierData.gstin)) {
      toast('Invalid GSTIN Format (e.g. 32ABCDE1234F1Z6)', 'error');
      return false;
    }

    const payload = {
      supplierName: supplierData.supplierName.trim(),
      businessName: (supplierData.businessName || '').trim(),
      phone: (supplierData.phone || '').trim(),
      email: (supplierData.email || '').trim(),
      address: (supplierData.address || '').trim(),
      city: (supplierData.city || '').trim(),
      state: supplierData.state || 'Tamil Nadu',
      stateCode: supplierData.stateCode || '33',
      gstin: (supplierData.gstin || '').trim().toUpperCase(),
      openingBalance: Number(supplierData.openingBalance) || 0,
      currentOutstanding: Number(supplierData.currentOutstanding ?? supplierData.openingBalance) || 0,
      status: supplierData.status || 'ACTIVE',
      updatedAt: serverTimestamp()
    };

    if (supplierData.id) {
      await updateDoc(doc(db, 'suppliers', supplierData.id), payload);
      payload.id = supplierData.id;
      toast(`Supplier "${payload.supplierName}" updated.`);
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'suppliers'), payload);
      payload.id = ref.id;
      toast(`Supplier "${payload.supplierName}" saved.`);
    }

    cacheSupplier(payload);
    storeEvents.emit('supplierSaved', { supplier: payload });
    storeEvents.emit('supplierBalanceUpdated', { supplierId: payload.id, newOutstanding: payload.currentOutstanding });
    return payload;
  } catch (err) {
    console.error('Save supplier error:', err);
    toast('Failed to save supplier.', 'error');
    throw err;
  }
}

/**
 * Deletes a supplier document.
 */
export async function deleteSupplier(supplierId, supplierName) {
  if (!confirm(`Delete supplier "${supplierName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'suppliers', supplierId));
    toast(`Supplier "${supplierName}" deleted.`);
    storeEvents.emit('supplierSaved', { deletedId: supplierId });
  } catch (err) {
    console.error('Delete supplier error:', err);
    toast('Failed to delete supplier.', 'error');
  }
}

/**
 * Fetch detailed Supplier Ledger entries.
 */
export async function fetchSupplierLedger(supplierId) {
  try {
    const q = query(
      collection(db, 'supplier_ledger'),
      where('supplierId', '==', supplierId),
      orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    const entries = [];
    snap.forEach(docSnap => {
      entries.push({ id: docSnap.id, ...docSnap.data() });
    });
    return entries;
  } catch (err) {
    console.error('Fetch supplier ledger error:', err);
    return [];
  }
}
