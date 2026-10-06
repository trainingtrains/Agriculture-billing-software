/**
 * Akshara Spices Trades - Customer Management & Ledger Module
 */

import { auth, db, collection, getDocs, doc, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, where, limit, startAfter, serverTimestamp } from './firebase.js';
import { money, esc, toast, validateGSTIN, formatDate, normalizePhone } from './utils.js';
import { appCache, cacheCustomer, cacheCustomersList, getCachedCustomer } from './cache.js';
import { storeEvents } from './store.js';

export let customersList = [];

const DEFAULT_CUSTOMERS = [];

/**
 * Loads paginated customers list from Firestore using limit(25).
 */
export async function loadCustomers(pageSize = 100) {
  if (!auth || !auth.currentUser) {
    customersList = [];
    cacheCustomersList(customersList);
    return customersList;
  }
  try {
    const q = query(collection(db, 'customers'), orderBy('customerName', 'asc'), limit(pageSize));
    const querySnapshot = await getDocs(q);
    const fetched = [];
    querySnapshot.forEach(docSnap => {
      fetched.push({ id: docSnap.id, ...docSnap.data() });
    });

    customersList = fetched;
    cacheCustomersList(customersList);
    return customersList;
  } catch (err) {
    console.warn('Customers load fallback:', err.message);
    customersList = [];
    cacheCustomersList(customersList);
    return customersList;
  }
}

/**
 * Paginated Customer Fetching using Firestore Cursors.
 */
export async function fetchCustomersPage(pageSize = 25, lastVisible = null) {
  if (!auth || !auth.currentUser) return { customers: [], lastVisibleDoc: null, hasMore: false };
  try {
    let q;
    if (lastVisible) {
      q = query(
        collection(db, 'customers'),
        orderBy('customerName', 'asc'),
        startAfter(lastVisible),
        limit(pageSize)
      );
    } else {
      q = query(
        collection(db, 'customers'),
        orderBy('customerName', 'asc'),
        limit(pageSize)
      );
    }
    const snap = await getDocs(q);
    const docs = [];
    snap.forEach(docSnap => {
      const data = { id: docSnap.id, docSnap, ...docSnap.data() };
      docs.push(data);
      cacheCustomer(data);
    });

    if (!lastVisible) {
      customersList = docs;
    }

    const lastVisibleDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    const hasMore = snap.docs.length === pageSize;

    return { customers: docs, lastVisibleDoc, hasMore };
  } catch (err) {
    console.error('Fetch customers page error:', err);
    return { customers: DEFAULT_CUSTOMERS, lastVisibleDoc: null, hasMore: false };
  }
}

/**
 * Indexed Remote Customer Search with Firestore limit(10).
 */
export async function searchCustomersRemote(searchTerm) {
  const normPhone = normalizePhone(searchTerm);
  const termLower = searchTerm.toLowerCase().trim();
  if (!termLower) return [];

  try {
    // 1. Phone match
    if (normPhone && normPhone.length === 10) {
      const qPhone = query(collection(db, 'customers'), where('phone', '==', normPhone), limit(5));
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        const results = [];
        snapPhone.forEach(d => results.push({ id: d.id, ...d.data() }));
        return results;
      }
    }

    // 2. Name prefix match
    if (auth && auth.currentUser) {
      const qName = query(
        collection(db, 'customers'),
        where('customerNameLower', '>=', termLower),
        where('customerNameLower', '<=', termLower + '\uf8ff'),
        limit(10)
      );
      const snapName = await getDocs(qName);
      if (!snapName.empty) {
        const results = [];
        snapName.forEach(d => results.push({ id: d.id, ...d.data() }));
        return results;
      }
    }

    // 3. Fallback memory search
    return customersList.filter(c => 
      (c.customerName || '').toLowerCase().includes(termLower) ||
      normalizePhone(c.phone).includes(normPhone) ||
      (c.gstin || '').toLowerCase().includes(termLower)
    ).slice(0, 10);
  } catch (err) {
    console.warn('searchCustomersRemote error:', err);
    return customersList.filter(c => (c.customerName || '').toLowerCase().includes(termLower)).slice(0, 10);
  }
}



/**
 * Searches Firestore for a customer matching the 10-digit normalized phone number.
 */
export async function findCustomerByPhone(rawPhone) {
  const normPhone = normalizePhone(rawPhone);
  if (!normPhone || normPhone.length !== 10) return null;

  try {
    if (auth && auth.currentUser) {
      const q = query(
        collection(db, 'customers'),
        where('phone', '==', normPhone)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        return { id: docSnap.id, ...docSnap.data() };
      }
    }
    // Fallback or memory check
    if (!customersList.length) await loadCustomers();
    const match = customersList.find(c => normalizePhone(c.phone) === normPhone);
    return match || null;
  } catch (err) {
    console.error('findCustomerByPhone error:', err);
    if (!customersList.length) await loadCustomers();
    const match = customersList.find(c => normalizePhone(c.phone) === normPhone);
    return match || null;
  }
}

/**
 * Creates or updates a customer document.
 */
export async function saveCustomer(customerData) {
  try {
    const taxType = customerData.taxType || customerData.customerTaxType || (customerData.gstin ? 'GST' : 'NON_GST');
    const gstin = (customerData.gstin || '').trim().toUpperCase();
    const rawPhone = (customerData.phone || '').trim();
    const normPhone = normalizePhone(rawPhone);

    if (!customerData.customerName || !customerData.customerName.trim()) {
      toast('Customer Name is required.', 'error');
      return false;
    }

    if (!normPhone || normPhone.length !== 10) {
      toast('Valid 10-digit Indian Mobile Number is required.', 'error');
      return false;
    }

    if (taxType === 'GST') {
      if (!gstin) {
        toast('Customer GSTIN is required for GST Customer.', 'error');
        return false;
      }
      if (!validateGSTIN(gstin)) {
        toast('Invalid GSTIN Format (e.g. 33AAAAA0000A1Z5)', 'error');
        return false;
      }
    }

    // Duplicate Phone Prevention Check before saving new customer
    if (!customerData.id) {
      const existing = await findCustomerByPhone(normPhone);
      if (existing) {
        toast('This phone number is already registered to an existing customer.', 'warning');
        return { isDuplicate: true, ...existing };
      }
    }

    const billingAddress = (customerData.billingAddress || customerData.address || '').trim();
    const deliveryAddress = (customerData.deliveryAddress || billingAddress).trim();

    const payload = {
      customerName: customerData.customerName.trim(),
      customerNameLower: customerData.customerName.trim().toLowerCase(),
      businessName: (customerData.businessName || '').trim(),
      customerTaxType: taxType,
      taxType: taxType,
      customerType: customerData.customerType || 'B2B',
      phone: normPhone,
      email: (customerData.email || '').trim(),
      address: billingAddress,
      billingAddress: billingAddress,
      deliveryAddress: deliveryAddress,
      city: (customerData.city || 'Chennai').trim(),
      state: customerData.state || 'Tamil Nadu',
      stateCode: customerData.stateCode || '33',
      gstin: taxType === 'GST' ? gstin : '',
      creditLimit: Number(customerData.creditLimit) || 0,
      openingBalance: Number(customerData.openingBalance) || 0,
      paymentTerms: (customerData.paymentTerms || 'Net 15').trim(),
      currentOutstanding: Number(customerData.currentOutstanding ?? customerData.openingBalance) || 0,
      status: customerData.status || 'ACTIVE',
      updatedAt: serverTimestamp()
    };

    if (customerData.id) {
      await updateDoc(doc(db, 'customers', customerData.id), payload);
      payload.id = customerData.id;
      toast(`Customer "${payload.customerName}" updated.`);
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'customers'), payload);
      payload.id = ref.id;
      toast(`Customer "${payload.customerName}" saved.`);
    }

    cacheCustomer(payload);
    storeEvents.emit('customerSaved', { customer: payload });
    storeEvents.emit('customerBalanceUpdated', { customerId: payload.id, newOutstanding: payload.currentOutstanding });
    return payload;
  } catch (err) {
    console.error('Save customer error:', err);
    toast('Failed to save customer.', 'error');
    throw err;
  }
}

/**
 * Deletes a customer document.
 */
export async function deleteCustomer(customerId, customerName) {
  if (!confirm(`Delete customer "${customerName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'customers', customerId));
    toast(`Customer "${customerName}" deleted.`);
    storeEvents.emit('customerSaved', { deletedId: customerId });
  } catch (err) {
    console.error('Delete customer error:', err);
    toast('Failed to delete customer.', 'error');
  }
}

/**
 * Fetch detailed Customer Ledger transactions from Firestore (`customer_ledger`).
 */
export async function fetchCustomerLedger(customerId) {
  try {
    const q = query(
      collection(db, 'customer_ledger'),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    const entries = [];
    snap.forEach(docSnap => {
      entries.push({ id: docSnap.id, ...docSnap.data() });
    });
    return entries;
  } catch (err) {
    console.error('Fetch customer ledger error:', err);
    return [];
  }
}
