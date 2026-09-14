import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import type { UserAccount } from '../types';
import firebaseConfigData from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseConfigData.apiKey,
  authDomain: firebaseConfigData.authDomain,
  projectId: firebaseConfigData.projectId,
  storageBucket: firebaseConfigData.storageBucket,
  messagingSenderId: firebaseConfigData.messagingSenderId,
  appId: firebaseConfigData.appId,
};

export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Use custom firestoreDatabaseId if provisioned, or default
export const db = firebaseConfigData.firestoreDatabaseId
  ? getFirestore(app, firebaseConfigData.firestoreDatabaseId)
  : getFirestore(app);

export function formatAuthEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed.replace(/[^a-z0-9._-]/g, '')}@grokson.internal`;
}

// Convert Firestore doc or Firebase User to UserAccount
export function mapFirebaseUserToAccount(
  fbUser: FirebaseUser,
  docData?: any
): UserAccount {
  const isAdminEmail = fbUser.email?.toLowerCase() === 'sashanushan@gmail.com';
  const role = docData?.role || (isAdminEmail ? 'admin' : 'user');

  return {
    id: fbUser.uid,
    username:
      docData?.username ||
      fbUser.email?.split('@')[0] ||
      `user_${fbUser.uid.slice(0, 6)}`,
    name: docData?.name || fbUser.displayName || fbUser.email?.split('@')[0] || 'Пользователь',
    email: fbUser.email || undefined,
    tokensBalance: docData?.tokensBalance ?? 10000,
    totalTokensUsed: docData?.totalTokensUsed ?? 0,
    createdAt: docData?.createdAt ? (typeof docData.createdAt === 'number' ? docData.createdAt : Date.now()) : Date.now(),
    lastLoginAt: Date.now(),
    role: role as 'user' | 'admin',
    avatar: docData?.avatar || fbUser.photoURL || undefined,
  };
}

// Register with Firebase Auth + Firestore
export async function registerFirebaseUser(params: {
  login: string;
  email?: string;
  password: string;
  name?: string;
  guestUserId?: string;
}): Promise<{ success: boolean; account?: UserAccount; message: string }> {
  try {
    const authEmail = formatAuthEmail(params.email || params.login);
    const cleanUsername = params.login.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const displayName = params.name?.trim() || cleanUsername;

    // 1. Create user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      authEmail,
      params.password
    );
    const fbUser = userCredential.user;

    // Update display name in Firebase Auth
    await updateProfile(fbUser, { displayName });

    const isFirstAdmin =
      authEmail.toLowerCase() === 'sashanushan@gmail.com' ||
      cleanUsername === 'admin' ||
      cleanUsername === 'sasha';

    const accountData = {
      uid: fbUser.uid,
      id: fbUser.uid,
      username: cleanUsername,
      email: params.email ? params.email.trim().toLowerCase() : authEmail,
      name: displayName,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      role: isFirstAdmin ? 'admin' : 'user',
    };

    // 2. Persist in Firestore
    try {
      await setDoc(doc(db, 'users', fbUser.uid), accountData);
    } catch (fsErr) {
      console.warn('Firestore write warning:', fsErr);
    }

    const account = mapFirebaseUserToAccount(fbUser, accountData);
    return {
      success: true,
      account,
      message: 'Аккаунт успешно создан в Firebase! Вам начислено +10 000 токенов.',
    };
  } catch (error: any) {
    console.error('Firebase registration error:', error);
    let message = 'Ошибка регистрации в Firebase.';
    if (error.code === 'auth/email-already-in-use') {
      message = 'Этот логин/email уже зарегистрирован. Пожалуйста, выполните вход.';
    } else if (error.code === 'auth/weak-password') {
      message = 'Пароль слишком простой (минимум 6 символов).';
    } else if (error.code === 'auth/invalid-email') {
      message = 'Некорректный формат email адреса.';
    } else if (error.message) {
      message = error.message;
    }
    return { success: false, message };
  }
}

// Sign in with Firebase Auth
export async function loginFirebaseUser(params: {
  login: string;
  password: string;
}): Promise<{ success: boolean; account?: UserAccount; message: string }> {
  try {
    const authEmail = formatAuthEmail(params.login);
    const userCredential = await signInWithEmailAndPassword(
      auth,
      authEmail,
      params.password
    );
    const fbUser = userCredential.user;

    // Retrieve full profile from Firestore
    let docData: any = null;
    try {
      const docSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (docSnap.exists()) {
        docData = docSnap.data();
      } else {
        // Create initial document if missing
        docData = {
          uid: fbUser.uid,
          id: fbUser.uid,
          username: fbUser.email?.split('@')[0] || 'user',
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Пользователь',
          tokensBalance: 10000,
          totalTokensUsed: 0,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
          role: fbUser.email?.toLowerCase() === 'sashanushan@gmail.com' ? 'admin' : 'user',
        };
        await setDoc(doc(db, 'users', fbUser.uid), docData);
      }
    } catch (fsErr) {
      console.warn('Firestore read error during login:', fsErr);
    }

    const account = mapFirebaseUserToAccount(fbUser, docData);
    return {
      success: true,
      account,
      message: 'Вход в Firebase аккаунт выполнен успешно!',
    };
  } catch (error: any) {
    console.error('Firebase login error:', error);
    let message = 'Неверный логин или пароль.';
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      message = 'Неверный логин или пароль. Проверьте данные или зарегистрируйтесь.';
    } else if (error.code === 'auth/too-many-requests') {
      message = 'Слишком много попыток входа. Подождите немного или смените пароль.';
    } else if (error.message) {
      message = error.message;
    }
    return { success: false, message };
  }
}

// Log out from Firebase
export async function logoutFirebaseUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Sign out error:', e);
  }
}

// Admin function: Get all users from Firestore
export async function getAllFirestoreUsers(): Promise<UserAccount[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const list: UserAccount[] = [];
    snap.forEach((docItem) => {
      const d = docItem.data();
      list.push({
        id: docItem.id,
        username: d.username || docItem.id.slice(0, 8),
        name: d.name || d.username || 'Пользователь',
        email: d.email || undefined,
        tokensBalance: typeof d.tokensBalance === 'number' ? d.tokensBalance : 10000,
        totalTokensUsed: typeof d.totalTokensUsed === 'number' ? d.totalTokensUsed : 0,
        createdAt: d.createdAt || Date.now(),
        lastLoginAt: d.lastLoginAt || Date.now(),
        role: d.role === 'admin' ? 'admin' : 'user',
        avatar: d.avatar || undefined,
      });
    });
    return list;
  } catch (err) {
    console.error('Failed to get users from Firestore:', err);
    return [];
  }
}

// Admin function: Update user tokens in Firestore
export async function updateUserFirestoreTokens(
  userId: string,
  newBalance: number
): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      tokensBalance: newBalance,
      lastUpdated: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('Failed to update tokens in Firestore:', err);
    return false;
  }
}

// Admin function: Change user role in Firestore
export async function updateUserFirestoreRole(
  userId: string,
  role: 'admin' | 'user'
): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      role,
      lastUpdated: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('Failed to update role in Firestore:', err);
    return false;
  }
}

// Admin function: Delete user from Firestore
export async function deleteUserFromFirestore(userId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'users', userId));
    return true;
  } catch (err) {
    console.error('Failed to delete user in Firestore:', err);
    return false;
  }
}
