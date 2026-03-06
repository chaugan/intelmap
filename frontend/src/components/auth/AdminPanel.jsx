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

function formatUptime(seconds) {
  if (!seconds || seconds === 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
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
              <TabButton active={activeTab === 'vlm'} onClick={() => setActiveTab('vlm')}>
                VLM
              </TabButton>
              <TabButton active={activeTab === 'timelapse'} onClick={() => setActiveTab('timelapse')}>
                {lang === 'no' ? 'Tidslapse' : 'Timelapse'}
              </TabButton>
              <TabButton active={activeTab === 'events'} onClick={() => setActiveTab('events')}>
                {lang === 'no' ? 'Hendelser' : 'Events'}
              </TabButton>
              <TabButton active={activeTab === 'stability'} onClick={() => setActiveTab('stability')}>
                {lang === 'no' ? 'Oppskaler' : 'Upscale'}
              </TabButton>
              <TabButton active={activeTab === 'export'} onClick={() => setActiveTab('export')}>
                {lang === 'no' ? 'Eksport' : 'Export'}
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
          {activeTab === 'vlm' && <VlmConfigTab lang={lang} />}
          {activeTab === 'timelapse' && <TimelapseAdminTab lang={lang} />}
          {activeTab === 'events' && <EventsTab lang={lang} />}
          {activeTab === 'stability' && <StabilityConfigTab lang={lang} />}
          {activeTab === 'export' && <ExportConfigTab lang={lang} />}
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

  async function toggleWasos(id) {
    await fetch(`${API}/users/${id}/toggle-wasos`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function toggleInfraview(id) {
    await fetch(`${API}/users/${id}/toggle-infraview`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function toggleUpscale(id) {
    await fetch(`${API}/users/${id}/toggle-upscale`, { method: 'POST', credentials: 'include' });
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
              <th className="pb-2">WaSOS</th>
              <th className="pb-2">InfraView</th>
              <th className="pb-2">{lang === 'no' ? 'Oppskaler' : 'Upscale'}</th>
              <th className="pb-2">{lang === 'no' ? 'Lagring' : 'Storage'}</th>
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
                  <button onClick={() => toggleWasos(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.wasosEnabled ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.wasosEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                <td className="py-2">
                  <button onClick={() => toggleInfraview(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.infraviewEnabled ? 'bg-indigo-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.infraviewEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                <td className="py-2">
                  <button onClick={() => toggleUpscale(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.upscaleEnabled ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.upscaleEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                <td className="py-2">
                  <div className="text-xs text-slate-400 space-y-0.5">
                    <div title={lang === 'no' ? 'Tidslapse eksporter' : 'Timelapse exports'}>
                      📹 {formatStorageSize(u.timelapseBytes || 0)}
                    </div>
                    <div title={lang === 'no' ? `${u.detectionCount || 0} deteksjonsbilder` : `${u.detectionCount || 0} detection images`}>
                      🔍 {formatStorageSize(u.detectionBytes || 0)}
                    </div>
                  </div>
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

// --- Stability Config Tab ---
function StabilityConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/stability-config`, { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }

  async function saveKey(e) {
    e.preventDefault();
    setError(''); setStatus('');
    if (!newKey.trim()) return;
    try {
      const res = await fetch(`${API}/stability-config`, {
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
      const res = await fetch(`${API}/stability-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'API-n\u00f8kkel fjernet' : 'API key removed');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-orange-400">
          {lang === 'no' ? 'Stability AI Oppskalering' : 'Stability AI Upscale'}
        </h3>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{lang === 'no' ? 'API-n\u00f8kkel' : 'API Key'}:</span>
          <span className={config.hasKey ? 'text-emerald-400' : 'text-red-400'}>
            {config.hasKey
              ? (lang === 'no' ? 'Konfigurert' : 'Configured')
              : (lang === 'no' ? 'Ikke satt' : 'Not set')}
          </span>
        </div>

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
              placeholder="sk-..."
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

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'Brukes til \u00e5 oppskalere webkamerabilder (tidslapse og overv\u00e5king). Maks 1 megapiksel inndata.'
            : 'Used to upscale webcam images (timelapse and monitoring). Max 1 megapixel input.'}
        </p>
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

// --- VLM Config Tab ---
function VlmConfigTab({ lang }) {
  const [config, setConfig] = useState(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Service status state
  const [serviceStatus, setServiceStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Prompt editor state
  const [promptData, setPromptData] = useState(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptStatus, setPromptStatus] = useState('');
  const [promptError, setPromptError] = useState('');

  useEffect(() => { fetchConfig(); fetchPrompt(); }, []);

  async function fetchPrompt() {
    try {
      const res = await fetch(`${API}/vlm-prompt`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPromptData(data);
        setEditedPrompt(data.prompt || data.defaultPrompt);
      }
    } catch {}
  }

  async function savePrompt() {
    setPromptError(''); setPromptStatus('');
    if (!editedPrompt.includes('${labelList}')) {
      setPromptError(lang === 'no' ? 'Prompt må inneholde ${labelList}' : 'Prompt must contain ${labelList}');
      return;
    }
    setPromptSaving(true);
    try {
      const res = await fetch(`${API}/vlm-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: editedPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromptError(data.error);
        return;
      }
      setPromptStatus(lang === 'no' ? 'Prompt lagret' : 'Prompt saved');
      fetchPrompt();
    } catch (err) {
      setPromptError(err.message);
    } finally {
      setPromptSaving(false);
    }
  }

  async function resetPrompt() {
    setPromptError(''); setPromptStatus('');
    try {
      const res = await fetch(`${API}/vlm-prompt`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        setPromptError(data.error);
        return;
      }
      setPromptStatus(lang === 'no' ? 'Prompt tilbakestilt' : 'Prompt reset to default');
      fetchPrompt();
    } catch (err) {
      setPromptError(err.message);
    }
  }

  // Fetch service status when configured
  const fetchServiceStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await fetch(`${API}/vlm-status`, { credentials: 'include' });
      if (res.ok) {
        setServiceStatus(await res.json());
      } else {
        const data = await res.json();
        setStatusError(data.error || 'Failed to fetch status');
        setServiceStatus(null);
      }
    } catch (err) {
      setStatusError(err.message);
      setServiceStatus(null);
    }
    setStatusLoading(false);
  }, []);

  // Auto-refresh status every 30s when configured
  useEffect(() => {
    if (!config?.url || !config?.hasToken) return;
    fetchServiceStatus();
    const interval = setInterval(fetchServiceStatus, 30000);
    return () => clearInterval(interval);
  }, [config?.url, config?.hasToken, fetchServiceStatus]);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/vlm-config`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setUrl(data.url || 'https://vision.homeprem.no');
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
      };
      const res = await fetch(`${API}/vlm-config`, {
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
      const res = await fetch(`${API}/vlm-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'Innstillinger fjernet' : 'Settings removed');
      fetchConfig();
    } catch (err) { setError(err.message); }
  }

  if (!config) return <p className="text-slate-400 text-sm">{t('general.loading', lang)}</p>;

  const isConfigured = !!config.hasToken;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'VLM Bildeanalyse' : 'VLM Image Analysis'}
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
          <div className="text-xs text-slate-400">
            URL: <span className="font-mono text-slate-300">{config.url}</span>
          </div>
        )}

        {/* Prompt Editor Section */}
        {isConfigured && promptData && (
          <div className="mt-4 p-3 bg-slate-800 rounded border border-slate-700">
            <button
              onClick={() => setPromptExpanded(!promptExpanded)}
              className="flex items-center justify-between w-full text-left"
            >
              <h4 className="text-sm font-medium text-cyan-400">
                {lang === 'no' ? 'Prompt-mal' : 'Prompt Template'}
                {promptData.isCustom && <span className="ml-2 text-xs text-amber-400">(custom)</span>}
              </h4>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${promptExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {promptExpanded && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-500">
                  {lang === 'no'
                    ? 'Rediger prompten som sendes til VLM. Bruk ${labelList} der brukerens etiketter skal settes inn.'
                    : 'Edit the prompt sent to VLM. Use ${labelList} where user labels should be inserted.'}
                </p>
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={12}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  placeholder="Prompt template..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={savePrompt}
                    disabled={promptSaving}
                    className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs transition-colors disabled:opacity-50"
                  >
                    {promptSaving ? (lang === 'no' ? 'Lagrer...' : 'Saving...') : (lang === 'no' ? 'Lagre' : 'Save')}
                  </button>
                  {promptData.isCustom && (
                    <button
                      onClick={resetPrompt}
                      className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                    >
                      {lang === 'no' ? 'Tilbakestill' : 'Reset to default'}
                    </button>
                  )}
                </div>
                {promptStatus && <p className="text-emerald-400 text-xs">{promptStatus}</p>}
                {promptError && <p className="text-red-400 text-xs">{promptError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Service Status Section */}
        {isConfigured && (
          <div className="mt-4 p-3 bg-slate-800 rounded border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-cyan-400">{t('vlm.serviceStatus', lang)}</h4>
              <button
                onClick={fetchServiceStatus}
                disabled={statusLoading}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700 disabled:opacity-50"
                title={lang === 'no' ? 'Oppdater' : 'Refresh'}
              >
                <svg className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            {statusError ? (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                {t('vlm.offline', lang)}
              </div>
            ) : serviceStatus ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${serviceStatus.vllmStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                  <span className={serviceStatus.vllmStatus === 'online' ? 'text-emerald-400' : 'text-red-400'}>
                    {serviceStatus.vllmStatus === 'online' ? (lang === 'no' ? 'Tilkoblet' : 'Connected') : (lang === 'no' ? 'Frakoblet' : 'Offline')}
                  </span>
                </div>
                {serviceStatus.model && (
                  <div className="text-slate-400">
                    {lang === 'no' ? 'Modell' : 'Model'}: <span className="text-slate-300 font-mono text-xs">{serviceStatus.model.split('/').pop()}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400 mt-2">
                  <span>{lang === 'no' ? 'Oppetid' : 'Uptime'}:</span>
                  <span className="text-slate-300">{formatUptime(serviceStatus.uptimeSeconds)}</span>
                  <span>{lang === 'no' ? 'Forespørsler' : 'Requests'}:</span>
                  <span className="text-slate-300">{serviceStatus.requestsServed?.toLocaleString() || 0}</span>
                  <span>{lang === 'no' ? 'Genererte tokens' : 'Tokens generated'}:</span>
                  <span className="text-slate-300">{serviceStatus.totalTokensGenerated?.toLocaleString() || 0}</span>
                </div>
                {/* GPU metrics */}
                {serviceStatus.gpu && (
                  <div className="mt-3 p-2 bg-slate-900/50 rounded border border-slate-600">
                    <div className="text-cyan-400 text-xs font-medium mb-2">GPU: {serviceStatus.gpu.name}</div>
                    <div className="space-y-1.5">
                      {/* GPU utilization bar */}
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-0.5">
                          <span>{lang === 'no' ? 'Bruk' : 'Utilization'}</span>
                          <span>{serviceStatus.gpu.utilization}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${serviceStatus.gpu.utilization > 80 ? 'bg-red-500' : serviceStatus.gpu.utilization > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${serviceStatus.gpu.utilization}%` }}
                          />
                        </div>
                      </div>
                      {/* VRAM bar */}
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-0.5">
                          <span>VRAM</span>
                          <span>{(serviceStatus.gpu.memoryUsedMb / 1024).toFixed(1)} / {(serviceStatus.gpu.memoryTotalMb / 1024).toFixed(1)} GB</span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${serviceStatus.gpu.memoryPercent > 90 ? 'bg-red-500' : serviceStatus.gpu.memoryPercent > 75 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                            style={{ width: `${serviceStatus.gpu.memoryPercent}%` }}
                          />
                        </div>
                      </div>
                      {/* Temperature */}
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>{lang === 'no' ? 'Temperatur' : 'Temperature'}</span>
                        <span className={serviceStatus.gpu.temperatureC > 80 ? 'text-red-400' : serviceStatus.gpu.temperatureC > 70 ? 'text-amber-400' : 'text-slate-300'}>
                          {serviceStatus.gpu.temperatureC}°C
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : statusLoading ? (
              <div className="text-slate-400 text-sm">{t('general.loading', lang)}</div>
            ) : null}
          </div>
        )}

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'VLM (Vision Language Model) brukes til bildeanalyse og objektdeteksjon med naturlig språk. Aktiverer overvåking med frie søkeord.'
            : 'VLM (Vision Language Model) is used for image analysis and object detection with natural language. Enables monitoring with custom search terms.'}
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
              placeholder="https://vision.homeprem.no"
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

// --- Events Tab ---
function EventsTab({ lang }) {
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({ error: 0, warning: 0, info: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'error', 'warning', 'info'
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Admin ntfy config state
  const [ntfyConfig, setNtfyConfig] = useState({ channel: '', levels: [], fullUrl: '' });
  const [selectedLevels, setSelectedLevels] = useState([]);
  const [ntfySaving, setNtfySaving] = useState(false);
  const [ntfyMessage, setNtfyMessage] = useState('');

  // Fetch ntfy config
  const fetchNtfyConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin-ntfy-config`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setNtfyConfig(data);
        setSelectedLevels(data.levels || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchNtfyConfig();
  }, [fetchNtfyConfig]);

  async function saveNtfyConfig() {
    setNtfySaving(true);
    setNtfyMessage('');
    try {
      const res = await fetch(`${API}/admin-ntfy-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ levels: selectedLevels }),
      });
      if (res.ok) {
        const data = await res.json();
        setNtfyConfig({ channel: data.channel, levels: data.levels, fullUrl: data.fullUrl });
        setNtfyMessage(lang === 'no' ? 'Lagret' : 'Saved');
        setTimeout(() => setNtfyMessage(''), 2000);
      }
    } catch {}
    setNtfySaving(false);
  }

  async function removeNtfyConfig() {
    try {
      await fetch(`${API}/admin-ntfy-config`, { method: 'DELETE', credentials: 'include' });
      setNtfyConfig({ channel: '', levels: [], fullUrl: '' });
      setSelectedLevels([]);
    } catch {}
  }

  async function testNtfyConfig() {
    setNtfyMessage('');
    try {
      const res = await fetch(`${API}/admin-ntfy-config/test`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        setNtfyMessage(t('admin.ntfyTestSent', lang));
      } else {
        setNtfyMessage(t('admin.ntfyTestFailed', lang));
      }
      setTimeout(() => setNtfyMessage(''), 3000);
    } catch {
      setNtfyMessage(t('admin.ntfyTestFailed', lang));
      setTimeout(() => setNtfyMessage(''), 3000);
    }
  }

  function toggleLevel(level) {
    setSelectedLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  }

  const fetchEvents = useCallback(async () => {
    try {
      const levelParam = filter !== 'all' ? `?level=${filter}` : '';
      const [eventsRes, countsRes] = await Promise.all([
        fetch(`${API}/events${levelParam}`, { credentials: 'include' }),
        fetch(`${API}/events/counts`, { credentials: 'include' }),
      ]);

      if (eventsRes.ok) setEvents(await eventsRes.json());
      if (countsRes.ok) setCounts(await countsRes.json());
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchEvents]);

  async function clearEvents() {
    const levelParam = filter !== 'all' ? `?level=${filter}` : '';
    await fetch(`${API}/events${levelParam}`, { method: 'DELETE', credentials: 'include' });
    fetchEvents();
  }

  function formatTime(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  const levelColors = {
    error: 'bg-red-900/50 border-red-700 text-red-300',
    warning: 'bg-amber-900/50 border-amber-700 text-amber-300',
    info: 'bg-slate-800 border-slate-600 text-slate-300',
  };

  const levelIcons = {
    error: (
      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    info: (
      <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className="space-y-4">
      {/* Admin ntfy notifications config */}
      <div className="bg-slate-900 rounded p-4">
        <h3 className="text-sm font-semibold text-cyan-400 mb-3">
          {t('admin.ntfyChannel', lang)}
        </h3>

        {ntfyConfig.channel ? (
          <>
            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-1">{t('admin.ntfyChannelUrl', lang)}</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={ntfyConfig.fullUrl}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
                  onClick={(e) => e.target.select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(ntfyConfig.fullUrl)}
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700"
                  title="Copy"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-2">{t('admin.ntfyLevels', lang)}</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLevels.includes('error')}
                    onChange={() => toggleLevel('error')}
                    className="w-3.5 h-3.5 accent-red-500"
                  />
                  <span className="text-red-400">{t('admin.ntfyErrors', lang)}</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLevels.includes('warning')}
                    onChange={() => toggleLevel('warning')}
                    className="w-3.5 h-3.5 accent-amber-500"
                  />
                  <span className="text-amber-400">{t('admin.ntfyWarnings', lang)}</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLevels.includes('info')}
                    onChange={() => toggleLevel('info')}
                    className="w-3.5 h-3.5 accent-cyan-500"
                  />
                  <span className="text-cyan-400">{t('admin.ntfyInfo', lang)}</span>
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={saveNtfyConfig}
                disabled={ntfySaving}
                className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white disabled:opacity-50"
              >
                {t('admin.ntfySave', lang)}
              </button>
              <button
                onClick={testNtfyConfig}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white"
              >
                {t('admin.ntfyTest', lang)}
              </button>
              <button
                onClick={removeNtfyConfig}
                className="px-3 py-1 bg-red-900/50 hover:bg-red-800 rounded text-xs text-red-300"
              >
                {t('admin.ntfyRemove', lang)}
              </button>
              {ntfyMessage && (
                <span className="text-xs text-green-400">{ntfyMessage}</span>
              )}
            </div>
          </>
        ) : (
          <button
            onClick={async () => {
              const defaultLevels = ['error', 'warning'];
              setSelectedLevels(defaultLevels);
              setNtfySaving(true);
              try {
                const res = await fetch(`${API}/admin-ntfy-config`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ levels: defaultLevels }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setNtfyConfig({ channel: data.channel, levels: data.levels, fullUrl: data.fullUrl });
                }
              } catch {}
              setNtfySaving(false);
            }}
            disabled={ntfySaving}
            className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white disabled:opacity-50"
          >
            {t('admin.ntfyEnable', lang)}
          </button>
        )}
      </div>

      {/* Header with counts */}
      <div className="bg-slate-900 rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-cyan-400">
            {lang === 'no' ? 'Systemhendelser' : 'System Events'}
          </h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-3 h-3"
              />
              {lang === 'no' ? 'Auto-oppdater' : 'Auto-refresh'}
            </label>
            <button
              onClick={fetchEvents}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700"
              title={lang === 'no' ? 'Oppdater' : 'Refresh'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Counts */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'all' ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {lang === 'no' ? 'Alle' : 'All'} ({counts.error + counts.warning + counts.info})
          </button>
          <button
            onClick={() => setFilter('error')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              filter === 'error' ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {levelIcons.error}
            {lang === 'no' ? 'Feil' : 'Errors'} ({counts.error})
          </button>
          <button
            onClick={() => setFilter('warning')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              filter === 'warning' ? 'bg-amber-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {levelIcons.warning}
            {lang === 'no' ? 'Advarsler' : 'Warnings'} ({counts.warning})
          </button>
          <button
            onClick={() => setFilter('info')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              filter === 'info' ? 'bg-slate-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {levelIcons.info}
            Info ({counts.info})
          </button>
        </div>

        {/* Clear button */}
        {events.length > 0 && (
          <button
            onClick={clearEvents}
            className="text-xs text-red-400 hover:text-red-300"
          >
            {filter === 'all'
              ? (lang === 'no' ? 'Tøm alle hendelser' : 'Clear all events')
              : (lang === 'no' ? `Tøm ${filter}-hendelser` : `Clear ${filter} events`)}
          </button>
        )}
      </div>

      {/* Events list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {loading ? (
          <p className="text-slate-400 text-sm">{lang === 'no' ? 'Laster...' : 'Loading...'}</p>
        ) : events.length === 0 ? (
          <p className="text-slate-500 text-sm">
            {lang === 'no' ? 'Ingen hendelser' : 'No events'}
          </p>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className={`p-3 rounded border ${levelColors[event.level]}`}
            >
              <div className="flex items-start gap-2">
                {levelIcons[event.level]}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium uppercase tracking-wide opacity-60">
                      {event.category}
                    </span>
                    <span className="text-xs opacity-50">
                      {formatTime(event.created_at)}
                    </span>
                  </div>
                  <p className="text-sm">{event.message}</p>
                  {event.details && (
                    <pre className="mt-1 text-xs opacity-70 overflow-x-auto">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const MARKING_OPTIONS = [
  { value: 'none', label: { no: 'Ingen', en: 'None' }, color: null },
  { value: 'internt', label: { no: 'INTERNT', en: 'INTERNT' }, color: '#000000' },
  { value: 'tjenstlig', label: { no: 'TJENSTLIG', en: 'TJENSTLIG' }, color: '#16a34a' },
  { value: 'custom', label: { no: 'Egendefinert', en: 'Custom' }, color: '#1d4ed8' },
];

const CORNER_OPTIONS = [
  { value: 'top-left', label: { no: 'Oppe til venstre', en: 'Top left' } },
  { value: 'top-center', label: { no: 'Oppe i midten', en: 'Top center' } },
  { value: 'top-right', label: { no: 'Oppe til h\u00f8yre', en: 'Top right' } },
  { value: 'bottom-left', label: { no: 'Nede til venstre', en: 'Bottom left' } },
  { value: 'bottom-right', label: { no: 'Nede til h\u00f8yre', en: 'Bottom right' } },
];

function ExportConfigTab({ lang }) {
  const [config, setConfig] = useState({ marking: 'none', corner: 'top-center', customText: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchConfig(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/export-config`, { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }

  async function save() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/export-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(config),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setStatus(lang === 'no' ? 'Innstillinger lagret' : 'Settings saved');
      fetchConfig();
      useAuthStore.getState().checkSession();
    } catch (err) { setError(err.message); }
  }

  async function reset() {
    setError(''); setStatus('');
    try {
      const res = await fetch(`${API}/export-config`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const data = await res.json(); setError(data.error); return; }
      setConfig({ marking: 'none', corner: 'top-center', customText: '' });
      setStatus(lang === 'no' ? 'Innstillinger tilbakestilt' : 'Settings reset');
      useAuthStore.getState().checkSession();
    } catch (err) { setError(err.message); }
  }

  const activeMarking = MARKING_OPTIONS.find((m) => m.value === config.marking);

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 rounded p-4 space-y-4">
        <h3 className="text-sm font-semibold text-amber-400">
          {lang === 'no' ? 'Sikkerhetsmerking p\u00e5 eksport' : 'Security marking on exports'}
        </h3>

        <div className="space-y-2">
          <label className="block text-xs text-slate-400">
            {lang === 'no' ? 'Merking' : 'Marking'}
          </label>
          <div className="flex gap-3">
            {MARKING_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="marking" value={opt.value}
                  checked={config.marking === opt.value}
                  onChange={() => setConfig((c) => ({ ...c, marking: opt.value }))}
                  className="accent-amber-400"
                />
                <span className="text-sm text-white">
                  {opt.color ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm border-2" style={{ borderColor: opt.color, backgroundColor: '#fff' }} />
                      {opt.label[lang] || opt.label.en}
                    </span>
                  ) : (
                    opt.label[lang] || opt.label.en
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>

        {config.marking === 'custom' && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {lang === 'no' ? 'Egendefinert tekst (maks 50 tegn)' : 'Custom text (max 50 chars)'}
            </label>
            <input
              type="text"
              maxLength={50}
              value={config.customText}
              onChange={(e) => setConfig((c) => ({ ...c, customText: e.target.value.replace(/[<>&"'/\\]/g, '') }))}
              placeholder={lang === 'no' ? 'Skriv inn merkingstekst...' : 'Enter marking text...'}
              className="w-full max-w-xs px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        {config.marking !== 'none' && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {lang === 'no' ? 'Plassering' : 'Corner'}
            </label>
            <div className="flex gap-3 flex-wrap">
              {CORNER_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="corner" value={opt.value}
                    checked={config.corner === opt.value}
                    onChange={() => setConfig((c) => ({ ...c, corner: opt.value }))}
                    className="accent-amber-400"
                  />
                  <span className="text-sm text-white">{opt.label[lang] || opt.label.en}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {config.marking !== 'none' && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {lang === 'no' ? 'Forh\u00e5ndsvisning' : 'Preview'}
            </label>
            <div className="relative bg-slate-700 rounded w-full h-32 border border-slate-600">
              <div
                className="absolute px-3 py-1 text-xs font-bold rounded-sm border-2"
                style={{
                  borderColor: activeMarking?.color || '#000',
                  backgroundColor: '#fff',
                  color: '#000',
                  ...(config.corner === 'top-left' ? { top: 8, left: 8 } :
                     config.corner === 'top-center' ? { top: 8, left: '50%', transform: 'translateX(-50%)' } :
                     config.corner === 'top-right' ? { top: 8, right: 8 } :
                     config.corner === 'bottom-left' ? { bottom: 8, left: 8 } :
                     { bottom: 8, right: 8 }),
                }}
              >
                {config.marking === 'custom' ? (config.customText || 'CUSTOM').toUpperCase() : config.marking.toUpperCase()}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}
        {status && <p className="text-emerald-400 text-xs">{status}</p>}

        <div className="flex gap-2">
          <button onClick={save} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">
            {lang === 'no' ? 'Lagre' : 'Save'}
          </button>
          <button onClick={reset} className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded">
            {lang === 'no' ? 'Tilbakestill' : 'Reset'}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          {lang === 'no'
            ? 'Merkingen legges automatisk p\u00e5 alle skjermbilder (unntatt WaSOS-overf\u00f8ringer).'
            : 'Marking is automatically applied to all screenshots (except WaSOS transfers).'}
        </p>
      </div>
    </div>
  );
}
