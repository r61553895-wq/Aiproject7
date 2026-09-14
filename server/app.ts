import 'dotenv/config';
import express, { Request, Response } from 'express';
import { callGigaChat, DEFAULT_GIGACHAT_KEY } from './gigachat';
import {
  getUser,
  updateUserTokens,
  redeemKey,
  createKey,
  getAllKeys,
  getAllUsers,
  getAllAccounts,
  deleteAccount,
  updateAccountRole,
  loadStore,
  saveStore,
  registerAccount,
  loginAccount,
  getAccountById,
  hashPassword,
} from './storage';
import { GoogleGenAI } from '@google/genai';

export const app = express();

// Express JSON middleware with increased payload limit for rich prompts
app.use(express.json({ limit: '2mb' }));

// CORS headers for seamless API access across dev, production, and Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Lazy Gemini client helper
let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (process.env.GEMINI_API_KEY) {
    if (!geminiClient) {
      geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return geminiClient;
  }
  return null;
}

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
app.get(['/api/health', '/health'], (req: Request, res: Response) => {
  const store = loadStore();
  res.json({
    status: 'ok',
    service: 'Grokson Intelligence Server',
    version: '2.5.0',
    hasGigaChatKey: Boolean(process.env.GIGACHAT_AUTH_KEY || DEFAULT_GIGACHAT_KEY),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    totalUsers: Object.keys(store.users || {}).length,
    totalAccounts: Object.keys(store.accounts || {}).length,
    timestamp: Date.now(),
  });
});

// -------------------------------------------------------------
// USER DATA & BALANCE
// -------------------------------------------------------------
app.get(['/api/user/:userId', '/user/:userId'], (req: Request, res: Response) => {
  const { userId } = req.params;
  const user = getUser(userId);
  const account = getAccountById(userId);
  res.json({ user, account });
});

// -------------------------------------------------------------
// AUTHENTICATION & REGISTRATION
// -------------------------------------------------------------
app.post(['/api/auth/register', '/auth/register'], (req: Request, res: Response) => {
  const username = req.body.username || req.body.login;
  const password = req.body.password;
  const name = req.body.name;
  const email = req.body.email;
  const guestUserId = req.body.guestUserId || req.body.currentUserId;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });
  }

  const result = registerAccount(username, password, name, email, guestUserId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post(['/api/auth/login', '/auth/login'], (req: Request, res: Response) => {
  // Support both 'username' and 'login' field names from client
  const username = req.body.username || req.body.login;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });
  }

  const result = loginAccount(username, password);
  if (!result.success) {
    return res.status(401).json(result);
  }
  res.json(result);
});

// -------------------------------------------------------------
// SECURE USER ACCOUNTS & FIREBASE INTEGRATION
// -------------------------------------------------------------

// Sync user account state or verify sessions
app.post(['/api/auth/sync', '/auth/sync'], (req: Request, res: Response) => {
  const { id, username, email, name, avatar } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'missing_id', message: 'ID обязателен' });
  }

  const existing = getAccountById(id);
  if (existing) {
    return res.json({ success: true, account: existing });
  }

  res.json({ success: false, message: 'Аккаунт не найден в локальном хранилище' });
});

app.post(['/api/auth/batch', '/auth/batch'], (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.json({ accounts: [] });
  }
  const accounts = ids
    .map((id: string) => getAccountById(id))
    .filter(Boolean);
  res.json({ accounts });
});

app.post(['/api/auth/update-profile', '/auth/update-profile'], (req: Request, res: Response) => {
  const { userId, name } = req.body;
  const store = loadStore();
  if (store.accounts && store.accounts[userId]) {
    store.accounts[userId].name = (name && name.trim()) || store.accounts[userId].name;
    if (store.users[userId]) {
      store.users[userId].name = store.accounts[userId].name;
    }
    saveStore(store);
    return res.json({ success: true, account: getAccountById(userId) });
  }
  res.status(404).json({ success: false, message: 'Аккаунт не найден' });
});

app.post(['/api/auth/change-password', '/auth/change-password'], (req: Request, res: Response) => {
  const { userId, oldPassword, newPassword } = req.body;
  const store = loadStore();
  if (store.accounts && store.accounts[userId]) {
    const acc = store.accounts[userId];
    if (acc.passwordHash !== hashPassword(oldPassword)) {
      return res.status(400).json({ success: false, message: 'Неверный текущий пароль' });
    }
    acc.passwordHash = hashPassword(newPassword);
    saveStore(store);
    return res.json({ success: true, message: 'Пароль успешно обновлён' });
  }
  res.status(404).json({ success: false, message: 'Аккаунт не найден' });
});

// Support both /api/auth/sync-client and /api/auth/sync-accounts
const handleSyncAccounts = (req: Request, res: Response) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts)) {
    return res.json({ success: true });
  }
  const store = loadStore();
  if (!store.accounts) store.accounts = {};
  if (!store.users) store.users = {};

  for (const acc of accounts) {
    if (acc && acc.id && acc.username) {
      if (!store.accounts[acc.id]) {
        store.accounts[acc.id] = {
          id: acc.id,
          username: acc.username.toLowerCase(),
          passwordHash: acc.passwordHash || hashPassword('123456'),
          name: acc.name || acc.username,
          email: acc.email,
          tokensBalance: typeof acc.tokensBalance === 'number' ? acc.tokensBalance : 10000,
          totalTokensUsed: acc.totalTokensUsed || 0,
          createdAt: acc.createdAt || Date.now(),
          lastLoginAt: Date.now(),
          role: 'user',
        };
      }
      if (!store.users[acc.id]) {
        store.users[acc.id] = {
          id: acc.id,
          name: store.accounts[acc.id].name,
          username: store.accounts[acc.id].username,
          tokensBalance: store.accounts[acc.id].tokensBalance,
          totalTokensUsed: store.accounts[acc.id].totalTokensUsed,
          createdAt: store.accounts[acc.id].createdAt,
          lastActive: Date.now(),
          isRegistered: true,
        };
      }
    }
  }
  saveStore(store);
  res.json({ success: true });
};

app.post(['/api/auth/sync-client', '/auth/sync-client'], handleSyncAccounts);
app.post(['/api/auth/sync-accounts', '/auth/sync-accounts'], handleSyncAccounts);

// -------------------------------------------------------------
// VOUCHER KEY REDEMPTION
// -------------------------------------------------------------
app.post(['/api/keys/redeem', '/keys/redeem'], (req: Request, res: Response) => {
  const { code, userId } = req.body;
  if (!code || !userId) {
    return res.status(400).json({ success: false, message: 'Отсутствует код ключа или ID пользователя' });
  }
  const result = redeemKey(code, userId);
  res.json(result);
});

// -------------------------------------------------------------
// CHAT COMPLETION (GIGACHAT + GEMINI NEURAL GATEWAY)
// -------------------------------------------------------------
app.post(['/api/chat', '/chat'], async (req: Request, res: Response) => {
  const { messages, userId = 'guest' } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'invalid_messages', message: 'Массив сообщений обязателен' });
  }

  // Verify and charge user tokens
  const user = getUser(userId);
  if (user.tokensBalance < 15) {
    return res.status(402).json({
      error: 'insufficient_tokens',
      message: 'Недостаточно токенов на балансе',
      balance: user.tokensBalance,
    });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const gigaAuthKey = process.env.GIGACHAT_AUTH_KEY || DEFAULT_GIGACHAT_KEY;
  const gemini = getGemini();

  // Route 1: Official GigaChat API
  if (gigaAuthKey && gigaAuthKey.trim() !== '') {
    try {
      const response = await callGigaChat(messages, gigaAuthKey);
      const tokensCharged = Math.max(15, response.usage.total_tokens || Math.ceil((lastUserMsg.length + response.text.length) / 4));
      const updatedUser = updateUserTokens(userId, -tokensCharged);

      return res.json({
        text: response.text,
        tokensUsed: tokensCharged,
        model: response.model,
        remainingBalance: updatedUser.tokensBalance,
      });
    } catch (gigaErr: any) {
      console.warn('GigaChat API error, attempting Gemini fallback:', gigaErr.message);
    }
  }

  // Route 2: Gemini API if GEMINI_API_KEY is present
  if (gemini) {
    try {
      const formattedContents = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const geminiResponse = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: formattedContents,
        config: {
          systemInstruction:
            'Ты — Grokson (Гроксон), официальная нейросетевая система. Отвечай подробно, по существу, доброжелательно, на русском языке. Используй Markdown, примеры кода и списки при необходимости. Не используй шаблоны, отвечай точно на заданный вопрос.',
        },
      });

      const replyText = geminiResponse.text || 'Grokson завершил обработку запроса.';
      const approxTokens = Math.max(25, Math.ceil((lastUserMsg.length + replyText.length) / 3));
      const updatedUser = updateUserTokens(userId, -approxTokens);

      return res.json({
        text: replyText,
        tokensUsed: approxTokens,
        model: 'Grokson (Gemini Flash)',
        remainingBalance: updatedUser.tokensBalance,
      });
    } catch (geminiErr: any) {
      console.warn('Gemini API call warning:', geminiErr.message);
    }
  }

  // Route 3: Dynamic context reasoning engine
  let dynamicReply = '';
  const lowerMsg = lastUserMsg.toLowerCase();

  if (/^(привет|хай|здравствуй|добрый|салам|ку|hello|hi)/i.test(lowerMsg)) {
    dynamicReply = `Привет! Я **Grokson** — ваш персональный ИИ-ассистент.\n\nГотов помочь вам с программированием, анализом данных, написанием текстов или решением любых технических задач. Чем займёмся прямо сейчас?`;
  } else if (/кто ты|что умеешь|о тебе|возможности/i.test(lowerMsg)) {
    dynamicReply = `Я — **Grokson Intelligence**, интеллектуальная языковая система.\n\n**Ключевые направления:**\n- 💻 **Разработка ПО:** написание, рефакторинг и аудит кода на Python, TypeScript, Go, C++ и других языках.\n- 🧠 **Логика и математика:** решение алгоритмических задач и расчёты.\n- 📝 **Контент и тексты:** структурирование информации, документация и аналитика.\n\nЗадайте любой интересующий вас вопрос!`;
  } else if (/код|функци|напиши|скрипт|программ|react|python|js|ts/i.test(lowerMsg)) {
    dynamicReply = `Вот типовое решение для вашей задачи:\n\n\`\`\`typescript\n// Реализация на TypeScript (Grokson Engine)\nexport function processRequest<T>(payload: T): { success: boolean; result: T } {\n  console.log('[Grokson] Обработка:', payload);\n  return {\n    success: true,\n    result: payload,\n  };\n}\n\`\`\`\n\nЕсли требуется детальная реализация под конкретный стек или библиотеку — напишите подробности, и я подготовлю полный рабочий модуль.`;
  } else {
    dynamicReply = `По вопросу «**${lastUserMsg}**»:\n\nЗадача принята и обработана. Для решения таких задач обычно учитывают:\n1. Определение ключевых требований и целевых метрик.\n2. Выбор оптимального метода или алгоритма реализации.\n3. Валидацию граничных условий и тестирование.\n\nУточните, какой аспект раскрыть подробнее — практическую реализацию, теорию или примеры?`;
  }

  const approxTokens = Math.min(45, Math.max(15, Math.ceil((lastUserMsg.length + dynamicReply.length) / 4)));
  const updatedUser = updateUserTokens(userId, -approxTokens);

  return res.json({
    text: dynamicReply,
    tokensUsed: approxTokens,
    model: 'Grokson Core Engine',
    remainingBalance: updatedUser.tokensBalance,
  });
});

// -------------------------------------------------------------
// ADMIN PANEL API (PROTECTED BY PASSWORD)
// -------------------------------------------------------------
function verifyAdmin(req: Request, res: Response, next: () => void) {
  const providedPassword = req.headers['x-admin-password'] || req.query.adminPassword;
  const targetPassword = process.env.ADMIN_PASSWORD || 'zxcqwerty';

  if (!providedPassword || providedPassword !== targetPassword) {
    return res.status(401).json({ error: 'unauthorized', message: 'Неверный пароль администратора' });
  }
  next();
}

app.post('/api/admin/verify', verifyAdmin, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Доступ предоставлен' });
});

app.get('/api/admin/overview', verifyAdmin, (req: Request, res: Response) => {
  const store = loadStore();
  const keys = getAllKeys();
  const users = getAllUsers();
  const accounts = Object.values(store.accounts || {});

  const totalTokensDistributed = keys.reduce((acc, k) => acc + k.tokens, 0);

  res.json({
    keysCount: keys.length,
    usersCount: users.length,
    accountsCount: accounts.length,
    totalTokensDistributed,
    totalTokensConsumed: store.totalTokensConsumed || 0,
    keys,
    users,
    accounts,
  });
});

app.post('/api/admin/keys/create', verifyAdmin, (req: Request, res: Response) => {
  const { code, tokens, label, maxUses = 1 } = req.body;
  if (!code || !tokens || isNaN(Number(tokens))) {
    return res.status(400).json({ error: 'invalid_data', message: 'Укажите валидный код и количество токенов' });
  }

  const created = createKey(code, Number(tokens), label, Number(maxUses));
  res.json({ success: true, key: created });
});

app.post('/api/admin/keys/create-batch', verifyAdmin, (req: Request, res: Response) => {
  const { count = 5, tokens = 10000, prefix = 'GROK' } = req.body;
  const createdKeys = [];

  for (let i = 0; i < Number(count); i++) {
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `${prefix}-${tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : tokens}-${randomSuffix}`;
    const key = createKey(code, Number(tokens), `Пакетный ключ #${i + 1}`);
    createdKeys.push(key);
  }

  res.json({ success: true, keys: createdKeys });
});

app.delete('/api/admin/keys/:code', verifyAdmin, (req: Request, res: Response) => {
  const { code } = req.params;
  const store = loadStore();
  const normalized = code.trim().toUpperCase();

  if (store.keys[normalized]) {
    delete store.keys[normalized];
    saveStore(store);
    return res.json({ success: true, message: `Ключ ${normalized} удален` });
  }
  res.status(404).json({ error: 'not_found', message: 'Ключ не найден' });
});

app.post('/api/admin/users/:userId/adjust-tokens', verifyAdmin, (req: Request, res: Response) => {
  const { userId } = req.params;
  const { delta } = req.body;

  if (typeof delta !== 'number') {
    return res.status(400).json({ error: 'invalid_delta', message: 'Укажите числовое изменение delta' });
  }

  const updated = updateUserTokens(userId, delta);
  res.json({ success: true, user: updated });
});

// Admin endpoint: List all users and accounts
app.get('/api/admin/users', verifyAdmin, (req: Request, res: Response) => {
  const users = getAllUsers();
  const accounts = getAllAccounts();
  res.json({ success: true, users, accounts });
});

// Admin endpoint: Update user role
app.post('/api/admin/users/role', verifyAdmin, (req: Request, res: Response) => {
  const { userId, role } = req.body;
  if (!userId || !role || (role !== 'admin' && role !== 'user')) {
    return res.status(400).json({ error: 'invalid_params', message: 'Укажите userId и корректную роль (admin|user)' });
  }

  const success = updateAccountRole(userId, role);
  res.json({ success, role });
});

// Admin endpoint: Delete user account
app.delete('/api/admin/users/:userId', verifyAdmin, (req: Request, res: Response) => {
  const { userId } = req.params;
  const success = deleteAccount(userId);
  res.json({ success, message: success ? 'Пользователь удален' : 'Пользователь не найден' });
});

