import { db, doc, getDoc, setDoc, auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from './firebase.js';
import { toast } from './utils.js';

export let currentUser = null;
export let currentUserProfile = null;

/**
 * Gets the current active access group ('bio' or 'chemical_micro').
 */
export function getUserAccessGroup() {
  if (currentUserProfile && currentUserProfile.accessGroup) {
    return currentUserProfile.accessGroup;
  }
  return sessionStorage.getItem('agri_access_group') || 'chemical_micro';
}

/**
 * Gets allowed categories for the active access group.
 */
export function getAccessCategories() {
  const group = getUserAccessGroup();
  if (group === 'bio') {
    return ['bio', 'nithish', 'micro_nutrients'];
  }
  return ['chemical'];
}

/**
 * Checks if a given category is allowed for the active user environment.
 */
export function isCategoryAllowed(category) {
  if (!category) return false;
  const allowed = getAccessCategories();
  const cat = String(category).trim().toLowerCase();
  
  if (allowed.includes('bio') && (cat === 'bio' || cat.includes('bio'))) return true;
  if (allowed.includes('nithish') && (cat === 'nithish' || cat.includes('nithish'))) return true;
  if (allowed.includes('micro_nutrients') && (cat === 'micro_nutrients' || cat.includes('micro') || cat.includes('nutrient'))) return true;
  if (allowed.includes('chemical') && (cat === 'chemical' || cat.includes('chem'))) return true;
  
  return allowed.includes(cat);
}

export async function fetchOrInitUserProfile(user, preferredAccessGroup = null) {
  if (!user || !db) return null;

  // Explicit Firebase Authentication UID Mapping
  let explicitGroup = null;
  if (user.uid === 'AeauV2cDCaNA2KJgzU5mlDHZTsl1' || user.uid === 'BUz7KYnhvZcL6rxbkYpHmRI4EZF3') {
    explicitGroup = 'bio';
  } else if (user.uid === 'GsFX4vYtLGPF5lZ2moR2H4CiOG23' || user.uid === 'pUZOtinjBePL1uJFoasUJseXvXj1') {
    explicitGroup = 'chemical_micro';
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    const targetGroup = explicitGroup || preferredAccessGroup || (user.email && user.email.toLowerCase().includes('bio') ? 'bio' : 'chemical_micro');

    if (snap.exists()) {
      currentUserProfile = snap.data();
      if (currentUserProfile.accessGroup !== targetGroup) {
        currentUserProfile.accessGroup = targetGroup;
        await setDoc(userRef, { accessGroup: targetGroup }, { merge: true });
      }
    } else {
      currentUserProfile = {
        uid: user.uid,
        email: user.email || (targetGroup === 'bio' ? 'bio@agri.com' : 'chem@agri.com'),
        role: 'user',
        accessGroup: targetGroup,
        createdAt: new Date().toISOString()
      };
      try {
        await setDoc(userRef, currentUserProfile);
      } catch (err) {
        console.warn('Could not write user profile to Firestore:', err.message);
      }
    }

    sessionStorage.setItem('agri_access_group', currentUserProfile.accessGroup);
    updateAuthBadge(user);
    return currentUserProfile;
  } catch (err) {
    console.warn('UserProfile fetch error, using fallback profile:', err.message);
    const targetGroup = explicitGroup || preferredAccessGroup || (user.email && user.email.toLowerCase().includes('bio') ? 'bio' : 'chemical_micro');
    currentUserProfile = {
      uid: user.uid,
      email: user.email || (targetGroup === 'bio' ? 'bio@agri.com' : 'chem@agri.com'),
      role: 'user',
      accessGroup: targetGroup
    };
    sessionStorage.setItem('agri_access_group', targetGroup);
    updateAuthBadge(user);
    return currentUserProfile;
  }
}

/**
 * Initializes auth listener and handles UI state switching.
 */
export function initAuth(onUserAuthenticated, onUserUnauthenticated) {
  if (!auth) return;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await fetchOrInitUserProfile(user);
      updateAuthBadge(user);
      if (typeof onUserAuthenticated === 'function') onUserAuthenticated(user, currentUserProfile);
    } else {
      currentUser = null;
      currentUserProfile = null;
      sessionStorage.removeItem('agri_access_group');
      updateAuthBadge(null);
      if (typeof onUserUnauthenticated === 'function') onUserUnauthenticated();
    }
  });
}

export async function loginUser(email, password, preferredAccessGroup = null) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await fetchOrInitUserProfile(cred.user, preferredAccessGroup);
    const envTitle = getUserAccessGroup() === 'bio' ? 'Bio, Nithish & Micro Nutrients Environment' : 'Chemical Only Environment';
    toast(`Welcome! Logged into ${envTitle} (${cred.user.email})`, 'success');
    return cred.user;
  } catch (err) {
    console.warn('SignIn attempt failed, trying automatic registration if new user...', err.code);
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      try {
        const newCred = await createUserWithEmailAndPassword(auth, email, password);
        await fetchOrInitUserProfile(newCred.user, preferredAccessGroup);
        const envTitle = getUserAccessGroup() === 'bio' ? 'Bio, Nithish & Micro Nutrients Environment' : 'Chemical Only Environment';
        toast(`Account created! Logged into ${envTitle} as ${newCred.user.email}`, 'success');
        return newCred.user;
      } catch (signupErr) {
        console.error('Auto-signup error:', signupErr);
      }
    }

    let msg = 'Authentication failed. Please check your credentials.';
    if (err.code === 'auth/wrong-password') {
      msg = 'Incorrect password for this account.';
    }
    toast(msg, 'error');
    throw err;
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    currentUserProfile = null;
    sessionStorage.removeItem('agri_access_group');
    toast('Signed out successfully.');
  } catch (err) {
    console.error('Logout error:', err);
  }
}

function updateAuthBadge(user) {
  const badge = document.getElementById('connection');
  const envBadge = document.getElementById('envBadge');
  const group = getUserAccessGroup();

  if (badge) {
    if (user) {
      badge.textContent = `Connected: ${user.email}`;
      badge.className = 'badge success';
    } else {
      badge.textContent = 'Disconnected';
      badge.className = 'badge warning';
    }
  }

  if (envBadge) {
    if (user) {
      if (group === 'bio') {
        envBadge.innerHTML = '🌿 <strong>Bio, Nithish & Micro Nutrients Environment</strong>';
        envBadge.className = 'badge bio-env-badge';
        envBadge.style.cssText = 'background:#E8F5E9; color:#1B5E20; border:1px solid #A5D6A7; font-weight:600; padding:4px 10px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;';
      } else {
        envBadge.innerHTML = '🧪 <strong>Chemical Only Environment</strong>';
        envBadge.className = 'badge chem-env-badge';
        envBadge.style.cssText = 'background:#E3F2FD; color:#0D47A1; border:1px solid #90CAF9; font-weight:600; padding:4px 10px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;';
      }
    } else {
      envBadge.style.display = 'none';
    }
  }
}

