// Firebase modular SDK imports via CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-analytics.js';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut 
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  startAfter,
  startAt,
  endAt,
  writeBatch,
  runTransaction, 
  serverTimestamp,
  Timestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// Configuration from window.FIREBASE_CONFIG or fallback
const config = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyCbKhZw_ZSV4UNe7KkFoXxf_x03DcfvpRA",
  authDomain: "billing-software-afec5.firebaseapp.com",
  projectId: "billing-software-afec5",
  firestoreDatabaseId: "agri",
  storageBucket: "billing-software-afec5.firebasestorage.app",
  messagingSenderId: "227836029497",
  appId: "1:227836029497:web:883f35ec44df5f763a3be8",
  measurementId: "G-P45QZ2K58M"
};

let app, auth, db, analytics;

try {
  app = initializeApp(config);
  auth = getAuth(app);
  const dbName = config.firestoreDatabaseId || 'agri';
  db = getFirestore(app, dbName);
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {});
  console.log(`Firebase Firestore initialized successfully for S M AGRI TECH (Project: ${config.projectId}, Database: ${dbName}).`);
} catch (err) {
  console.error("Firebase initialization failed:", err);
}

export {
  app,
  auth,
  db,
  analytics,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  startAt,
  endAt,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  onSnapshot
};
