import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { t } from '../../lib/i18n.js';

const API = '/api/admin';
const GROUPS_API = '/api/groups';

export default function AdminPanel() {
  const adminPanelOpen = useAuthStore((s) => s.adminPanelOpen);
  const setAdminPanelOpen = useAuthStore((s) => s.setAdminPanelOpen);
  const currentUser = useAuthStore((s) => s.user);
  const lang = useMapStore((s) => s.lang);

  const [activeTab, setActiveTab] = useState('users');

  if (!adminPanelOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAdminPanelOpen(false)}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-amber-400">{t('admin.title', lang)}</h2>
            <div className="flex gap-1">
              <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
                {lang === 'no' ? 'Brukere' : 'Users'}
              </TabButton>
              <TabButton active={activeTab === 'groups'} onClick={() => setActiveTab('groups')}>
                {t('groups.title', lang)}
              </TabButton>
              <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>
                AI
              </TabButton>
              <TabButton active={activeTab === 'maps'} onClick={() => setActiveTab('maps')}>
                {lang === 'no' ? 'Kart' : 'Maps'}
              </TabButton>
            </div>
          </div>
          <button onClick={() => setAdminPanelOpen(false)} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'users' && <UsersTab lang={lang} currentUser={currentUser} />}
          {activeTab === 'groups' && <GroupsTab lang={lang} />}
          {activeTab === 'ai' && <AiConfigTab lang={lang} />}
          {activeTab === 'maps' && <MapsConfigTab lang={lang} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-sm transition-colors ${
        active ? 'bg-slate-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// --- Users Tab (same as before) ---
function UsersTab({ lang, currentUser }) {
  const [users, setUsers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [resetPasswordId, setResetPasswordId] = useState(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    try {
      const res = await fetch(`${API}/users`, { credentials: 'include' });
      if (res.ok) setUsers(await res.json());
    } catch {}
  }

  async function createUser(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setNewUsername(''); setNewPassword(''); fetchUsers();
    } catch (err) { setError(err.message); }
  }

  async function deleteUser(id) {
    if (!confirm(t('admin.confirmDelete', lang))) return;
    await fetch(`${API}/users/${id}`, { method: 'DELETE', credentials: 'include' });
    fetchUsers();
  }

  async function toggleAdmin(id) {
    await fetch(`${API}/users/${id}/toggle-admin`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function toggleAiChat(id) {
    await fetch(`${API}/users/${id}/toggle-ai-chat`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function unlockUser(id) {
    await fetch(`${API}/users/${id}/unlock`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function resetPassword(id) {
    if (!resetPasswordVal || resetPasswordVal.length < 6) { setError(t('auth.passwordTooShort', lang)); return; }
    const res = await fetch(`${API}/users/${id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ password: resetPasswordVal }),
    });
    if (res.ok) { setResetPasswordId(null); setResetPasswordVal(''); fetchUsers(); }
    else { const data = await res.json(); setError(data.error); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={createUser} className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">{t('auth.username', lang)}</label>
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
            className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
            placeholder={t('admin.newUsername', lang)} />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">{t('auth.password', lang)}</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
            placeholder={t('admin.tempPassword', lang)} />
        </div>
        <button type="submit" className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors">
          {t('admin.createUser', lang)}
        </button>
      </form>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="pb-2">{t('auth.username', lang)}</th>
              <th className="pb-2">{t('admin.role', lang)}</th>
              <th className="pb-2">{t('admin.status', lang)}</th>
              <th className="pb-2">AI Chat</th>
              <th className="pb-2">{t('admin.actions', lang)}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-700/50">
                <td className="py-2 font-medium">
                  {u.username}
                  {u.id === currentUser?.id && <span className="text-xs text-slate-500 ml-1">({t('admin.you', lang)})</span>}
                </td>
                <td className="py-2">
                  <span className={u.role === 'admin' ? 'text-amber-400' : 'text-slate-300'}>{u.role}</span>
                </td>
                <td className="py-2">
                  {u.locked ? <span className="text-red-400">{t('admin.locked', lang)}</span>
                    : u.mustChangePassword ? <span className="text-amber-400">{t('admin.mustChange', lang)}</span>
                    : <span className="text-emerald-400">{t('admin.active', lang)}</span>}
                </td>
                <td className="py-2">
                  <button onClick={() => toggleAiChat(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.aiChatEnabled ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.aiChatEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                <td className="py-2">
                  <div className="flex gap-1 flex-wrap">
                    {u.id !== currentUser?.id && (
                      <>
                        <button onClick={() => toggleAdmin(u.id)} className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors">
                          {u.role === 'admin' ? t('admin.demote', lang) : t('admin.promote', lang)}
                        </button>
                        {u.locked && (
                          <button onClick={() => unlockUser(u.id)} className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 rounded text-xs transition-colors">
                            {t('admin.unlock', lang)}
                          </button>
                        )}
                        <button onClick={() => setResetPasswordId(resetPasswordId === u.id ? null : u.id)}
                          className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors">
                          {t('admin.resetPassword', lang)}
                        </button>
                        <button onClick={() => deleteUser(u.id)} className="px-2 py-0.5 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors">
                          {t('general.delete', lang)}
                        </button>
                      </>
                    )}
                  </div>
                  {resetPasswordId === u.id && (
                    <div className="flex gap-1 mt-1">
                      <input type="password" value={resetPasswordVal} onChange={(e) => setResetPasswordVal(e.target.value)}
                        placeholder={t('admin.newPassword', lang)}
                        className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-white focus:outline-none" />
                      <button onClick={() => resetPassword(u.id)} className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors">
                        OK
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Groups Tab ---
function GroupsTab({ lang }) {
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [addMemberGroupId, setAddMemberGroupId] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('viewer');

  useEffect(() => {
    fetchGroups();
    fetchUsers();
  }, []);

  async function fetchGroups() {
    try {
      const res = await fetch(GROUPS_API, { credentials: 'include' });
      if (res.ok) setGroups(await res.json());
    } catch {}
  }

  async function fetchUsers() {
    try {
      const res = await fetch(`${API}/users`, { credentials: 'include' });
      if (res.ok) setUsers(await res.json());
    } catch {}
  }

  async function createGroup(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      const res = await fetch(GROUPS_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setNewName(''); fetchGroups();
    } catch (err) { setError(err.message); }
  }

  async function deleteGroup(id) {
    if (!confirm(t('groups.confirmDelete', lang))) return;
    await fetch(`${GROUPS_API}/${id}`, { method: 'DELETE', credentials: 'include' });
    fetchGroups();
  }

  async function addMember(groupId) {
    if (!selectedUserId) return;
    setError('');
    const res = await fetch(`${GROUPS_API}/${groupId}/members`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ userId: selectedUserId, role: selectedRole }),
    });
    if (!res.ok) { const data = await res.json(); setError(data.error); return; }
    setSelectedUserId(''); setAddMemberGroupId(null);
    // Refresh group details
    fetchGroupDetails(groupId);
  }

  async function removeMember(groupId, userId) {
    await fetch(`${GROUPS_API}/${groupId}/members/${userId}`, { method: 'DELETE', credentials: 'include' });
    fetchGroupDetails(groupId);
  }

  async function changeMemberRole(groupId, userId, newRole) {
    await fetch(`${GROUPS_API}/${groupId}/members/${userId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ role: newRole }),
    });
    fetchGroupDetails(groupId);
  }

  const [groupDetails, setGroupDetails] = useState({});

  async function fetchGroupDetails(groupId) {
    const res = await fetch(`${GROUPS_API}/${groupId}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setGroupDetails(prev => ({ ...prev, [groupId]: data }));
    }
  }

  function toggleExpand(groupId) {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
    } else {
      setExpandedGroup(groupId);
      if (!groupDetails[groupId]) fetchGroupDetails(groupId);
    }
  }

  const roleLabels = {
    admin: t('groups.roleAdmin', lang),
    editor: t('groups.roleEditor', lang),
    viewer: t('groups.roleViewer', lang),
  };

  return (
    <div className="space-y-4">
      <form onSubmit={createGroup} className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder={t('groups.name', lang)}
          className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500" />
        <button type="submit" className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors">
          {t('groups.create', lang)}
        </button>
      </form>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {groups.length === 0 && <p className="text-slate-500 text-sm">{t('groups.noGroups', lang)}</p>}

      <div className="space-y-2">
        {groups.map((g) => {
          const expanded = expandedGroup === g.id;
          const details = groupDetails[g.id];

          return (
            <div key={g.id} className="bg-slate-900 rounded overflow-hidden">
              <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => toggleExpand(g.id)}>
                <div>
                  <div className="font-medium text-sm">{g.name}</div>
                  <div className="text-xs text-slate-500">
                    {g.member_count} {t('groups.members', lang).toLowerCase()}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                    className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors">
                    {t('general.delete', lang)}
                  </button>
                  <span className="text-slate-500">{expanded ? '\u25B4' : '\u25BE'}</span>
                </div>
              </div>

              {expanded && details && (
                <div className="px-3 pb-3 space-y-2 border-t border-slate-700">
                  {/* Members */}
                  {details.members?.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2 text-sm py-1">
                      <span className="flex-1">{m.username}</span>
                      <select
                        value={m.role}
                        onChange={(e) => changeMemberRole(g.id, m.user_id, e.target.value)}
                        className="bg-slate-800 border border-slate-600 rounded text-xs px-1 py-0.5"
                      >
                        <option value="admin">{roleLabels.admin}</option>
                        <option value="editor">{roleLabels.editor}</option>
                        <option value="viewer">{roleLabels.viewer}</option>
                      </select>
                      <button onClick={() => removeMember(g.id, m.user_id)}
                        className="text-red-400 hover:text-red-300 text-xs">
                        {'\u2715'}
                      </button>
                    </div>
                  ))}

                  {/* Add member */}
                  {addMemberGroupId === g.id ? (
                    <div className="flex gap-1 items-center">
                      <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded text-xs px-1 py-1">
                        <option value="">-- {lang === 'no' ? 'Velg bruker' : 'Select user'} --</option>
                        {users
                          .filter(u => !details.members?.some(m => m.user_id === u.id))
                          .map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                      </select>
                      <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
                        className="bg-slate-800 border border-slate-600 rounded text-xs px-1 py-1">
                        <option value="admin">{roleLabels.admin}</option>
                        <option value="editor">{roleLabels.editor}</option>
                        <option value="viewer">{roleLabels.viewer}</option>
                      </select>
                      <button onClick={() => addMember(g.id)}
                        className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors">
                        +
                      </button>
                      <button onClick={() => setAddMemberGroupId(null)}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors">
                        {t('general.cancel', lang)}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setAddMemberGroupId(g.id)}
                      className="text-emerald-400 hover:text-emerald-300 text-xs">
                      + {t('groups.addMember', lang)}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- AI Config Tab ---
function AiConfigTab({ lang }) {
  const [aiConfig, setAiConfig] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/ai-config`, { credentials: 'include' });
      if (res.ok) setAiConfig(await res.json());
    } catch {}
  }

  async function saveKey(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!newKey.trim()) return;
    try {
      const res = await fetch(`${API}/ai-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setNewKey('');
      setStatus(lang === 'no' ? 'API-n\u00f8kkel lagret' : 'API key saved');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  async function removeKey() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/ai-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'API-n\u00f8kkel fjernet' : 'API key removed');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!aiConfig) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'AI-konfigurasjon' : 'AI Configuration'}
        </h3>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'Modell' : 'Model'}:</span>
          <span className="text-white font-mono">{aiConfig.model}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'API-n\u00f8kkel' : 'API Key'}:</span>
          <span className={aiConfig.hasKey ? 'text-emerald-400' : 'text-red-400'}>
            {aiConfig.hasKey
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke satt' : 'Not set')}
          </span>
        </div>

        <form onSubmit={saveKey} className="space-y-2">
          <label className="block text-xs text-slate-400">
            {aiConfig.hasKey
              ? (lang === 'no' ? 'Erstatt API-n\u00f8kkel' : 'Replace API key')
              : (lang === 'no' ? 'Sett API-n\u00f8kkel' : 'Set API key')}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!newKey.trim()}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
            >
              {t('general.save', lang)}
            </button>
          </div>
        </form>

        {aiConfig.hasKey && (
          <button
            onClick={removeKey}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-sm transition-colors"
          >
            {lang === 'no' ? 'Fjern API-n\u00f8kkel' : 'Remove API key'}
          </button>
        )}

        {status && <p className="text-emerald-400 text-sm">{status}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

// --- Maps Config Tab ---
function MapsConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/maps-config`, { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }

  async function saveKey(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!newKey.trim()) return;
    try {
      const res = await fetch(`${API}/maps-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setNewKey('');
      setStatus(lang === 'no' ? 'API-n\u00f8kkel lagret' : 'API key saved');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  async function removeKey() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/maps-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'API-n\u00f8kkel fjernet' : 'API key removed');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'Google Maps-konfigurasjon' : 'Google Maps Configuration'}
        </h3>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'API-n\u00f8kkel' : 'API Key'}:</span>
          <span className={config.hasKey ? 'text-emerald-400' : 'text-red-400'}>
            {config.hasKey
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke satt' : 'Not set')}
          </span>
        </div>

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'Brukes for Street View i h\u00f8yreklikk-menyen. Krever Maps Embed API og Street View Static Metadata API aktivert.'
            : 'Used for Street View in the right-click menu. Requires Maps Embed API and Street View Static Metadata API enabled.'}
        </p>

        <form onSubmit={saveKey} className="space-y-2">
          <label className="block text-xs text-slate-400">
            {config.hasKey
              ? (lang === 'no' ? 'Erstatt API-n\u00f8kkel' : 'Replace API key')
              : (lang === 'no' ? 'Sett API-n\u00f8kkel' : 'Set API key')}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="AIza..."
              className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!newKey.trim()}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
            >
              {t('general.save', lang)}
            </button>
          </div>
        </form>

        {config.hasKey && (
          <button
            onClick={removeKey}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-sm transition-colors"
          >
            {lang === 'no' ? 'Fjern API-n\u00f8kkel' : 'Remove API key'}
          </button>
        )}

        {status && <p className="text-emerald-400 text-sm">{status}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}
