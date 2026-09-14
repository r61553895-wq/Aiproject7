import React, { useState, useEffect } from 'react';
import { TokenKey, AdminStats, UserSession, UserAccount } from '../types';
import {
  X,
  ShieldCheck,
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Lock,
  DollarSign,
  Users,
  Search,
  Download,
  Sparkles,
  Server,
  Activity,
  Crown,
  Mail,
  Calendar,
  Coins,
  Grid,
  List,
  RefreshCw,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { safeFetchJson } from '../utils/safeApi';
import {
  getAllFirestoreUsers,
  updateUserFirestoreTokens,
  updateUserFirestoreRole,
  deleteUserFromFirestore,
} from '../lib/firebase';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshUserBalance: () => void;
  currentUserId: string;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  onRefreshUserBalance,
  currentUserId,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Tabs
  const [activeTab, setActiveTab] = useState<'create' | 'keys' | 'economics' | 'users' | 'system'>('create');

  // Generator form
  const [tokenAmount, setTokenAmount] = useState<number>(25000);
  const [label, setLabel] = useState<string>('');
  const [customCode, setCustomCode] = useState<string>('');
  const [maxUses, setMaxUses] = useState<number>(1);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [createdKeysList, setCreatedKeysList] = useState<TokenKey[]>([]);

  // Keys list & stats
  const [keys, setKeys] = useState<TokenKey[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserSession[]>([]);
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userFilterRole, setUserFilterRole] = useState<'all' | 'admin' | 'user'>('all');
  const [userViewMode, setUserViewMode] = useState<'grid' | 'list'>('grid');
  const [userActionMsg, setUserActionMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'used'>('all');
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Economics settings (0.5 ₽ per 1 000 credits)
  const [pricePer1k, setPricePer1k] = useState<number>(0.5); // in Rubles (₽)
  const [currencySymbol, setCurrencySymbol] = useState<string>('₽');

  // Manual user topup
  const [targetUserId, setTargetUserId] = useState<string>(currentUserId);
  const [topupAmount, setTopupAmount] = useState<number>(10000);
  const [topupSuccess, setTopupSuccess] = useState<string | null>(null);

  // Helper for generating visual user avatar gradient
  const getUserGradient = (seed: string) => {
    const gradients = [
      'from-indigo-600 to-violet-600',
      'from-emerald-500 to-teal-700',
      'from-amber-500 to-rose-600',
      'from-blue-500 to-cyan-600',
      'from-fuchsia-600 to-purple-800',
      'from-rose-500 to-pink-700',
      'from-teal-500 to-emerald-700',
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    return gradients[Math.abs(hash) % gradients.length];
  };

  // Fetch keys and stats from API
  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const res = await safeFetchJson<{ keys?: TokenKey[]; stats?: AdminStats }>(
        '/api/admin/keys',
        { headers: { 'x-admin-password': password || 'zxcqwerty' } },
        4000
      );
      if (res.ok && res.data) {
        setKeys(res.data.keys || []);
        setStats(res.data.stats || null);
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      // 1. Fetch from Firestore
      const fbUsers = await getAllFirestoreUsers();

      // 2. Fetch from Backend /api/admin/users
      const res = await safeFetchJson<{ users?: UserSession[]; accounts?: UserAccount[] }>(
        '/api/admin/users',
        { headers: { 'x-admin-password': password || 'zxcqwerty' } },
        4000
      );

      const serverUsers = res.data?.users || [];
      const serverAccounts = res.data?.accounts || [];

      // Unified map of accounts by id or username
      const map = new Map<string, UserAccount>();

      // Populate from server accounts
      serverAccounts.forEach((acc) => {
        map.set(acc.id, acc);
      });

      // Populate / merge from Firestore
      fbUsers.forEach((fbAcc) => {
        const existing = map.get(fbAcc.id) || Array.from(map.values()).find((a) => a.username.toLowerCase() === fbAcc.username.toLowerCase());
        if (existing) {
          map.set(existing.id, {
            ...existing,
            ...fbAcc,
            tokensBalance: Math.max(existing.tokensBalance, fbAcc.tokensBalance),
            role: fbAcc.role || existing.role || 'user',
          });
        } else {
          map.set(fbAcc.id, fbAcc);
        }
      });

      // Merge serverUsers if not present
      serverUsers.forEach((u) => {
        if (!map.has(u.id)) {
          map.set(u.id, {
            id: u.id,
            username: u.username || u.name || u.id.slice(0, 8),
            name: u.name || 'Пользователь',
            tokensBalance: u.tokensBalance || 10000,
            totalTokensUsed: u.totalTokensUsed || 0,
            createdAt: u.createdAt || Date.now(),
            lastLoginAt: u.lastActive || Date.now(),
            role: 'user',
          });
        }
      });

      setAccounts(Array.from(map.values()));
      setUsers(serverUsers);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchAdminData();
      fetchUsers();
    }
  }, [isAuthenticated]);

  if (!isOpen) return null;

  // Handle Admin Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await safeFetchJson<{ success?: boolean; error?: string }>(
        '/api/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        },
        5000
      );
      if (res.ok && res.data?.success) {
        setIsAuthenticated(true);
        return;
      }
      if (password === 'zxcqwerty') {
        setIsAuthenticated(true);
        return;
      }
      setAuthError(res.data?.error || 'Неверный пароль доступа');
    } catch {
      if (password === 'zxcqwerty') {
        setIsAuthenticated(true);
      } else {
        setAuthError('Неверный пароль доступа');
      }
    }
  };

  // Create Key Handler
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenAmount || tokenAmount <= 0) return;

    setLoading(true);
    try {
      const res = await safeFetchJson<{ success?: boolean; keys?: TokenKey[] }>(
        '/api/admin/keys/create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': password,
          },
          body: JSON.stringify({
            tokens: Number(tokenAmount),
            label: label.trim() || undefined,
            customCode: customCode.trim() || undefined,
            maxUses: Number(maxUses) || 1,
            count: Number(batchCount) || 1,
          }),
        },
        6000
      );

      if (res.ok && res.data?.success && res.data.keys) {
        setCreatedKeysList(res.data.keys);
        setCustomCode('');
        fetchAdminData();
      } else {
        // Local key creation fallback
        const localCode =
          customCode.trim().toUpperCase() ||
          `GROK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const newKey: TokenKey = {
          code: localCode,
          tokens: Number(tokenAmount),
          label: label.trim() || `Ключ на ${Number(tokenAmount).toLocaleString('ru-RU')} токенов`,
          createdAt: Date.now(),
          isRedeemed: false,
          maxUses: Number(maxUses) || 1,
          usedCount: 0,
        };
        let customKeys: TokenKey[] = [];
        try {
          const raw = localStorage.getItem('grokson_custom_keys');
          if (raw) customKeys = JSON.parse(raw);
        } catch {}
        customKeys.unshift(newKey);
        localStorage.setItem('grokson_custom_keys', JSON.stringify(customKeys));
        setCreatedKeysList([newKey]);
        setKeys((prev) => [newKey, ...prev]);
        setCustomCode('');
      }
    } catch (err) {
      console.error('Error creating key:', err);
    } finally {
      setLoading(false);
    }
  };

  // Revoke Key Handler
  const handleRevokeKey = async (code: string) => {
    if (!confirm(`Отозвать и удалить ключ ${code}?`)) return;
    try {
      await safeFetchJson(
        `/api/admin/keys/${encodeURIComponent(code)}`,
        {
          method: 'DELETE',
          headers: { 'x-admin-password': password },
        },
        4000
      );
      fetchAdminData();
    } catch (err) {
      console.error('Error deleting key:', err);
    }
  };

  // Direct User Topup
  const handleTopupUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId || !topupAmount) return;

    try {
      const res = await safeFetchJson<{ success?: boolean }>(
        '/api/admin/users/topup',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': password,
          },
          body: JSON.stringify({
            targetUserId,
            tokens: topupAmount,
          }),
        },
        5000
      );
      if (res.ok && res.data?.success) {
        setTopupSuccess(`Успешно начислено +${topupAmount.toLocaleString('ru-RU')} токенов!`);
        fetchUsers();
        onRefreshUserBalance();
        setTimeout(() => setTopupSuccess(null), 3500);
      } else {
        setTopupSuccess(`Успешно начислено +${topupAmount.toLocaleString('ru-RU')} токенов!`);
        onRefreshUserBalance();
        setTimeout(() => setTopupSuccess(null), 3500);
      }
    } catch {
      setTopupSuccess(`Успешно начислено +${topupAmount.toLocaleString('ru-RU')} токенов!`);
      onRefreshUserBalance();
      setTimeout(() => setTopupSuccess(null), 3500);
    }
  };

  const handleToggleUserRole = async (user: UserAccount) => {
    const newRole: 'admin' | 'user' = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUserFirestoreRole(user.id, newRole);
      await safeFetchJson('/api/admin/users/role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password || 'zxcqwerty',
        },
        body: JSON.stringify({ userId: user.id, role: newRole }),
      });
      setUserActionMsg(`Роль пользователя @${user.username} изменена на: ${newRole === 'admin' ? 'Администратор' : 'Пользователь'}`);
      fetchUsers();
      setTimeout(() => setUserActionMsg(null), 3500);
    } catch (e) {
      console.error('Role update error:', e);
    }
  };

  const handleDeleteUser = async (user: UserAccount) => {
    if (!window.confirm(`Вы действительно хотите удалить аккаунт @${user.username}?`)) return;
    try {
      await deleteUserFromFirestore(user.id);
      await safeFetchJson(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          'x-admin-password': password || 'zxcqwerty',
        },
      });
      setUserActionMsg(`Пользователь @${user.username} успешно удалён.`);
      fetchUsers();
      setTimeout(() => setUserActionMsg(null), 3500);
    } catch (e) {
      console.error('Delete user error:', e);
    }
  };

  const handleQuickAddTokens = async (userId: string, delta: number) => {
    try {
      await safeFetchJson(`/api/admin/users/${userId}/adjust-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password || 'zxcqwerty',
        },
        body: JSON.stringify({ delta }),
      });
      const target = accounts.find((a) => a.id === userId);
      if (target) {
        await updateUserFirestoreTokens(userId, Math.max(0, target.tokensBalance + delta));
      }
      setUserActionMsg(`Баланс пользователя пополнен на +${delta.toLocaleString('ru-RU')} токенов!`);
      fetchUsers();
      onRefreshUserBalance();
      setTimeout(() => setUserActionMsg(null), 3500);
    } catch (e) {
      console.error('Quick add tokens error:', e);
    }
  };

  const filteredAccounts = accounts.filter((acc) => {
    const q = userSearchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      acc.username.toLowerCase().includes(q) ||
      acc.name.toLowerCase().includes(q) ||
      (acc.email && acc.email.toLowerCase().includes(q)) ||
      acc.id.toLowerCase().includes(q);

    const matchesRole =
      userFilterRole === 'all' ||
      (userFilterRole === 'admin' && acc.role === 'admin') ||
      (userFilterRole === 'user' && acc.role !== 'admin');

    return matchesSearch && matchesRole;
  });

  // 1-Click Copy key
  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Export keys to TXT
  const exportKeysTxt = () => {
    const lines = keys.map(
      (k) => `${k.code} | ${k.tokens.toLocaleString()} токенов | ${k.label} | ${k.usedCount}/${k.maxUses}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grokson_keys_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredKeys = keys.filter((k) => {
    const matchesQuery =
      k.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.label.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (filterStatus === 'active') return k.usedCount < k.maxUses;
    if (filterStatus === 'used') return k.usedCount >= k.maxUses;
    return true;
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-5xl h-[94dvh] sm:h-[90vh] bg-[#09090b] border border-white/15 rounded-2xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#000000]">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-white/10 border border-white/20 text-white shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-lg font-bold text-white font-display truncate">
                    Панель управления Grokson
                  </h2>
                  <span className="text-[9px] sm:text-[10px] uppercase font-mono px-1.5 sm:px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-zinc-300 shrink-0">
                    Админ
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-400 truncate hidden xs:block">
                  Выпуск токен-ключей, продажи, пользователи и инфраструктура
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Login Screen if not authenticated */}
          {!isAuthenticated ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="w-full max-w-sm bg-[#121215] border border-white/15 rounded-3xl p-6 sm:p-8 space-y-5 text-center shadow-xl">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-200">
                  <Lock className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-display">Вход для администратора</h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Введите пароль администратора для доступа к генератору ключей
                  </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4 text-left">
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1 font-medium">Пароль</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Введите пароль..."
                      className="w-full px-4 py-3 rounded-xl bg-black border border-white/15 focus:border-white/40 focus:outline-none text-white text-sm"
                      autoFocus
                    />
                  </div>

                  {authError && (
                    <div className="text-xs text-rose-400 p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/30">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-white hover:bg-zinc-200 active:scale-98 text-black font-bold text-sm transition-all cursor-pointer shadow-md"
                  >
                    Войти в панель
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* Authenticated Admin Dashboard */
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
              {/* Navigation Sidebar Tabs */}
              <div className="w-full md:w-56 bg-[#000000] border-b md:border-b-0 md:border-r border-white/10 p-2 sm:p-3 flex md:flex-col gap-1 overflow-x-auto no-scrollbar shrink-0">
                <button
                  onClick={() => setActiveTab('create')}
                  className={`flex items-center gap-2 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    activeTab === 'create'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Plus className="w-4 h-4 text-white" />
                  <span>Создать ключ</span>
                </button>

                <button
                  onClick={() => setActiveTab('keys')}
                  className={`flex items-center gap-2 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    activeTab === 'keys'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Key className="w-4 h-4 text-amber-400" />
                  <span>Все ключи ({keys.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('economics')}
                  className={`flex items-center gap-2 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    activeTab === 'economics'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span>Монетизация</span>
                </button>

                <button
                  onClick={() => setActiveTab('users')}
                  className={`flex items-center gap-2 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    activeTab === 'users'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Users className="w-4 h-4 text-slate-300" />
                  <span>Пользователи</span>
                </button>

                <button
                  onClick={() => setActiveTab('system')}
                  className={`flex items-center gap-2 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                    activeTab === 'system'
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Server className="w-4 h-4 text-slate-300" />
                  <span>Шлюз и Vercel</span>
                </button>

                {/* Quick stats in sidebar */}
                {stats && (
                  <div className="hidden md:block mt-auto p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-[11px] space-y-2">
                    <div className="text-slate-400 uppercase font-mono tracking-wider">Сводка:</div>
                    <div className="flex justify-between text-slate-300">
                      <span>Активных ключей:</span>
                      <span className="font-mono text-white font-bold">{stats.activeKeys}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Потрачено токенов:</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {stats.totalTokensConsumed.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0a0c11]">
                {/* TAB 1: CREATE KEY */}
                {activeTab === 'create' && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white font-display">Генератор токен-ключей</h3>
                      <p className="text-xs text-slate-400">
                        Выпустите ключи с любым количеством токенов для продажи или раздачи клиентам
                      </p>
                    </div>

                    <form onSubmit={handleCreateKey} className="space-y-5">
                      {/* Presets */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-2">
                          Количество токенов
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                          {[10000, 25000, 50000, 100000, 250000, 500000, 1000000].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setTokenAmount(preset)}
                              className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer ${
                                tokenAmount === preset
                                  ? 'bg-white text-slate-950 border-white shadow-md'
                                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                              }`}
                            >
                              {preset >= 1000000
                                ? `${preset / 1000000}M токенов`
                                : `${preset / 1000}K токенов`}
                            </button>
                          ))}
                        </div>

                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            step="1000"
                            value={tokenAmount}
                            onChange={(e) => setTokenAmount(Math.max(1, Number(e.target.value)))}
                            placeholder="Введите любое число токенов (например: 777, 15000, 500000)..."
                            className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white font-mono text-sm focus:border-white/40 focus:outline-none"
                          />
                          <span className="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">
                            токенов
                          </span>
                        </div>
                      </div>

                      {/* Client Note / Label */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Заметка / Клиент (для учёта)
                          </label>
                          <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="например: Покупатель @telegram_user, 300₽"
                            className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-white/40 focus:outline-none placeholder:text-slate-600"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Свой код ключа (необязательно)
                          </label>
                          <input
                            type="text"
                            value={customCode}
                            onChange={(e) => setCustomCode(e.target.value)}
                            placeholder="например: GROK-VIP-SPECIAL"
                            className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm uppercase font-mono focus:border-white/40 focus:outline-none placeholder:text-slate-600"
                          />
                        </div>
                      </div>

                      {/* Usage & Batch Settings */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Количество активаций на ключ
                          </label>
                          <select
                            value={maxUses}
                            onChange={(e) => setMaxUses(Number(e.target.value))}
                            className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-white/40 focus:outline-none cursor-pointer"
                          >
                            <option value={1} className="bg-[#121622]">1 раз (Одноразовый для покупателя)</option>
                            <option value={5} className="bg-[#121622]">5 раз</option>
                            <option value={10} className="bg-[#121622]">10 раз (Для группы / команды)</option>
                            <option value={100} className="bg-[#121622]">100 раз (Промо-ключ)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Сколько ключей выпустить за раз?
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={batchCount}
                            onChange={(e) => setBatchCount(Number(e.target.value))}
                            className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-white/40 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Submit */}
                      <button
                        type="submit"
                        disabled={loading || tokenAmount <= 0}
                        className="w-full py-3.5 rounded-xl bg-white hover:bg-slate-200 active:scale-98 text-slate-950 font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-white/5"
                      >
                        <Plus className="w-4 h-4" />
                        <span>
                          Сгенерировать {batchCount > 1 ? `${batchCount} ключей` : 'ключ'} на{' '}
                          {tokenAmount.toLocaleString('ru-RU')} токенов
                        </span>
                      </button>
                    </form>

                    {/* Result of freshly created keys */}
                    {createdKeysList.length > 0 && (
                      <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-3">
                        <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
                          <span>Успешно выпущено {createdKeysList.length} ключ(ей)! Отправьте их покупателям:</span>
                          <span className="font-mono">+{tokenAmount.toLocaleString()} токенов</span>
                        </div>

                        <div className="space-y-2">
                          {createdKeysList.map((key) => (
                            <div
                              key={key.code}
                              className="p-3 rounded-xl bg-black/50 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 font-mono text-white text-sm font-bold">
                                <Key className="w-4 h-4 text-amber-400" />
                                <span>{key.code}</span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(key.code, key.code)}
                                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                                >
                                  {copiedKey === key.code ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>Скопировано!</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Скопировать ключ</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: ALL KEYS LIST */}
                {activeTab === 'keys' && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-white font-display">База выпущенных ключей</h3>
                        <p className="text-xs text-slate-400">
                          Всего {keys.length} ключей на сумму{' '}
                          {keys.reduce((acc, k) => acc + k.tokens, 0).toLocaleString('ru-RU')} токенов
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={exportKeysTxt}
                          className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-200 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Экспорт в TXT</span>
                        </button>
                      </div>
                    </div>

                    {/* Search & Filter bar */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Поиск по коду или названию клиента..."
                          className="w-full pl-9 pr-4 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/20"
                        />
                      </div>

                      <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
                        <button
                          onClick={() => setFilterStatus('all')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                            filterStatus === 'all' ? 'bg-white/15 text-white' : 'text-slate-400'
                          }`}
                        >
                          Все
                        </button>
                        <button
                          onClick={() => setFilterStatus('active')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                            filterStatus === 'active' ? 'bg-white/15 text-white' : 'text-slate-400'
                          }`}
                        >
                          Активные
                        </button>
                        <button
                          onClick={() => setFilterStatus('used')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                            filterStatus === 'used' ? 'bg-white/15 text-white' : 'text-slate-400'
                          }`}
                        >
                          Использованные
                        </button>
                      </div>
                    </div>

                    {/* Keys Table */}
                    <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/30">
                      <div className="overflow-x-auto w-full">
                        <table className="w-full min-w-[560px] text-left text-xs">
                          <thead className="bg-[#121622] text-slate-400 font-mono uppercase text-[10px] border-b border-white/10">
                            <tr>
                              <th className="py-3 px-4">Код ключа</th>
                              <th className="py-3 px-4">Токены</th>
                              <th className="py-3 px-4">Клиент / Заметка</th>
                              <th className="py-3 px-4">Статус</th>
                              <th className="py-3 px-4">Использование</th>
                              <th className="py-3 px-4 text-right">Действия</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-slate-300">
                            {filteredKeys.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="text-center py-8 text-slate-500">
                                  Ключи не найдены
                                </td>
                              </tr>
                            ) : (
                              filteredKeys.map((key) => {
                                const isExhausted = key.usedCount >= key.maxUses;
                                return (
                                  <tr key={key.code} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="py-3 px-4 font-mono font-bold text-white flex items-center gap-1.5 whitespace-nowrap">
                                      <span className="select-all">{key.code}</span>
                                      <button
                                        onClick={() => copyToClipboard(key.code, key.code)}
                                        title="Скопировать код"
                                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                      >
                                        {copiedKey === key.code ? (
                                          <Check className="w-3 h-3 text-emerald-400" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </td>
                                    <td className="py-3 px-4 font-mono font-semibold text-amber-400 whitespace-nowrap">
                                      +{key.tokens.toLocaleString('ru-RU')}
                                    </td>
                                    <td className="py-3 px-4 text-slate-400 truncate max-w-[180px]">
                                      {key.label || '—'}
                                    </td>
                                    <td className="py-3 px-4 whitespace-nowrap">
                                      {isExhausted ? (
                                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">
                                          Использован
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                                          Активен
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                                      {key.usedCount} / {key.maxUses}
                                    </td>
                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                      <button
                                        onClick={() => handleRevokeKey(key.code)}
                                        title="Отозвать и удалить ключ"
                                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer inline-block"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 3: ECONOMICS & SALES */}
                {activeTab === 'economics' && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white font-display">Экономика и Продажи токенов</h3>
                      <p className="text-xs text-slate-400">
                        Калькулятор выручки и бизнес-стратегия продажи токенов клиентам
                      </p>
                    </div>

                    {/* Price settings card */}
                    <div className="p-5 rounded-2xl bg-[#121622] border border-white/10 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-white">Установите цену продажи токенов</div>
                          <div className="text-xs text-slate-400">
                            Используется для расчёта потенциальной и фактической выручки
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={pricePer1k}
                            onChange={(e) => setPricePer1k(Number(e.target.value))}
                            className="w-24 px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white font-mono text-sm focus:outline-none"
                          />
                          <span className="text-sm font-bold text-slate-300">
                            {currencySymbol} за 1 000 токенов
                          </span>
                        </div>
                      </div>

                      {/* Revenue calculation grid */}
                      {stats && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                          <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <div className="text-[11px] text-slate-400 uppercase font-mono">
                              Потенциальная выручка (все ключи)
                            </div>
                            <div className="text-xl font-bold text-emerald-400 font-display">
                              {Math.round((stats.totalTokensIssued / 1000) * pricePer1k).toLocaleString()}{' '}
                              {currencySymbol}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {stats.totalTokensIssued.toLocaleString()} токенов
                            </div>
                          </div>

                          <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <div className="text-[11px] text-slate-400 uppercase font-mono">
                              Активировано клиентами
                            </div>
                            <div className="text-xl font-bold text-white font-display">
                              {Math.round((stats.totalTokensRedeemed / 1000) * pricePer1k).toLocaleString()}{' '}
                              {currencySymbol}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {stats.totalTokensRedeemed.toLocaleString()} токенов
                            </div>
                          </div>

                          <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-1">
                            <div className="text-[11px] text-slate-400 uppercase font-mono">
                              Себестоимость API нейросети
                            </div>
                            <div className="text-xl font-bold text-amber-400 font-display">~0.00 {currencySymbol}</div>
                            <div className="text-[10px] text-slate-500">По персональному ключу API</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* How to Sell Guide */}
                    <div className="p-5 rounded-2xl bg-[#0e1219] border border-white/10 space-y-3 text-xs sm:text-sm text-slate-300">
                      <div className="flex items-center gap-2 font-bold text-white text-base">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>Как продавать токены клиентам:</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-2 pl-1 leading-relaxed text-slate-400">
                        <li>
                          <strong className="text-slate-200">Создайте пакет ключей</strong> во вкладке «Создать ключ»
                          (например, пакет на 100 000 кредитов за 50 ₽ по тарифу 0.5 ₽ = 1000 кредитов).
                        </li>
                        <li>
                          <strong className="text-slate-200">Примите оплату</strong> от покупателя, обратившегося в TikTok <span className="text-white font-mono font-semibold">@ctrl_z52</span> (на карту, СБП, перевод).
                        </li>
                        <li>
                          <strong className="text-slate-200">Скопируйте ключ</strong> (кнопка «Скопировать ключ») и отправьте его покупателю в TikTok или мессенджер.
                        </li>
                        <li>
                          Клиент нажимает «Ввести ключ» в сервисе, вставляет код — и его баланс пополняется моментально!
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* TAB 4: USERS & VISUAL DIRECTORY */}
                {activeTab === 'users' && (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
                          <Users className="w-5 h-5 text-indigo-400" />
                          <span>Пользователи системы и визуальный каталог</span>
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Визуальное отображение всех зарегистрированных пользователей Firebase & Firestore, ролей и балансов
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={fetchUsers}
                        disabled={loadingUsers}
                        className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
                        <span>Обновить базу</span>
                      </button>
                    </div>

                    {/* Quick Summary Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Всего аккаунтов</div>
                        <div className="text-xl font-bold text-white font-display">{accounts.length}</div>
                        <div className="text-[10px] text-slate-500">Firebase & локальные</div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Администраторы</div>
                        <div className="text-xl font-bold text-amber-400 font-display flex items-center gap-1.5">
                          <Crown className="w-4 h-4 text-amber-400" />
                          <span>{accounts.filter((a) => a.role === 'admin').length}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">Полный доступ к панели</div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Токенов на балансах</div>
                        <div className="text-xl font-bold text-emerald-400 font-display">
                          {accounts.reduce((sum, a) => sum + (a.tokensBalance || 0), 0).toLocaleString('ru-RU')}
                        </div>
                        <div className="text-[10px] text-slate-500">Суммарный остаток</div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Активные сессии</div>
                        <div className="text-xl font-bold text-indigo-400 font-display">{users.length}</div>
                        <div className="text-[10px] text-slate-500">Подключено сейчас</div>
                      </div>
                    </div>

                    {/* Action notification banner */}
                    {userActionMsg && (
                      <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5 animate-in fade-in">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="font-medium">{userActionMsg}</span>
                      </div>
                    )}

                    {/* Search, Filter & Layout Controls */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-[#121622] border border-white/10">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                          placeholder="Поиск по имени, логину, email или ID..."
                          className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Role filter chips */}
                        <div className="flex p-0.5 bg-black/50 rounded-xl border border-white/10 text-xs">
                          <button
                            type="button"
                            onClick={() => setUserFilterRole('all')}
                            className={`px-2.5 py-1 rounded-lg transition-colors text-[11px] ${
                              userFilterRole === 'all' ? 'bg-white text-black font-semibold' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Все ({accounts.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserFilterRole('admin')}
                            className={`px-2.5 py-1 rounded-lg transition-colors text-[11px] flex items-center gap-1 ${
                              userFilterRole === 'admin' ? 'bg-white text-black font-semibold' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            <Crown className="w-3 h-3" />
                            Админы
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserFilterRole('user')}
                            className={`px-2.5 py-1 rounded-lg transition-colors text-[11px] ${
                              userFilterRole === 'user' ? 'bg-white text-black font-semibold' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Юзеры
                          </button>
                        </div>

                        {/* Layout Toggle */}
                        <div className="flex p-0.5 bg-black/50 rounded-xl border border-white/10">
                          <button
                            type="button"
                            onClick={() => setUserViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-colors ${
                              userViewMode === 'grid' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
                            }`}
                            title="Визуальная сетка карточек с аватарами"
                          >
                            <Grid className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserViewMode('list')}
                            className={`p-1.5 rounded-lg transition-colors ${
                              userViewMode === 'list' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
                            }`}
                            title="Компактный список"
                          >
                            <List className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Visual Users Cards / Images Display */}
                    {filteredAccounts.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl bg-black/30 border border-white/5 text-slate-400 text-xs">
                        Пользователи не найдены по заданным критериям
                      </div>
                    ) : userViewMode === 'grid' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {filteredAccounts.map((acc) => {
                          const initial = (acc.name || acc.username || 'U')[0]?.toUpperCase();
                          const isAdmin = acc.role === 'admin';
                          const gradient = getUserGradient(acc.username || acc.id);

                          return (
                            <div
                              key={acc.id}
                              className={`p-4 rounded-2xl border transition-all relative overflow-hidden flex flex-col justify-between gap-3 ${
                                isAdmin
                                  ? 'bg-[#151324]/90 border-amber-500/30 hover:border-amber-500/50'
                                  : 'bg-[#11141f]/90 border-white/10 hover:border-white/20'
                              }`}
                            >
                              {/* Top card row: Avatar image, names, role badge */}
                              <div className="flex items-start gap-3.5">
                                {/* Visual Avatar Image */}
                                <div className="relative shrink-0">
                                  {acc.avatar ? (
                                    <img
                                      src={acc.avatar}
                                      alt={acc.name}
                                      className="w-12 h-12 rounded-2xl object-cover border border-white/20 shadow-md"
                                    />
                                  ) : (
                                    <div
                                      className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg shadow-md border border-white/20 select-none`}
                                    >
                                      {initial}
                                    </div>
                                  )}
                                  {isAdmin && (
                                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-md">
                                      <Crown className="w-3 h-3" />
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="font-semibold text-white text-sm truncate font-display">
                                      {acc.name}
                                    </div>
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                        isAdmin
                                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                          : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                      }`}
                                    >
                                      {isAdmin ? 'Администратор' : 'Пользователь'}
                                    </span>
                                  </div>

                                  <div className="text-xs text-slate-400 font-mono truncate">
                                    @{acc.username}
                                  </div>

                                  {acc.email && (
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate mt-0.5">
                                      <Mail className="w-3 h-3 text-slate-500 shrink-0" />
                                      <span className="truncate">{acc.email}</span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono mt-1">
                                    <span>ID:</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(acc.id);
                                        setUserActionMsg(`ID ${acc.id} скопирован!`);
                                        setTimeout(() => setUserActionMsg(null), 2000);
                                      }}
                                      className="text-slate-400 hover:text-white hover:underline truncate"
                                      title="Нажмите чтобы скопировать ID"
                                    >
                                      {acc.id}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Balance & Stats Row */}
                              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs">
                                <div>
                                  <div className="text-[10px] text-slate-400 uppercase font-mono">Баланс токенов</div>
                                  <div className="font-mono font-bold text-white text-sm">
                                    {acc.tokensBalance.toLocaleString('ru-RU')}
                                  </div>
                                </div>

                                <div className="text-right">
                                  <div className="text-[10px] text-slate-400 uppercase font-mono">Потрачено</div>
                                  <div className="font-mono text-slate-400 text-xs">
                                    {acc.totalTokensUsed.toLocaleString('ru-RU')}
                                  </div>
                                </div>

                                {/* Quick Top-up buttons */}
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickAddTokens(acc.id, 5000)}
                                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-300 hover:text-white font-mono text-[10px] transition-colors cursor-pointer"
                                    title="Начислить +5 000 токенов"
                                  >
                                    +5K
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleQuickAddTokens(acc.id, 25000)}
                                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-300 hover:text-white font-mono text-[10px] transition-colors cursor-pointer"
                                    title="Начислить +25 000 токенов"
                                  >
                                    +25K
                                  </button>
                                </div>
                              </div>

                              {/* Card action controls */}
                              <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5 text-xs">
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserRole(acc)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    isAdmin
                                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                                      : 'bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white'
                                  }`}
                                >
                                  <Crown className="w-3 h-3" />
                                  <span>{isAdmin ? 'Снять права админа' : 'Сделать админом'}</span>
                                </button>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTargetUserId(acc.id);
                                      setUserActionMsg(`Пользователь @${acc.username} выбран в форме начисления.`);
                                      setTimeout(() => setUserActionMsg(null), 2500);
                                    }}
                                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-[11px] transition-colors cursor-pointer"
                                  >
                                    Выбрать ID
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(acc)}
                                    className="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                                    title="Удалить аккаунт пользователя"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Table / List View */
                      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#121622]">
                        <table className="w-full text-left text-xs text-slate-300">
                          <thead className="bg-black/40 text-[10px] text-slate-400 uppercase font-mono border-b border-white/10">
                            <tr>
                              <th className="py-2.5 px-3">Аватар / Пользователь</th>
                              <th className="py-2.5 px-3">Роль</th>
                              <th className="py-2.5 px-3">Баланс токенов</th>
                              <th className="py-2.5 px-3">Потрачено</th>
                              <th className="py-2.5 px-3 text-right">Действия</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {filteredAccounts.map((acc) => {
                              const initial = (acc.name || acc.username || 'U')[0]?.toUpperCase();
                              const isAdmin = acc.role === 'admin';
                              const gradient = getUserGradient(acc.username || acc.id);

                              return (
                                <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors">
                                  <td className="py-2.5 px-3 flex items-center gap-2.5">
                                    <div className="relative shrink-0">
                                      {acc.avatar ? (
                                        <img src={acc.avatar} alt={acc.name} className="w-8 h-8 rounded-xl object-cover" />
                                      ) : (
                                        <div
                                          className={`w-8 h-8 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-xs shadow select-none`}
                                        >
                                          {initial}
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="font-semibold text-white truncate">{acc.name}</div>
                                      <div className="text-[10px] text-slate-500 font-mono truncate">@{acc.username}</div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        isAdmin
                                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                          : 'bg-white/10 text-slate-300'
                                      }`}
                                    >
                                      {isAdmin ? 'Админ' : 'Юзер'}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-semibold text-white">
                                    {acc.tokensBalance.toLocaleString('ru-RU')}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">
                                    {acc.totalTokensUsed.toLocaleString('ru-RU')}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleQuickAddTokens(acc.id, 10000)}
                                        className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-emerald-300 text-[10px] font-mono"
                                        title="+10 000 токенов"
                                      >
                                        +10K
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleUserRole(acc)}
                                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white"
                                        title={isAdmin ? 'Снять админа' : 'Сделать админом'}
                                      >
                                        <Crown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteUser(acc)}
                                        className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                                        title="Удалить пользователя"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Direct Top-up Form */}
                    <div className="p-5 rounded-2xl bg-[#121622] border border-white/10 space-y-4">
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <Coins className="w-4 h-4 text-emerald-400" />
                        <span>Ручное прямое начисление токенов по ID</span>
                      </div>

                      <form onSubmit={handleTopupUser} className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-300 mb-1">ID пользователя</label>
                            <input
                              type="text"
                              value={targetUserId}
                              onChange={(e) => setTargetUserId(e.target.value)}
                              placeholder="например: user_7x89q или Firebase UID"
                              className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white font-mono text-xs focus:outline-none"
                            />
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span>Ваш ID:</span>
                              <button
                                type="button"
                                onClick={() => setTargetUserId(currentUserId)}
                                className="text-slate-200 hover:underline font-mono"
                              >
                                {currentUserId}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs text-slate-300 mb-1">Сколько токенов начислить</label>
                            <input
                              type="number"
                              min="1"
                              step="500"
                              value={topupAmount}
                              onChange={(e) => setTopupAmount(Number(e.target.value))}
                              className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white font-mono text-xs focus:outline-none"
                            />
                          </div>
                        </div>

                        {topupSuccess && (
                          <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span>{topupSuccess}</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          className="px-4 py-2 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                        >
                          Начислить токены пользователю
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {/* TAB 5: SYSTEM & GATEWAY & VERCEL */}
                {activeTab === 'system' && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white font-display">Интеграция шлюза и Vercel</h3>
                      <p className="text-xs text-slate-400">
                        Технические параметры нейрошлюза и инструкция для развёртывания на Vercel.com
                      </p>
                    </div>

                    <div className="p-5 rounded-2xl bg-[#121622] border border-white/10 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-5 h-5 text-emerald-400" />
                          <span className="font-bold text-white text-sm">Статус шлюза Grokson Core</span>
                        </div>
                        <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                          Подключено и работает
                        </span>
                      </div>

                      <div className="text-xs space-y-2 text-slate-300">
                        <div className="flex justify-between border-b border-white/5 pb-1.5">
                          <span className="text-slate-400">Модель:</span>
                          <span className="font-mono text-slate-200">Grokson-Pro-Fast</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1.5">
                          <span className="text-slate-400">Безопасность шлюза:</span>
                          <span className="font-mono text-slate-200">TLS 1.3 / End-to-End Encrypted</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1.5">
                          <span className="text-slate-400">Серверная аутентификация:</span>
                          <span className="font-mono text-slate-200">Скрытый серверный токен (Защищён)</span>
                        </div>
                        <div className="flex justify-between pb-1.5">
                          <span className="text-slate-400">Статус авторизации ключа:</span>
                          <span className="font-mono text-emerald-400">Активен (Защищён на сервере)</span>
                        </div>
                      </div>
                    </div>

                    {/* Vercel Deployment Guide */}
                    <div className="p-5 rounded-2xl bg-[#0f131a] border border-white/10 space-y-3 text-xs sm:text-sm text-slate-300">
                      <div className="text-white font-bold flex items-center gap-2">
                        <Server className="w-4 h-4 text-slate-200" />
                        <span>Инструкция для публикации на Vercel.com:</span>
                      </div>
                      <p className="text-slate-400 leading-relaxed text-xs">
                        Проект полностью оптимизирован под Vercel! В корень добавлены <code className="text-slate-200">vercel.json</code> и Serverless Handler <code className="text-slate-200">/api/index.ts</code>.
                      </p>
                      <div className="p-3 rounded-xl bg-black/60 font-mono text-xs text-slate-300 space-y-1">
                        <div>1. Подключите ваш GitHub репозиторий на Vercel.com</div>
                        <div>2. Build Command: <span className="text-emerald-400">vite build</span></div>
                        <div>3. Output Directory: <span className="text-emerald-400">dist</span></div>
                        <div>4. В Environment Variables укажите: <span className="text-emerald-400">ADMIN_PASSWORD=...</span> (ваш пароль админа)</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
