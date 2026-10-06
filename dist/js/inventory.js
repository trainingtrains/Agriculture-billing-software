/**
 * Akshara Spices Trades - Inventory Management & Stock Adjustment Module
 */

import { db, doc, collection, getDocs, runTransaction, serverTimestamp, query, where, orderBy, limit } from './firebase.js';
import { productsList, loadProducts } from './products.js';
import { money, esc, toast, formatDate } from './utils.js';
import { updateCachedProductStock } from './cache.js';
import { storeEvents } from './store.js';
import { isCategoryAllowed } from './auth.js';

/**
 * Adjust stock of a product (Stock Adjustment / Audit / Damage).
 * Creates a stock_movements record and updates current stock atomically.
 */
export async function adjustStock(productId, adjustmentData) {
  const { type = 'ADJUSTMENT', actionType = 'INCREASE', qty = 0, reason = 'Audit Adjustment' } = adjustmentData;
  const numQty = Number(qty);
  if (!productId || isNaN(numQty) || numQty <= 0) {
    toast('Invalid quantity for stock adjustment.', 'warning');
    return false;
  }

  const deltaQty = actionType === 'INCREASE' ? numQty : -numQty;

  try {
    let finalStock = null;
    await runTransaction(db, async (transaction) => {
      const productRef = doc(db, 'products', productId);
      const prodSnap = await transaction.get(productRef);
      if (!prodSnap.exists()) {
        throw new Error('Product not found in database.');
      }

      const prodData = prodSnap.data();
      const prevStock = Number(prodData.currentStock) || 0;
      finalStock = prevStock + deltaQty;

      if (finalStock < 0) {
        throw new Error(`Stock adjustment would result in negative stock (${finalStock} ${prodData.unit}).`);
      }

      transaction.update(productRef, {
        currentStock: finalStock,
        updatedAt: serverTimestamp()
      });

      // Log Stock Movement Audit Record
      const movementRef = doc(collection(db, 'stock_movements'));
      transaction.set(movementRef, {
        productId,
        productName: prodData.productName,
        type: type.toUpperCase(),
        referenceId: `ADJ-${Date.now().toString().slice(-6)}`,
        quantity: deltaQty,
        unit: prodData.unit || 'KG',
        previousStock: prevStock,
        newStock: finalStock,
        notes: reason,
        createdAt: serverTimestamp()
      });
    });

    if (finalStock !== null) {
      updateCachedProductStock(productId, finalStock);
      storeEvents.emit('stockUpdated', { productId, newStock: finalStock });
    }

    toast(`Stock updated successfully. New balance: ${deltaQty > 0 ? '+' : ''}${deltaQty}`, 'success');
    return true;
  } catch (err) {
    console.error('Stock adjustment error:', err);
    toast(err.message || 'Failed to adjust stock.', 'error');
    return false;
  }
}

/**
 * Fetches stock movement audit history for a product or overall.
 */
export async function fetchStockMovements(productId = null, limitCount = 100) {
  try {
    let q;
    if (productId) {
      q = query(
        collection(db, 'stock_movements'),
        where('productId', '==', productId),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
    } else {
      q = query(
        collection(db, 'stock_movements'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
    }

    const snap = await getDocs(q);
    const logs = [];
    snap.forEach(docSnap => {
      logs.push({ id: docSnap.id, ...docSnap.data() });
    });
    return logs;
  } catch (err) {
    console.error('Fetch stock movements error:', err);
    return [];
  }
}

/**
 * Renders inventory statistics KPIs.
 */
export function getInventoryKPIs() {
  const allowedProds = (productsList || []).filter(p => isCategoryAllowed(p.category));
  let totalProducts = allowedProds.length;
  let totalValuation = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  allowedProds.forEach(p => {
    const stock = Number(p.currentStock) || 0;
    const minStock = Number(p.minimumStock) || 5;
    const rate = Number(p.purchaseRate ?? p.sellingRate) || 0;
    totalValuation += stock * rate;

    if (stock <= 0) {
      outOfStockCount++;
    } else if (stock <= minStock) {
      lowStockCount++;
    }
  });

  return {
    totalProducts,
    totalValuation,
    lowStockCount,
    outOfStockCount
  };
}
