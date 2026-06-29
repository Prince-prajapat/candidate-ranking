// src/auth.js — Authentication wrapper linking frontend forms with Firebase Auth

import {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  doc,
  setDoc,
  getDoc
} from './firebase.js';

// Authenticate an existing user
export async function login(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  
  // Fetch user role and name from Firestore
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  const userData = userDoc.exists() ? userDoc.data() : { role: 'candidate', name: result.user.email.split('@')[0] };
  
  const updatedUser = {
    ...result.user,
    role: userData.role,
    name: userData.name
  };

  sessionStorage.setItem('crUser', JSON.stringify(updatedUser));
  return updatedUser;
}

// Register a new user, setting their name and role
export async function register(email, password, role, name) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  
  // Save custom role and name in Firestore
  await setDoc(doc(db, 'users', result.user.uid), {
    email,
    role,
    name
  });
  
  const updatedUser = {
    ...result.user,
    role,
    name
  };
  
  sessionStorage.setItem('crUser', JSON.stringify(updatedUser));
  return updatedUser;
}

// Authenticate via Google OAuth flow
export async function loginWithGoogle(role = 'candidate') {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  
  const userDoc = await getDoc(doc(db, 'users', result.user.uid));
  let userData;
  if (userDoc.exists()) {
    userData = userDoc.data();
  } else {
    // New Google user, save default data
    userData = {
      email: result.user.email,
      role,
      name: result.user.displayName || result.user.email.split('@')[0]
    };
    await setDoc(doc(db, 'users', result.user.uid), userData);
  }
  
  const updatedUser = {
    ...result.user,
    role: userData.role,
    name: userData.name
  };
  
  sessionStorage.setItem('crUser', JSON.stringify(updatedUser));
  return updatedUser;
}

// Register an auth state changes subscriber
export function onAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.exists() ? userDoc.data() : { role: 'candidate', name: user.email.split('@')[0] };
      const updatedUser = {
        ...user,
        role: userData.role,
        name: userData.name
      };
      sessionStorage.setItem('crUser', JSON.stringify(updatedUser));
      callback(updatedUser);
    } else {
      sessionStorage.removeItem('crUser');
      callback(null);
    }
  });
}

// Log current user out
export async function logout() {
  await signOut(auth);
  sessionStorage.removeItem('crUser');
  sessionStorage.removeItem('cr_auth_user');
}
