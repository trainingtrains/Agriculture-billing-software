/**
 * Custom Billing Software - Centralized Event-Driven Application Store & Realtime Engine
 */

import { auth, db, doc, onSnapshot, onAuthStateChanged } from './firebase.js';
import { toast } from './utils.js';
import { setButtonLoading, showPageLoading, hidePageLoading, withLock } from './loading.js';

// Centralized In-Memory Store
export const appStore = {
  products: new Map(),
  customers: new Map(),
  suppliers: new Map(),
  invoices: new Map(),
  purchases: new Map(),
  quotations: new Map(),
  expenses: new Map()
};

// Event Emitter Implementation
class StoreEventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return () => this.off(event, listener);
  }

  off(event, listenerToRemove) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
  }

  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => {
      try {
        listener(data);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    });
  }
}

export const storeEvents = new StoreEventEmitter();

// Active Firestore realtime listener subscriptions
const activeListeners = new Map();

/**
 * Subscribes to live Firestore updates for an active product document.
 */
export function subscribeActiveProduct(productId, callback) {
  if (!productId) return () => {};
  const key = `prod_${productId}`;
  if (activeListeners.has(key)) {
    const existing = activeListeners.get(key);
    if (existing) existing();
    activeListeners.delete(key);
  }

  let unsubSnapshot = null;
  let authUnsub = null;

  const startListener = () => {
    if (unsubSnapshot) return;
    try {
      unsubSnapshot = onSnapshot(doc(db, 'products', productId), (snapshot) => {
        if (snapshot.exists()) {
          const data = { id: snapshot.id, ...snapshot.data() };
          appStore.products.set(productId, data);
          storeEvents.emit('stockUpdated', {
            productId: productId,
            product: data,
            newStock: Number(data.currentStock) || 0
          });
          if (callback) callback(data);
        }
      }, (err) => {
        console.warn('Realtime product listener warning:', err.message);
      });
    } catch (e) {
      console.warn('Failed to attach product listener:', e.message);
    }
  };

  const stopListener = () => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  };

  if (auth && auth.currentUser) {
    startListener();
  }

  if (auth) {
    authUnsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        startListener();
      } else {
        stopListener();
      }
    });
  }

  const cleanUnsub = () => {
    stopListener();
    if (authUnsub) {
      authUnsub();
      authUnsub = null;
    }
    activeListeners.delete(key);
  };

  activeListeners.set(key, cleanUnsub);
  return cleanUnsub;
}

/**
 * Subscribes to live Firestore updates for an active customer document.
 */
export function subscribeActiveCustomer(customerId, callback) {
  if (!customerId) return () => {};
  const key = `cust_${customerId}`;
  if (activeListeners.has(key)) {
    const existing = activeListeners.get(key);
    if (existing) existing();
    activeListeners.delete(key);
  }

  let unsubSnapshot = null;
  let authUnsub = null;

  const startListener = () => {
    if (unsubSnapshot) return;
    try {
      unsubSnapshot = onSnapshot(doc(db, 'customers', customerId), (snapshot) => {
        if (snapshot.exists()) {
          const data = { id: snapshot.id, ...snapshot.data() };
          appStore.customers.set(customerId, data);
          storeEvents.emit('customerBalanceUpdated', {
            customerId: customerId,
            customer: data,
            newOutstanding: Number(data.currentOutstanding) || 0
          });
          if (callback) callback(data);
        }
      }, (err) => {
        console.warn('Realtime customer listener warning:', err.message);
      });
    } catch (e) {
      console.warn('Failed to attach customer listener:', e.message);
    }
  };

  const stopListener = () => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  };

  if (auth && auth.currentUser) {
    startListener();
  }

  if (auth) {
    authUnsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        startListener();
      } else {
        stopListener();
      }
    });
  }

  const cleanUnsub = () => {
    stopListener();
    if (authUnsub) {
      authUnsub();
      authUnsub = null;
    }
    activeListeners.delete(key);
  };

  activeListeners.set(key, cleanUnsub);
  return cleanUnsub;
}

/**
 * Subscribes to live Firestore updates for global company business settings.
 */
export function subscribeCompanySettings(callback) {
  const key = `company_settings_main`;
  if (activeListeners.has(key)) {
    const existing = activeListeners.get(key);
    if (existing) existing();
    activeListeners.delete(key);
  }

  let unsubSnapshot = null;
  let authUnsub = null;

  const startListener = () => {
    if (unsubSnapshot) return;
    try {
      unsubSnapshot = onSnapshot(doc(db, 'company_settings', 'main'), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          storeEvents.emit('companySettingsUpdated', data);
          if (callback) callback(data);
        }
      }, (err) => {
        console.warn('Realtime company settings listener warning:', err.message);
      });
    } catch (e) {
      console.warn('Failed to attach company settings listener:', e.message);
    }
  };

  const stopListener = () => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  };

  if (auth && auth.currentUser) {
    startListener();
  }

  if (auth) {
    authUnsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        startListener();
      } else {
        stopListener();
      }
    });
  }

  const cleanUnsub = () => {
    stopListener();
    if (authUnsub) {
      authUnsub();
      authUnsub = null;
    }
    activeListeners.delete(key);
  };

  activeListeners.set(key, cleanUnsub);
  return cleanUnsub;
}

/**
 * Standard Mutation Handler.
 * Executes transaction/mutation, confirms server result, updates appStore, emits events, and updates UI.
 */
export async function performMutation({ operationName, execute, lockKey, buttonEl, onSuccess }) {
  const runAction = async () => {
    if (buttonEl) setButtonLoading(buttonEl, true, `${operationName}...`);
    try {
      // 1. Execute mutation against Firestore
      const result = await execute();

      if (result) {
        // 2. Perform state & UI synchronization
        if (onSuccess) {
          await onSuccess(result);
        }
      }
      return result;
    } catch (err) {
      console.error(`Mutation error in [${operationName}]:`, err);
      toast(err.message || `Failed to perform ${operationName}. No data was altered.`, 'error');
      return null;
    } finally {
      if (buttonEl) setButtonLoading(buttonEl, false);
    }
  };

  if (lockKey) {
    return await withLock(lockKey, runAction);
  }
  return await runAction();
}
