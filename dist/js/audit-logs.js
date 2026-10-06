/**
 * Akshara Spices Trades - Audit Trail Logging Module
 */

import { db, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from './firebase.js';
import { currentUser } from './auth.js';

export async function logAuditAction(action, moduleName, referenceId = '', details = {}) {
  try {
    const payload = {
      action,
      module: moduleName,
      referenceId,
      userEmail: currentUser ? currentUser.email : 'system',
      userUid: currentUser ? currentUser.uid : 'anonymous',
      details,
      timestamp: serverTimestamp()
    };
    await addDoc(collection(db, 'audit_logs'), payload);
  } catch (err) {
    console.warn('Audit logging failed:', err);
  }
}

export async function fetchAuditLogs(limitCount = 100) {
  try {
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    const logs = [];
    snap.forEach(docSnap => logs.push({ id: docSnap.id, ...docSnap.data() }));
    return logs;
  } catch (err) {
    console.error('Fetch audit logs error:', err);
    return [];
  }
}
