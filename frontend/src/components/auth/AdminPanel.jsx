import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { useMapStore } from '../../stores/useMapStore.js';
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
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 w-[90vw] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
              {currentUser?.orgFeatureAiChat && (
                <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>
                  AI
                </TabButton>
              )}
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
              <TabButton active={activeTab === 'events'} onClick={() => setActiveTab('events')}>
                {lang === 'no' ? 'Hendelser' : 'Events'}
              </TabButton>
              {currentUser?.orgFeatureUpscale && (
                <TabButton active={activeTab === 'stability'} onClick={() => setActiveTab('stability')}>
                  {lang === 'no' ? 'Oppskaler' : 'Upscale'}
                </TabButton>
              )}
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
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [csvImportResult, setCsvImportResult] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
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

  async function toggleSignal(id) {
    await fetch(`${API}/users/${id}/toggle-signal`, { method: 'POST', credentials: 'include' });
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

  async function toggleFireReport(id) {
    await fetch(`${API}/users/${id}/toggle-fire-report`, { method: 'POST', credentials: 'include' });
    fetchUsers();
  }

  async function toggleFiringRange(id) {
    await fetch(`${API}/users/${id}/toggle-firing-range`, { method: 'POST', credentials: 'include' });
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

  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    if (currentUser?.orgFeatureMfa) {
      setMfaRequired(!!currentUser.orgMfaRequired);
    }
  }, [currentUser?.orgFeatureMfa, currentUser?.orgMfaRequired]);

  async function toggleMfaRequired() {
    try {
      const res = await fetch(`${API}/toggle-mfa-required`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMfaRequired(data.required);
      }
    } catch {}
  }

  const totalUsers = users.length;
  const activeUsers = users.filter(u => !u.locked && !u.mustChangePassword && u.lastLoginAt).length;
  const onlineUsers = users.filter(u => u.online).length;

  return (
    <div className="space-y-4">
      {/* Stats header */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-700/50 rounded-lg p-3 text-center border border-slate-600">
          <div className="text-2xl font-bold text-slate-200">{totalUsers}</div>
          <div className="text-xs text-slate-400">{lang === 'no' ? 'Brukere opprettet' : 'Users created'}</div>
        </div>
        <div className="bg-slate-700/50 rounded-lg p-3 text-center border border-slate-600">
          <div className="text-2xl font-bold text-emerald-400">{activeUsers}</div>
          <div className="text-xs text-slate-400">{lang === 'no' ? 'Har logget inn' : 'Have logged in'}</div>
        </div>
        <div className="bg-slate-700/50 rounded-lg p-3 text-center border border-slate-600">
          <div className="text-2xl font-bold text-cyan-400">{onlineUsers}</div>
          <div className="text-xs text-slate-400">{lang === 'no' ? 'Pålogget nå' : 'Online now'}</div>
        </div>
      </div>

      {currentUser?.orgFeatureMfa && (
        <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded border border-slate-600">
          <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="flex-1">
            <span className="text-sm text-slate-200">
              {lang === 'no' ? 'Påkrev MFA for alle brukere' : 'Require MFA for all users'}
            </span>
          </div>
          <button
            onClick={toggleMfaRequired}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              mfaRequired ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {mfaRequired ? (lang === 'no' ? 'Påkrevd' : 'Required') : (lang === 'no' ? 'Av' : 'Off')}
          </button>
        </div>
      )}

      <form onSubmit={createUser} className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">{t('auth.username', lang)}</label>
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
            className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
            placeholder={t('admin.newUsername', lang)} />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">{t('auth.password', lang)}</label>
          <div className="relative">
            <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-2 py-1 pr-8 bg-slate-900 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-emerald-500"
              placeholder={t('admin.tempPassword', lang)} />
            <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
              tabIndex={-1}>
              {showNewPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
        </div>
        <button type="submit" className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors">
          {t('admin.createUser', lang)}
        </button>
      </form>

      {/* CSV Import */}
      <div className="flex items-center gap-2">
        <label className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors cursor-pointer flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
          </svg>
          {lang === 'no' ? 'Importer CSV' : 'Import CSV'}
          <input type="file" accept=".csv,.txt" className="hidden" disabled={csvImporting} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setCsvImporting(true);
            setCsvImportResult(null);
            setError('');
            try {
              const text = await file.text();
              const lines = text.split(/\r?\n/).filter(l => l.trim());
              if (lines.length === 0) { setError('Empty file'); setCsvImporting(false); return; }
              // Detect separator and header
              const sep = lines[0].includes(';') ? ';' : ',';
              const header = lines[0].toLowerCase().split(sep).map(h => h.trim().replace(/^"?(.*?)"?$/, '$1'));
              const userIdx = header.indexOf('user') !== -1 ? header.indexOf('user') : header.indexOf('username');
              const passIdx = header.indexOf('password');
              if (userIdx === -1 || passIdx === -1) { setError(lang === 'no' ? 'CSV må ha "user" og "password" kolonner' : 'CSV must have "user" and "password" columns'); setCsvImporting(false); return; }
              const csvUsers = [];
              for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(sep).map(c => c.trim().replace(/^"?(.*?)"?$/, '$1'));
                if (cols[userIdx] && cols[passIdx]) {
                  csvUsers.push({ user: cols[userIdx], password: cols[passIdx] });
                }
              }
              if (csvUsers.length === 0) { setError(lang === 'no' ? 'Ingen gyldige rader funnet' : 'No valid rows found'); setCsvImporting(false); return; }
              const res = await fetch(`${API}/users/bulk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include', body: JSON.stringify({ users: csvUsers }),
              });
              const data = await res.json();
              if (!res.ok) { setError(data.error); } else { setCsvImportResult(data); fetchUsers(); }
            } catch (err) { setError(err.message); }
            setCsvImporting(false);
            e.target.value = '';
          }} />
        </label>
        {csvImporting && <span className="text-xs text-slate-400">{lang === 'no' ? 'Importerer...' : 'Importing...'}</span>}
        {csvImportResult && (
          <span className="text-xs">
            <span className="text-emerald-400">{csvImportResult.created} {lang === 'no' ? 'opprettet' : 'created'}</span>
            {csvImportResult.skipped > 0 && <span className="text-amber-400"> · {csvImportResult.skipped} {lang === 'no' ? 'hoppet over' : 'skipped'}</span>}
            {csvImportResult.errors?.length > 0 && <span className="text-red-400"> · {csvImportResult.errors.length} {lang === 'no' ? 'feil' : 'errors'}</span>}
          </span>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="pb-2">{t('auth.username', lang)}</th>
              <th className="pb-2">{t('admin.role', lang)}</th>
              <th className="pb-2">{t('admin.status', lang)}</th>
              <th className="pb-2">{lang === 'no' ? 'Sist innlogget' : 'Last login'}</th>
              {currentUser?.orgFeatureAiChat && <th className="pb-2">AI Chat</th>}
              <th className="pb-2">{lang === 'no' ? 'Tidslapse' : 'Timelapse'}</th>
              {currentUser?.orgFeatureWasos && <th className="pb-2">WaSOS</th>}
              {currentUser?.orgFeatureSignal && <th className="pb-2">Signal</th>}
              {currentUser?.orgFeatureInfraview && <th className="pb-2">InfraView</th>}
              {currentUser?.orgFeatureUpscale && <th className="pb-2">{lang === 'no' ? 'Oppskaler' : 'Upscale'}</th>}
              {currentUser?.orgFeatureFireReport && <th className="pb-2">{lang === 'no' ? 'Ildrapport' : 'Fire Report'}</th>}
              {currentUser?.orgFeatureFiringRange && <th className="pb-2">{lang === 'no' ? 'Artilleri' : 'Artillery'}</th>}
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
                    : <span className="text-emerald-400">{t('admin.active', lang)}{u.online && <span className="ml-1.5 inline-flex items-center"><span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title={lang === 'no' ? 'Pålogget nå' : 'Online now'} /></span>}</span>}
                </td>
                <td className="py-2 text-xs text-slate-400">
                  {u.lastLoginAt ? new Date(u.lastLoginAt + 'Z').toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : <span className="text-slate-600">{lang === 'no' ? 'Aldri' : 'Never'}</span>}
                </td>
                {currentUser?.orgFeatureAiChat && (
                  <td className="py-2">
                    <button onClick={() => toggleAiChat(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.aiChatEnabled ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.aiChatEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                <td className="py-2">
                  <button onClick={() => toggleTimelapse(u.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${u.timelapseEnabled ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {u.timelapseEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                  </button>
                </td>
                {currentUser?.orgFeatureWasos && (
                  <td className="py-2">
                    <button onClick={() => toggleWasos(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.wasosEnabled ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.wasosEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                {currentUser?.orgFeatureSignal && (
                  <td className="py-2">
                    <button onClick={() => toggleSignal(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.signalEnabled ? 'bg-blue-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.signalEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                {currentUser?.orgFeatureInfraview && (
                  <td className="py-2">
                    <button onClick={() => toggleInfraview(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.infraviewEnabled ? 'bg-indigo-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.infraviewEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                {currentUser?.orgFeatureUpscale && (
                  <td className="py-2">
                    <button onClick={() => toggleUpscale(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.upscaleEnabled ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.upscaleEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                {currentUser?.orgFeatureFireReport && (
                  <td className="py-2">
                    <button onClick={() => toggleFireReport(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.fireReportEnabled ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.fireReportEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
                {currentUser?.orgFeatureFiringRange && (
                  <td className="py-2">
                    <button onClick={() => toggleFiringRange(u.id)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${u.firingRangeEnabled ? 'bg-amber-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {u.firingRangeEnabled ? t('admin.enabled', lang) : t('admin.disabled', lang)}
                    </button>
                  </td>
                )}
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

  async function toggleAutoAdd(groupId, currentValue) {
    await fetch(`${GROUPS_API}/${groupId}/auto-add`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ enabled: !currentValue }),
    });
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
                <div className="flex gap-2 items-center">
                  <label className="flex items-center gap-1 text-xs text-slate-400" onClick={(e) => e.stopPropagation()}
                    title={lang === 'no' ? 'Legg automatisk til nye brukere i denne gruppen' : 'Automatically add new users to this group'}>
                    <input type="checkbox" checked={!!g.auto_add_users}
                      onChange={() => toggleAutoAdd(g.id, g.auto_add_users)}
                      className="accent-emerald-500" />
                    {lang === 'no' ? 'Auto' : 'Auto'}
                  </label>
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
  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);

  useEffect(() => { fetchConfig(); fetchImages(); }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/stability-config`, { credentials: 'include' });
      if (res.ok) setConfig(await res.json());
    } catch {}
  }

  async function fetchImages() {
    setImagesLoading(true);
    try {
      const res = await fetch(`${API}/upscaled-images`, { credentials: 'include' });
      if (res.ok) setImages(await res.json());
    } catch {}
    setImagesLoading(false);
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

  async function deleteImage(id) {
    try {
      const res = await fetch(`${API}/upscaled-images/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setImages(prev => prev.filter(img => img.id !== id));
    } catch {}
  }

  async function deleteAllImages() {
    if (!confirm(lang === 'no' ? 'Slett alle oppskalerte bilder?' : 'Delete all upscaled images?')) return;
    try {
      const res = await fetch(`${API}/upscaled-images`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setImages([]);
    } catch {}
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

      {/* Upscaled images management */}
      <div className="bg-slate-900 rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-orange-400">
            {lang === 'no' ? 'Oppskalerte bilder' : 'Upscaled Images'}
            {images.length > 0 && <span className="text-slate-500 font-normal ml-2">({images.length})</span>}
          </h3>
          {images.length > 0 && (
            <button
              onClick={deleteAllImages}
              className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors"
            >
              {lang === 'no' ? 'Slett alle' : 'Delete all'}
            </button>
          )}
        </div>

        {imagesLoading ? (
          <p className="text-slate-500 text-sm">{t('general.loading', lang)}</p>
        ) : images.length === 0 ? (
          <p className="text-slate-500 text-sm">
            {lang === 'no' ? 'Ingen oppskalerte bilder' : 'No upscaled images'}
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {images.map((img) => (
              <div key={img.id} className="flex items-center justify-between py-1.5 px-2 bg-slate-800 rounded text-sm">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${img.source_type === 'timelapse' ? 'bg-cyan-900 text-cyan-300' : 'bg-violet-900 text-violet-300'}`}>
                    {img.source_type === 'timelapse' ? 'TL' : 'DET'}
                  </span>
                  <span className="text-slate-300 truncate" title={img.source_key}>{img.source_key}</span>
                  <span className="text-slate-500 text-xs shrink-0">{img.username}</span>
                  <span className="text-slate-600 text-xs shrink-0">
                    {new Date(img.created_at).toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <a
                    href={`/api/upscale/image/${img.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                    title={lang === 'no' ? 'Vis' : 'View'}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </a>
                  <button
                    onClick={() => deleteImage(img.id)}
                    className="px-1.5 py-0.5 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors"
                    title={t('general.delete', lang)}
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
