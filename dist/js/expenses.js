/**
 * Akshara Spices Trades - Expense Management Module
 */

import { auth, db, doc, collection, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where, limit, startAfter } from './firebase.js';
import { money, esc, toast, todayStr } from './utils.js';

export let expensesList = [];
export let lastExpenseDoc = null;

export const EXPENSE_CATEGORIES = [
  'Transport & Delivery',
  'Freight & Shipping',
  'Loading & Unloading',
  'Packaging Material',
  'Shop Rent',
  'Electricity & Utilities',
  'Staff Salary & Wages',
  'Maintenance & Repairs',
  'Marketing & Advertising',
  'Miscellaneous & Office'
];

/**
 * Loads bounded expenses from Firestore.
 */
export async function loadExpenses(pageSize = 25) {
  const res = await fetchExpensesPage(pageSize, null);
  expensesList = res.expenses;
  lastExpenseDoc = res.lastDoc;
  return expensesList;
}

/**
 * Cursor-based pagination query for expenses.
 */
export async function fetchExpensesPage(pageSize = 25, lastVisibleDoc = null) {
  if (!auth || !auth.currentUser) return { expenses: [], lastDoc: null, hasMore: false };
  try {
    let q = query(collection(db, 'expenses'), orderBy('expenseDate', 'desc'), limit(pageSize));
    if (lastVisibleDoc) {
      q = query(collection(db, 'expenses'), orderBy('expenseDate', 'desc'), startAfter(lastVisibleDoc), limit(pageSize));
    }
    const snap = await getDocs(q);
    const docs = [];
    let newLastDoc = null;
    snap.forEach(docSnap => {
      docs.push({ id: docSnap.id, ...docSnap.data() });
      newLastDoc = docSnap;
    });
    return {
      expenses: docs,
      lastDoc: newLastDoc,
      hasMore: docs.length === pageSize
    };
  } catch (err) {
    console.error('Error loading expenses page:', err);
    toast('Error loading expenses list.', 'error');
    return { expenses: [], lastDoc: null, hasMore: false };
  }
}

/**
 * Saves or updates an expense record.
 */
export async function saveExpense(expenseData) {
  const {
    id = '',
    category = 'Miscellaneous & Office',
    amount = 0,
    paymentMode = 'Cash',
    description = '',
    reference = '',
    expenseDate = todayStr()
  } = expenseData;

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    toast('Please enter a valid expense amount.', 'warning');
    return false;
  }

  try {
    const payload = {
      expenseDate,
      category,
      amount: numAmount,
      paymentMode,
      description: description.trim(),
      reference: reference.trim(),
      updatedAt: serverTimestamp()
    };

    if (id) {
      await updateDoc(doc(db, 'expenses', id), payload);
      toast('Expense record updated.');
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'expenses'), payload);
      payload.id = ref.id;
      toast(`Expense of ${money(numAmount)} recorded under "${category}".`);
    }

    await loadExpenses();
    return payload;
  } catch (err) {
    console.error('Save expense error:', err);
    toast('Failed to save expense.', 'error');
    return false;
  }
}

/**
 * Deletes an expense document.
 */
export async function deleteExpense(id) {
  if (!confirm('Are you sure you want to delete this expense record?')) return;
  try {
    await deleteDoc(doc(db, 'expenses', id));
    toast('Expense deleted.');
    await loadExpenses();
  } catch (err) {
    console.error('Delete expense error:', err);
    toast('Failed to delete expense.', 'error');
  }
}
