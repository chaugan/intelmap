import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
import { useTimelapseStore } from '../../stores/useTimelapseStore.js';
import { t } from '../../lib/i18n.js';

const API = '/api/admin';
const GROUPS_API = '/api/groups';

function formatStorageSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export default function AdminPanel() {
  const adminPanelOpen = useAuthStore((s) => s.adminPanelOpen);
  const setAdminPanelOpen = useAuthStore((s) => s.setAdminPanelOpen);
  const currentUser = useAuthStore((s) => s.user);
  const lang = useMapStore((s) => s.lang);

  const [activeTab, setActiveTab] = useState('users');

  if (!adminPanelOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAdminPanelOpen(false)}>
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-amber-400">{t('admin.title', lang)}</h2>
            <div className="flex gap-1.5 flex-wrap">
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
              <TabButton active={activeTab === 'ais'} onClick={() => setActiveTab('ais')}>
                AIS
              </TabButton>
              <TabButton active={activeTab === 'ntfy'} onClick={() => setActiveTab('ntfy')}>
                ntfy
              </TabButton>
              <TabButton active={activeTab === 'yolo'} onClick={() => setActiveTab('yolo')}>
                YOLO
              </TabButton>
              <TabButton active={activeTab === 'timelapse'} onClick={() => setActiveTab('timelapse')}>
                {lang === 'no' ? 'Tidslapse' : 'Timelapse'}
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
          {activeTab === 'ais' && <AisConfigTab lang={lang} />}
          {activeTab === 'ntfy' && <NtfyConfigTab lang={lang} />}
          {activeTab === 'yolo' && <YoloConfigTab lang={lang} />}
          {activeTab === 'timelapse' && <TimelapseAdminTab lang={lang} />}
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

  async function toggleTimelapse(id) {
    await fetch(`${API}/users/${id}/toggle-timelapse`, { method: 'POST', credentials: 'include' });
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
              <th className="pb-2">{lang === 'no' ? 'Tidslapse' : 'Timelapse'}</th>
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
                  <button onClick={() => toggleTimelapse(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.timelapseEnabled ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.timelapseEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                <td className="py-2">
                  <div className="flex gap-2 flex-wrap">
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

// --- AIS Config Tab ---
function AisConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/ais-config`, { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }

  async function saveCredentials(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!clientId.trim() && !clientSecret.trim()) return;
    try {
      const body = {};
      if (clientId.trim()) body.clientId = clientId.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      const res = await fetch(`${API}/ais-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(body),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setClientId(''); setClientSecret('');
      setStatus(lang === 'no' ? 'Legitimasjon lagret' : 'Credentials saved');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  async function removeCredentials() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/ais-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'Legitimasjon fjernet' : 'Credentials removed');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'AIS-konfigurasjon (BarentsWatch)' : 'AIS Configuration (BarentsWatch)'}
        </h3>

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'Brukes for sanntids AIS-fart\u00f8ysporing. Krever BarentsWatch API-tilgang med AIS-omr\u00e5de.'
            : 'Used for real-time AIS vessel tracking. Requires BarentsWatch API access with AIS scope.'}
        </p>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Client ID:</span>
          <span className={config.hasClientId ? 'text-emerald-400' : 'text-red-400'}>
            {config.hasClientId
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke satt' : 'Not set')}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Client Secret:</span>
          <span className={config.hasClientSecret ? 'text-emerald-400' : 'text-red-400'}>
            {config.hasClientSecret
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke satt' : 'Not set')}
          </span>
        </div>

        <form onSubmit={saveCredentials} className="space-y-2">
          <label className="block text-xs text-slate-400">
            {config.hasClientId && config.hasClientSecret
              ? (lang === 'no' ? 'Erstatt legitimasjon' : 'Replace credentials')
              : (lang === 'no' ? 'Sett legitimasjon' : 'Set credentials')}
          </label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
          />
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client Secret"
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
          />
          <button
            type="submit"
            disabled={!clientId.trim() && !clientSecret.trim()}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            {t('general.save', lang)}
          </button>
        </form>

        {(config.hasClientId || config.hasClientSecret) && (
          <button
            onClick={removeCredentials}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-sm transition-colors"
          >
            {lang === 'no' ? 'Fjern legitimasjon' : 'Remove credentials'}
          </button>
        )}

        {status && <p className="text-emerald-400 text-sm">{status}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

// --- ntfy Config Tab ---
function NtfyConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/ntfy-config`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setUrl(data.url || '');
      }
    } catch {}
  }

  async function saveCredentials(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!url.trim()) {
      setError(lang === 'no' ? 'URL er påkrevd' : 'URL is required');
      return;
    }
    setSaving(true);
    try {
      const body = { url: url.trim() };
      if (token.trim()) body.token = token.trim();
      const res = await fetch(`${API}/ntfy-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setToken('');
      setStatus(data.message || (lang === 'no' ? 'Tilkoblet' : 'Connected'));
      fetchConfig();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function removeCredentials() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/ntfy-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'Innstillinger fjernet' : 'Settings removed');
      setUrl('');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  const isConfigured = !!config.url;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'ntfy Push-varsler' : 'ntfy Push Notifications'}
        </h3>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'Status' : 'Status'}:</span>
          <span className={isConfigured ? 'text-emerald-400' : 'text-slate-500'}>
            {isConfigured
              ? (config.hasToken
                  ? (lang === 'no' ? 'Konfigurert (med autentisering)' : 'Configured (with auth)')
                  : (lang === 'no' ? 'Konfigurert (åpen)' : 'Configured (open)'))
              : (lang === 'no' ? 'Ikke konfigurert' : 'Not configured')}
          </span>
        </div>

        {isConfigured && (
          <div className="text-xs text-slate-400">
            URL: <span className="font-mono text-slate-300">{config.url}</span>
          </div>
        )}

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'ntfy brukes til å sende push-varsler fra serveren. Token er valgfritt hvis serveren tillater åpen tilgang.'
            : 'ntfy is used to send push notifications from the server. Token is optional if the server allows open access.'}
        </p>

        <form onSubmit={saveCredentials} className="space-y-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {lang === 'no' ? 'Server-URL (påkrevd)' : 'Server URL (required)'}
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ntfy.example.com"
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {lang === 'no' ? 'Token (valgfritt)' : 'Token (optional)'}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="tk_..."
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim() || saving}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            {saving
              ? (lang === 'no' ? 'Tester tilkobling...' : 'Testing connection...')
              : (lang === 'no' ? 'Test og lagre' : 'Test & Save')}
          </button>
        </form>

        {isConfigured && (
          <button
            onClick={removeCredentials}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            {lang === 'no' ? 'Fjern innstillinger' : 'Remove settings'}
          </button>
        )}

        {status && <p className="text-emerald-400 text-sm">{status}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

// --- YOLO Config Tab ---
function YoloConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/yolo-config`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setUrl(data.url || '');
        setProjectId(data.projectId || 'fac23eeac522');
      }
    } catch {}
  }

  async function saveCredentials(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!url.trim()) {
      setError(lang === 'no' ? 'URL er påkrevd' : 'URL is required');
      return;
    }
    if (!token.trim()) {
      setError(lang === 'no' ? 'API-token er påkrevd' : 'API token is required');
      return;
    }
    setSaving(true);
    try {
      const body = {
        url: url.trim(),
        token: token.trim(),
        projectId: projectId.trim() || 'fac23eeac522',
      };
      const res = await fetch(`${API}/yolo-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setToken('');
      setStatus(data.message || (lang === 'no' ? 'Konfigurert' : 'Configured'));
      fetchConfig();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function removeCredentials() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/yolo-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'Innstillinger fjernet' : 'Settings removed');
      setUrl('');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  const isConfigured = !!config.url;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'YOLO Objektdeteksjon' : 'YOLO Object Detection'}
        </h3>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'Status' : 'Status'}:</span>
          <span className={isConfigured ? 'text-emerald-400' : 'text-slate-500'}>
            {isConfigured
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke konfigurert' : 'Not configured')}
          </span>
        </div>

        {isConfigured && (
          <>
            <div className="text-xs text-slate-400">
              URL: <span className="font-mono text-slate-300">{config.url}</span>
            </div>
            <div className="text-xs text-slate-400">
              {lang === 'no' ? 'Prosjekt-ID' : 'Project ID'}: <span className="font-mono text-slate-300">{config.projectId}</span>
            </div>
          </>
        )}

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'YOLO brukes til objekt-deteksjon i webcam-bilder for overvåking. Aktiverer Monitorering-fanen i Tidslapse.'
            : 'YOLO is used for object detection in webcam images for monitoring. Enables the Monitoring tab in Timelapse.'}
        </p>

        <form onSubmit={saveCredentials} className="space-y-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {lang === 'no' ? 'Server-URL (påkrevd)' : 'Server URL (required)'}
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yolo.example.com"
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {lang === 'no' ? 'API-token (påkrevd)' : 'API Token (required)'}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={config.hasToken ? '********' : 'Bearer token'}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {lang === 'no' ? 'Prosjekt-ID (valgfritt)' : 'Project ID (optional)'}
            </label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="fac23eeac522"
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim() || !token.trim() || saving}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors disabled:opacity-50"
          >
            {saving
              ? (lang === 'no' ? 'Tester tilkobling...' : 'Testing connection...')
              : (lang === 'no' ? 'Test og lagre' : 'Test & Save')}
          </button>
        </form>

        {isConfigured && (
          <button
            onClick={removeCredentials}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            {lang === 'no' ? 'Fjern innstillinger' : 'Remove settings'}
          </button>
        )}

        {status && <p className="text-emerald-400 text-sm">{status}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

// --- Timelapse Admin Tab ---
function TimelapseAdminTab({ lang }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const mapRef = useMapStore((s) => s.mapRef);
  const userCameras = useTimelapseStore((s) => s.cameras);
  const subscribe = useTimelapseStore((s) => s.subscribe);
  const fetchUserCameras = useTimelapseStore((s) => s.fetchCameras);

  useEffect(() => { fetchCameras(); fetchUserCameras(); }, []);

  async function fetchCameras() {
    setLoading(true);
    try {
      const res = await fetch('/api/timelapse/admin/cameras', { credentials: 'include' });
      if (res.ok) setCameras(await res.json());
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function toggleProtection(cameraId, currentlyProtected) {
    try {
      const res = await fetch(`/api/timelapse/admin/cameras/${cameraId}/protect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isProtected: !currentlyProtected }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update protection');
        return;
      }
      fetchCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCamera(cameraId) {
    try {
      const res = await fetch(`/api/timelapse/admin/cameras/${cameraId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete camera');
        return;
      }
      setDeleteConfirm(null);
      fetchCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addToMine(cam) {
    try {
      await subscribe(cam.cameraId, cam.name, cam.lat, cam.lon);
      fetchUserCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  function zoomToCamera(cam) {
    if (!mapRef || !cam.lat || !cam.lon) return;
    mapRef.flyTo({
      center: [cam.lon, cam.lat],
      zoom: 14,
      duration: 1500,
    });
  }

  // Check if admin is subscribed to a camera
  function isSubscribed(cameraId) {
    return userCameras.some(c => c.cameraId === cameraId);
  }

  if (loading) return <p className="text-slate-400 text-sm">{lang === 'no' ? 'Laster...' : 'Loading...'}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cyan-400">
            {lang === 'no' ? 'Aktive kameraer' : 'Active Cameras'}
          </h3>
          {cameras.length > 0 && (
            <span className="text-sm font-medium text-amber-400">
              {lang === 'no' ? 'Totalt' : 'Total'}: {formatStorageSize(cameras.reduce((sum, c) => sum + (c.storageSize || 0), 0))}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'Beskyttede kameraer slettes ikke av den automatiske 7-dagers oppryddingen.'
            : 'Protected cameras are not deleted by the automatic 7-day cleanup.'}
        </p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {cameras.length === 0 ? (
          <p className="text-slate-500 text-sm">
            {lang === 'no' ? 'Ingen aktive tidslapse-opptak' : 'No active timelapse recordings'}
          </p>
        ) : (
          <div className="space-y-2">
            {cameras.map((cam) => (
              <div key={cam.cameraId} className="flex items-center justify-between bg-slate-800 rounded p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate" title={cam.name || cam.cameraId}>
                    {cam.name || cam.cameraId}
                  </div>
                  <div className="text-xs text-slate-500 space-x-3">
                    <span>
                      {cam.subscriberCount} {lang === 'no' ? 'abonnenter' : 'subscribers'}
                    </span>
                    <span className={cam.isCapturing ? 'text-emerald-400' : 'text-slate-500'}>
                      {cam.isCapturing ? (lang === 'no' ? 'Aktiv' : 'Active') : (lang === 'no' ? 'Inaktiv' : 'Inactive')}
                    </span>
                    <span>
                      {cam.frameCount} {lang === 'no' ? 'bilder' : 'frames'}
                    </span>
                    <span className="text-cyan-400">
                      {formatStorageSize(cam.storageSize)}
                    </span>
                    {cam.lastFrameAt && (
                      <span>
                        {lang === 'no' ? 'Sist' : 'Last'}: {new Date(cam.lastFrameAt).toLocaleTimeString(lang === 'no' ? 'nb-NO' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {/* Zoom to camera */}
                  {cam.lat && cam.lon && (
                    <button
                      onClick={() => zoomToCamera(cam)}
                      className="px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-cyan-400 transition-colors cursor-pointer"
                      title={lang === 'no' ? 'Zoom til kamera' : 'Zoom to camera'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                  {/* Add to my recordings */}
                  {!isSubscribed(cam.cameraId) ? (
                    <button
                      onClick={() => addToMine(cam)}
                      className="px-2 py-1 rounded text-xs bg-emerald-800 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                      title={lang === 'no' ? 'Legg til mine opptak' : 'Add to my recordings'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ) : (
                    <span className="px-2 py-1 rounded text-xs bg-emerald-900/50 text-emerald-400" title={lang === 'no' ? 'Allerede i mine opptak' : 'Already in my recordings'}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  {/* Protection toggle */}
                  <button
                    onClick={() => toggleProtection(cam.cameraId, cam.isProtected)}
                    className={`px-3 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                      cam.isProtected
                        ? 'bg-cyan-700 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                    title={cam.isProtected
                      ? (lang === 'no' ? 'Klikk for å fjerne beskyttelse' : 'Click to remove protection')
                      : (lang === 'no' ? 'Klikk for å beskytte' : 'Click to protect')}
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    {cam.isProtected
                      ? (lang === 'no' ? 'Beskyttet' : 'Protected')
                      : (lang === 'no' ? 'Ubeskyttet' : 'Unprotected')}
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => setDeleteConfirm(cam)}
                    className="px-2 py-1 rounded text-xs bg-red-800 hover:bg-red-700 text-white transition-colors"
                    title={lang === 'no' ? 'Slett tidslapse' : 'Delete timelapse'}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-4 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-3">
              {lang === 'no' ? 'Slett tidslapse' : 'Delete Timelapse'}
            </h3>
            <p className="text-slate-300 mb-2">
              {lang === 'no'
                ? `Er du sikker på at du vil slette tidslapse for "${deleteConfirm.name || deleteConfirm.cameraId}"?`
                : `Are you sure you want to delete the timelapse for "${deleteConfirm.name || deleteConfirm.cameraId}"?`}
            </p>
            {deleteConfirm.subscriberCount > 0 && (
              <p className="text-amber-400 text-sm mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {lang === 'no'
                  ? `${deleteConfirm.subscriberCount} bruker(e) abonnerer på dette kameraet!`
                  : `${deleteConfirm.subscriberCount} user(s) are subscribed to this camera!`}
              </p>
            )}
            <p className="text-slate-500 text-sm mb-4">
              {lang === 'no'
                ? `Dette vil slette ${deleteConfirm.frameCount || 0} bilder og alle abonnementer.`
                : `This will delete ${deleteConfirm.frameCount || 0} frames and all subscriptions.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm transition-colors"
              >
                {lang === 'no' ? 'Avbryt' : 'Cancel'}
              </button>
              <button
                onClick={() => deleteCamera(deleteConfirm.cameraId)}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-white text-sm transition-colors"
              >
                {lang === 'no' ? 'Slett' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
