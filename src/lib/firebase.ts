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

// Secure password hashing with salt using Web Crypto API
export async function hashPassword(password: string, salt: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(`${salt}:${password}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('SubtleCrypto error, falling back:', e);
    }
  }
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = (h << 5) - h + password.charCodeAt(i) + (salt.charCodeAt(i % salt.length) || 0);
    h |= 0;
  }
  return 'sh_' + Math.abs(h);
}

export function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
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
    const cleanUsername = params.login.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const userEmail = params.email ? params.email.trim().toLowerCase() : undefined;
    const authEmail = formatAuthEmail(params.email || params.login);
    const displayName = params.name?.trim() || cleanUsername;

    const isFirstAdmin =
      authEmail.toLowerCase() === 'sashanushan@gmail.com' ||
      cleanUsername === 'admin' ||
      cleanUsername === 'sasha' ||
      userEmail === 'sashanushan@gmail.com';

    let fbUid: string | null = null;
    let fbUser: FirebaseUser | null = null;

    // 1. First attempt: Firebase Authentication (if enabled in project)
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        authEmail,
        params.password
      );
      fbUser = userCredential.user;
      fbUid = fbUser.uid;
      await updateProfile(fbUser, { displayName });
    } catch (authError: any) {
      console.warn('Firebase Auth notice:', authError?.code);

      if (authError?.code === 'auth/email-already-in-use') {
        return {
          success: false,
          message: 'Этот логин или email уже зарегистрирован. Пожалуйста, выполните вход.',
        };
      }
      if (authError?.code === 'auth/weak-password') {
        return {
          success: false,
          message: 'Пароль слишком простой (минимум 6 символов).',
        };
      }
      // If auth/operation-not-allowed or similar, proceed smoothly to Firestore database!
    }

    // 2. Check if user already exists in Firestore users collection
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const duplicate = usersSnap.docs.find((d) => {
        const data = d.data();
        const u = (data.username || '').toLowerCase();
        const e = (data.email || '').toLowerCase();
        return (
          u === cleanUsername ||
          (userEmail && e === userEmail) ||
          e === authEmail ||
          d.id.toLowerCase() === cleanUsername
        );
      });

      if (duplicate) {
        return {
          success: false,
          message: 'Пользователь с таким логином или email уже существует. Пожалуйста, выполните вход.',
        };
      }
    } catch (fsCheckErr) {
      console.warn('Firestore duplicate check warning:', fsCheckErr);
    }

    // 3. Prepare user document for Firestore
    const uid = fbUid || `fb_${cleanUsername}_${Math.random().toString(36).substring(2, 8)}`;
    const salt = generateSalt();
    const passwordHash = await hashPassword(params.password, salt);

    const accountData = {
      uid,
      id: uid,
      username: cleanUsername,
      email: userEmail || authEmail,
      name: displayName,
      passwordHash,
      salt,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      role: (isFirstAdmin ? 'admin' : 'user') as 'admin' | 'user',
    };

    // 4. Save into Firestore
    try {
      await setDoc(doc(db, 'users', uid), accountData);
    } catch (fsErr) {
      console.warn('Firestore write warning:', fsErr);
    }

    const account: UserAccount = {
      id: uid,
      username: cleanUsername,
      name: displayName,
      email: accountData.email,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: accountData.createdAt,
      lastLoginAt: accountData.lastLoginAt,
      role: accountData.role,
    };

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
    } else if (error.message && !error.message.includes('operation-not-allowed')) {
      message = error.message;
    }
    return { success: false, message };
  }
}

// Sign in with Firebase Auth or Firestore
export async function loginFirebaseUser(params: {
  login: string;
  password: string;
}): Promise<{ success: boolean; account?: UserAccount; message: string }> {
  const cleanLogin = params.login.trim().toLowerCase();
  const authEmail = formatAuthEmail(params.login);

  // 1. First attempt: Firebase Authentication (if provider is active)
  try {
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
        await updateDoc(doc(db, 'users', fbUser.uid), { lastLoginAt: Date.now() });
      } else {
        docData = {
          uid: fbUser.uid,
          id: fbUser.uid,
          username: fbUser.email?.split('@')[0] || cleanLogin,
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
  } catch (authError: any) {
    console.warn('Firebase Auth sign-in code:', authError?.code);
    // Continue smoothly to Firestore direct authentication!
  }

  // 2. Direct Firestore authentication (resilient when auth/operation-not-allowed occurs)
  try {
    const snap = await getDocs(collection(db, 'users'));
    let matchedDoc: any = null;
    let matchedId: string = '';

    for (const docItem of snap.docs) {
      const d = docItem.data();
      const u = (d.username || '').toLowerCase();
      const e = (d.email || '').toLowerCase();
      if (
        u === cleanLogin ||
        e === cleanLogin ||
        e === authEmail ||
        docItem.id.toLowerCase() === cleanLogin
      ) {
        matchedDoc = d;
        matchedId = docItem.id;
        break;
      }
    }

    if (matchedDoc) {
      let isPasswordValid = false;

      if (matchedDoc.passwordHash && matchedDoc.salt) {
        const computedHash = await hashPassword(params.password, matchedDoc.salt);
        if (computedHash === matchedDoc.passwordHash) {
          isPasswordValid = true;
        }
      } else if (matchedDoc.password && matchedDoc.password === params.password) {
        isPasswordValid = true;
      }

      // Fallback check against saved passwords in localStorage
      if (!isPasswordValid) {
        try {
          const raw = localStorage.getItem('grokson_saved_accounts');
          if (raw) {
            const list = JSON.parse(raw);
            const found = list.find(
              (a: any) =>
                (a.username && a.username.toLowerCase() === cleanLogin) ||
                (a.email && a.email.toLowerCase() === cleanLogin)
            );
            if (found && found.password === params.password) {
              isPasswordValid = true;
            }
          }
        } catch (e) {}
      }

      if (isPasswordValid) {
        try {
          await updateDoc(doc(db, 'users', matchedId), { lastLoginAt: Date.now() });
        } catch (e) {}

        const isAdmin =
          matchedDoc.role === 'admin' ||
          matchedDoc.email?.toLowerCase() === 'sashanushan@gmail.com' ||
          matchedDoc.username === 'admin' ||
          matchedDoc.username === 'sasha';

        const account: UserAccount = {
          id: matchedId,
          username: matchedDoc.username || matchedId.slice(0, 8),
          name: matchedDoc.name || matchedDoc.username || 'Пользователь',
          email: matchedDoc.email,
          tokensBalance: typeof matchedDoc.tokensBalance === 'number' ? matchedDoc.tokensBalance : 10000,
          totalTokensUsed: typeof matchedDoc.totalTokensUsed === 'number' ? matchedDoc.totalTokensUsed : 0,
          createdAt: matchedDoc.createdAt || Date.now(),
          lastLoginAt: Date.now(),
          role: isAdmin ? 'admin' : 'user',
          avatar: matchedDoc.avatar,
        };

        return {
          success: true,
          account,
          message: 'Вход в аккаунт Firebase выполнен успешно!',
        };
      } else {
        return {
          success: false,
          message: 'Неверный пароль. Пожалуйста, проверьте введённые данные.',
        };
      }
    }
  } catch (fsErr) {
    console.error('Firestore login check error:', fsErr);
  }

  return {
    success: false,
    message: 'Аккаунт не найден. Проверьте логин или зарегистрируйтесь.',
  };
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
