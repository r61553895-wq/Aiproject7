import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TokenKey {
  code: string;
  tokens: number;
  label?: string;
  createdAt: number;
  isRedeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: number;
  maxUses?: number;
  usedCount?: number;
}

export interface UserSession {
  id: string;
  name?: string;
  username?: string;
  tokensBalance: number;
  totalTokensUsed: number;
  createdAt: number;
  lastActive: number;
  isRegistered?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  tokensBalance: number;
  totalTokensUsed: number;
  createdAt: number;
  lastLoginAt: number;
  role: 'user' | 'admin';
}

export interface AppStore {
  keys: Record<string, TokenKey>;
  users: Record<string, UserSession>;
  accounts: Record<string, UserAccount>;
  totalTokensConsumed: number;
}

// In serverless environments (e.g. Vercel), the filesystem is read-only except /tmp
function getStoreFilePath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'grokson_store.json');
  }
  return path.join(process.cwd(), 'data', 'store.json');
}

const DEFAULT_STORE: AppStore = {
  keys: {
    'GROK-VIP-100K': {
      code: 'GROK-VIP-100K',
      tokens: 100000,
      label: 'VIP ключ (100,000 токенов)',
      createdAt: Date.now(),
      isRedeemed: false,
      maxUses: 1,
      usedCount: 0,
    },
  },
  users: {},
  accounts: {},
  totalTokensConsumed: 0,
};

// Global in-memory cache for ultra-fast access and serverless warm starts
let inMemoryStore: AppStore | null = null;

export function hashPassword(pwd: string): string {
  return crypto.createHash('sha256').update(pwd.trim()).digest('hex');
}

export function loadStore(): AppStore {
  if (inMemoryStore) {
    return inMemoryStore;
  }

  const filePath = getStoreFilePath();
  const baseStorePath = path.join(process.cwd(), 'data', 'store.json');

  try {
    let sourcePath = filePath;
    if (!fs.existsSync(filePath) && fs.existsSync(baseStorePath)) {
      sourcePath = baseStorePath;
    }

    if (fs.existsSync(sourcePath)) {
      const data = fs.readFileSync(sourcePath, 'utf-8');
      inMemoryStore = JSON.parse(data);
      if (inMemoryStore) {
        if (!inMemoryStore.keys) inMemoryStore.keys = {};
        if (!inMemoryStore.users) inMemoryStore.users = {};
        if (!inMemoryStore.accounts) inMemoryStore.accounts = {};
        if (typeof inMemoryStore.totalTokensConsumed !== 'number') {
          inMemoryStore.totalTokensConsumed = 0;
        }
        return inMemoryStore;
      }
    }
  } catch (err) {
    console.warn('Storage read warning, initializing fresh default store:', err);
  }

  inMemoryStore = JSON.parse(JSON.stringify(DEFAULT_STORE));
  return inMemoryStore!;
}

export function saveStore(store: AppStore): void {
  inMemoryStore = store;
  try {
    const filePath = getStoreFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Persistent storage write bypassed (read-only environment):', err);
  }
}

export function getUser(userId: string): UserSession {
  const store = loadStore();

  // If userId matches an account, keep account and user records synchronized
  if (store.accounts && store.accounts[userId]) {
    const acc = store.accounts[userId];
    const userSession: UserSession = {
      id: acc.id,
      name: acc.name,
      username: acc.username,
      tokensBalance: acc.tokensBalance,
      totalTokensUsed: acc.totalTokensUsed,
      createdAt: acc.createdAt,
      lastActive: Date.now(),
      isRegistered: true,
    };
    store.users[userId] = userSession;
    saveStore(store);
    return userSession;
  }

  if (!store.users[userId]) {
    // Unregistered guest user gets 0 starting tokens
    const isGuest = !userId.startsWith('usr_');
    const initialTokens = isGuest ? 0 : 10000;

    store.users[userId] = {
      id: userId,
      name: `Пользователь #${userId.slice(0, 5)}`,
      tokensBalance: initialTokens,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastActive: Date.now(),
      isRegistered: !isGuest,
    };
    saveStore(store);
  } else {
    store.users[userId].lastActive = Date.now();
    saveStore(store);
  }
  return store.users[userId];
}

export function updateUserTokens(userId: string, tokensDelta: number): UserSession {
  const store = loadStore();
  const user = getUser(userId);

  user.tokensBalance += tokensDelta;
  if (tokensDelta < 0) {
    user.totalTokensUsed += Math.abs(tokensDelta);
    store.totalTokensConsumed += Math.abs(tokensDelta);
  }

  store.users[userId] = user;

  // Also update registered account if this is an account id
  if (store.accounts && store.accounts[userId]) {
    store.accounts[userId].tokensBalance = user.tokensBalance;
    store.accounts[userId].totalTokensUsed = user.totalTokensUsed;
  }

  saveStore(store);
  return user;
}

export function redeemKey(code: string, userId: string): { success: boolean; message: string; tokens: number; newBalance: number } {
  const store = loadStore();
  const normalized = code.trim().toUpperCase();
  const key = store.keys[normalized];

  if (!key) {
    return { success: false, message: 'Ключ не найден или не существует', tokens: 0, newBalance: getUser(userId).tokensBalance };
  }

  const maxUses = key.maxUses || 1;
  const currentUses = key.usedCount || (key.isRedeemed ? 1 : 0);

  if (currentUses >= maxUses) {
    return { success: false, message: 'Этот ключ уже был активирован ранее', tokens: 0, newBalance: getUser(userId).tokensBalance };
  }

  // Consume key
  key.usedCount = currentUses + 1;
  if (key.usedCount >= maxUses) {
    key.isRedeemed = true;
  }
  key.redeemedBy = userId;
  key.redeemedAt = Date.now();

  const user = updateUserTokens(userId, key.tokens);
  saveStore(store);

  return {
    success: true,
    message: `Ключ успешно активирован! Начислено ${key.tokens.toLocaleString('ru-RU')} токенов.`,
    tokens: key.tokens,
    newBalance: user.tokensBalance,
  };
}

export function createKey(code: string, tokens: number, label?: string, maxUses: number = 1): TokenKey {
  const store = loadStore();
  const normalized = code.trim().toUpperCase();

  const newKey: TokenKey = {
    code: normalized,
    tokens,
    label: label || `Ключ на ${tokens} токенов`,
    createdAt: Date.now(),
    isRedeemed: false,
    maxUses,
    usedCount: 0,
  };

  store.keys[normalized] = newKey;
  saveStore(store);
  return newKey;
}

export function getAllKeys(): TokenKey[] {
  const store = loadStore();
  return Object.values(store.keys);
}

export function getAllUsers(): UserSession[] {
  const store = loadStore();
  return Object.values(store.users);
}

// -------------------------------------------------------------
// USER ACCOUNTS (REGISTRATION & AUTHENTICATION)
// -------------------------------------------------------------

export function findAccountByUsername(username: string): UserAccount | null {
  const store = loadStore();
  if (!store.accounts) return null;
  const normalized = username.trim().toLowerCase();
  for (const acc of Object.values(store.accounts)) {
    if (
      acc.username.toLowerCase() === normalized ||
      (acc.email && acc.email.toLowerCase() === normalized)
    ) {
      return acc;
    }
  }
  return null;
}

export function findOrCreateGoogleAccount(googleUser: {
  googleId: string;
  email: string;
  name?: string;
  avatar?: string;
  guestUserId?: string;
}): { success: boolean; account: UserAccount; isNew: boolean } {
  const store = loadStore();
  if (!store.accounts) store.accounts = {};
  if (!store.users) store.users = {};

  const cleanEmail = (googleUser.email || '').trim().toLowerCase();

  // Check if account with this email already exists
  let existing: UserAccount | null = null;
  if (cleanEmail) {
    for (const acc of Object.values(store.accounts)) {
      if (acc.email && acc.email.toLowerCase() === cleanEmail) {
        existing = acc;
        break;
      }
    }
  }

  if (existing) {
    existing.lastLoginAt = Date.now();
    if (!existing.name && googleUser.name) existing.name = googleUser.name;
    saveStore(store);
    const pub = { ...existing };
    delete (pub as any).passwordHash;
    return { success: true, account: pub, isNew: false };
  }

  // Create new Google-linked account
  const accountId = `usr_g_${(googleUser.googleId || Date.now().toString(36)).slice(0, 12)}`;
  const baseUsername = cleanEmail
    ? cleanEmail.split('@')[0].replace(/[^a-z0-9_-]/g, '_')
    : `google_user_${Math.random().toString(36).slice(2, 7)}`;

  let uniqueUsername = baseUsername;
  let counter = 1;
  while (findAccountByUsername(uniqueUsername)) {
    uniqueUsername = `${baseUsername}_${counter++}`;
  }

  let startingTokens = 10000;
  let totalUsed = 0;
  if (googleUser.guestUserId && store.users[googleUser.guestUserId]) {
    const guest = store.users[googleUser.guestUserId];
    startingTokens += guest.tokensBalance || 0;
    totalUsed += guest.totalTokensUsed || 0;
  }

  const newAccount: UserAccount = {
    id: accountId,
    username: uniqueUsername,
    passwordHash: hashPassword(`google_auth_${googleUser.googleId || Date.now()}`),
    name: googleUser.name || uniqueUsername,
    email: cleanEmail || undefined,
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    role: 'user',
  };

  store.accounts[accountId] = newAccount;
  store.users[accountId] = {
    id: accountId,
    name: newAccount.name,
    username: newAccount.username,
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastActive: Date.now(),
    isRegistered: true,
  };

  saveStore(store);

  const pub = { ...newAccount };
  delete (pub as any).passwordHash;
  return { success: true, account: pub, isNew: true };
}

export function registerAccount(
  username: string,
  plainPassword: string,
  name?: string,
  email?: string,
  guestUserIdToMigrate?: string
): { success: boolean; message: string; account?: UserAccount } {
  const store = loadStore();
  if (!store.accounts) store.accounts = {};

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3) {
    return { success: false, message: 'Логин должен содержать от 3 символов' };
  }

  if (plainPassword.length < 4) {
    return { success: false, message: 'Пароль должен содержать не менее 4 символов' };
  }

  if (findAccountByUsername(cleanUsername)) {
    return { success: false, message: 'Пользователь с таким логином уже существует' };
  }

  const accountId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const displayName = (name && name.trim()) || username.trim();

  // Registration bonus: 10,000 tokens
  let startingTokens = 10000;
  let totalUsed = 0;

  // Migrate guest balance if any
  if (guestUserIdToMigrate && store.users && store.users[guestUserIdToMigrate]) {
    const guest = store.users[guestUserIdToMigrate];
    startingTokens += (guest.tokensBalance || 0);
    totalUsed += (guest.totalTokensUsed || 0);
  }

  const newAccount: UserAccount = {
    id: accountId,
    username: cleanUsername,
    passwordHash: hashPassword(plainPassword),
    name: displayName,
    email: email?.trim(),
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    role: 'user',
  };

  store.accounts[accountId] = newAccount;

  // Mirror into users table
  store.users[accountId] = {
    id: accountId,
    name: displayName,
    username: cleanUsername,
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastActive: Date.now(),
    isRegistered: true,
  };

  saveStore(store);

  // Return public account representation
  const publicAccount = { ...newAccount };
  delete (publicAccount as any).passwordHash;

  return {
    success: true,
    message: 'Регистрация прошла успешно! Вам начислено 10 000 токенов.',
    account: publicAccount,
  };
}

export function loginAccount(
  username: string,
  plainPassword: string
): { success: boolean; message: string; account?: UserAccount } {
  const store = loadStore();
  const acc = findAccountByUsername(username);

  if (!acc) {
    return { success: false, message: 'Пользователь с таким логином не найден' };
  }

  const hash = hashPassword(plainPassword);
  if (acc.passwordHash !== hash) {
    return { success: false, message: 'Неверный пароль' };
  }

  acc.lastLoginAt = Date.now();
  saveStore(store);

  const publicAccount = { ...acc };
  delete (publicAccount as any).passwordHash;

  return {
    success: true,
    message: 'Вход успешно выполнен',
    account: publicAccount,
  };
}

export function getAccountById(id: string): UserAccount | null {
  const store = loadStore();
  const acc = store.accounts?.[id];
  if (!acc) return null;
  const pub = { ...acc };
  delete (pub as any).passwordHash;
  return pub;
}
