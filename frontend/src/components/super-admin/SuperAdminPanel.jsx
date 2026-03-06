import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { VERSION } from '../../version.js';

const API = '/api/super-admin';

export default function SuperAdminPanel() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState('orgs');

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-amber-400 tracking-wide">
            IntelMap Super Admin
            <span className="ml-2 text-xs font-normal text-slate-500">v{VERSION}</span>
          </h1>
          <div className="flex gap-1">
            <TabButton active={activeTab === 'orgs'} onClick={() => setActiveTab('orgs')}>
              Organizations
            </TabButton>
            <TabButton active={activeTab === 'admins'} onClick={() => setActiveTab('admins')}>
              Super Admins
            </TabButton>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{user?.username}</span>
          <button
            onClick={() => useAuthStore.getState().setSecurityDialogOpen(true)}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Security
          </button>
          <button
            onClick={logout}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Log out
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'orgs' && <OrganizationsTab />}
        {activeTab === 'admins' && <SuperAdminsTab />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded transition-colors ${
        active
          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function FeatureToggleCell({ on, onClick }) {
  return (
    <td className="px-2 py-2 text-center">
      <button
        onClick={onClick}
        className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
          on ? 'bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
        }`}
      >
        {on ? 'On' : 'Off'}
      </button>
    </td>
  );
}

// --- Organizations Tab ---

function OrganizationsTab() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, permanent }
  const [deleteInput, setDeleteInput] = useState('');
  const [editingOrg, setEditingOrg] = useState(null); // { id, name, slug }
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [expandedOrgId, setExpandedOrgId] = useState(null);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/orgs`, { credentials: 'include' });
      const data = await res.json();
      setOrgs(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const handleCreate = async () => {
    setError('');
    try {
      const res = await fetch(`${API}/orgs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: createName, slug: createSlug }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setShowCreate(false);
      setCreateName('');
      setCreateSlug('');
      fetchOrgs();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSoftDelete = async (id) => {
    try {
      const res = await fetch(`${API}/orgs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      fetchOrgs();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePermanentDelete = async (id) => {
    try {
      const res = await fetch(`${API}/orgs/${id}?permanent=true`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setConfirmDelete(null);
      setDeleteInput('');
      fetchOrgs();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRestore = async (id) => {
    try {
      const res = await fetch(`${API}/orgs/${id}/restore`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      fetchOrgs();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEditing = (org) => {
    setEditingOrg(org);
    setEditName(org.name);
    setEditSlug(org.slug);
  };

  const handleRename = async () => {
    if (!editingOrg || !editName.trim()) return;
    setError('');
    try {
      const res = await fetch(`${API}/orgs/${editingOrg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: editName.trim(), slug: editSlug.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setEditingOrg(null);
      fetchOrgs();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleFeature = async (orgId, feature) => {
    try {
      const res = await fetch(`${API}/orgs/${orgId}/toggle-feature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feature }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      fetchOrgs();
    } catch (err) { setError(err.message); }
  };

  const toggleMfaRequired = async (orgId) => {
    try {
      const res = await fetch(`${API}/orgs/${orgId}/toggle-mfa-required`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      fetchOrgs();
    } catch (err) { setError(err.message); }
  };

  const activeOrgs = orgs.filter(o => !o.deletedAt);
  const deletedOrgs = orgs.filter(o => o.deletedAt);

  if (loading) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-6 max-w-6xl">
      {error && (
        <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-2 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-300 hover:text-white">&times;</button>
        </div>
      )}

      {/* Active Organizations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-200">Organizations ({activeOrgs.length})</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 rounded transition-colors"
          >
            + Create Organization
          </button>
        </div>

        {showCreate && (
          <div className="bg-slate-800 border border-slate-700 rounded p-4 mb-4 space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Organization name"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
                }}
                className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              />
              <input
                type="text"
                placeholder="slug"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-48 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm font-mono"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 rounded">
                Create
              </button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="bg-slate-800 border border-slate-700 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-right px-4 py-2 font-medium">Users</th>
                <th className="text-center px-2 py-2 font-medium text-xs">AI</th>
                <th className="text-center px-2 py-2 font-medium text-xs">WaSOS</th>
                <th className="text-center px-2 py-2 font-medium text-xs">Infra</th>
                <th className="text-center px-2 py-2 font-medium text-xs">Upscale</th>
                <th className="text-center px-2 py-2 font-medium text-xs">MFA</th>
                <th className="text-center px-2 py-2 font-medium text-xs">MFA Req</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeOrgs.map((org) => (
                <React.Fragment key={org.id}>
                <tr className="border-b border-slate-700/50 hover:bg-slate-750">
                  <td className="px-4 py-2 font-medium text-slate-200">
                    {editingOrg?.id === org.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm w-full"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                      />
                    ) : (
                      <button
                        onClick={() => setExpandedOrgId(expandedOrgId === org.id ? null : org.id)}
                        className="hover:text-emerald-400 transition-colors flex items-center gap-1.5"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedOrgId === org.id ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {org.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-400 font-mono">
                    {editingOrg?.id === org.id ? (
                      <input
                        type="text"
                        value={editSlug}
                        onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm font-mono w-full"
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                      />
                    ) : org.slug}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300">{org.userCount}</td>
                  <FeatureToggleCell on={org.featureAiChat} onClick={() => toggleFeature(org.id, 'ai_chat')} />
                  <FeatureToggleCell on={org.featureWasos} onClick={() => toggleFeature(org.id, 'wasos')} />
                  <FeatureToggleCell on={org.featureInfraview} onClick={() => toggleFeature(org.id, 'infraview')} />
                  <FeatureToggleCell on={org.featureUpscale} onClick={() => toggleFeature(org.id, 'upscale')} />
                  <FeatureToggleCell on={org.featureMfa} onClick={() => toggleFeature(org.id, 'mfa')} />
                  <td className="px-2 py-2 text-center">
                    {org.featureMfa ? (
                      <button
                        onClick={() => toggleMfaRequired(org.id)}
                        className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                          org.mfaRequired ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {org.mfaRequired ? 'On' : 'Off'}
                      </button>
                    ) : <span className="text-slate-600 text-xs">-</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      {editingOrg?.id === org.id ? (
                        <>
                          <button onClick={handleRename} className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded">
                            Save
                          </button>
                          <button onClick={() => setEditingOrg(null)} className="px-2 py-1 text-xs bg-slate-700 text-slate-400 hover:bg-slate-600 rounded">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditing(org)}
                            className="px-2 py-1 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => handleSoftDelete(org.id)}
                            className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedOrgId === org.id && (
                  <tr>
                    <td colSpan="11" className="p-0">
                      <OrgUsersPanel orgId={org.id} orgName={org.name} onUserChange={fetchOrgs} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {activeOrgs.length === 0 && (
                <tr><td colSpan="11" className="px-4 py-6 text-center text-slate-500">No organizations</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recycle Bin */}
      {deletedOrgs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-red-400 mb-3">
            Recycle Bin ({deletedOrgs.length})
          </h2>
          <div className="bg-slate-800 border border-red-500/20 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Deleted</th>
                  <th className="text-left px-4 py-2 font-medium">Permanent Delete</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deletedOrgs.map((org) => {
                  const daysLeft = org.deletePermanentlyAt
                    ? Math.max(0, Math.ceil((new Date(org.deletePermanentlyAt) - Date.now()) / (1000 * 60 * 60 * 24)))
                    : '?';
                  return (
                    <tr key={org.id} className="border-b border-slate-700/50 bg-red-500/5">
                      <td className="px-4 py-2 font-medium text-red-300">{org.name}</td>
                      <td className="px-4 py-2 text-slate-400">{new Date(org.deletedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-amber-400">
                        {daysLeft === 0 ? 'Imminent' : `In ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => handleRestore(org.id)}
                            className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ id: org.id, name: org.name, permanent: true })}
                            className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                          >
                            Delete Now
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-slate-800 border border-red-500/30 rounded-lg p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-400">Permanently Delete Organization</h3>
            <p className="text-sm text-slate-300">
              This will permanently delete <strong>{confirmDelete.name}</strong> and all its data (users, projects, themes, timelapse, monitoring).
              This action cannot be undone.
            </p>
            <p className="text-sm text-slate-400">
              Type <span className="font-mono text-red-400">{confirmDelete.name}</span> to confirm:
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              placeholder={confirmDelete.name}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConfirmDelete(null); setDeleteInput(''); }}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePermanentDelete(confirmDelete.id)}
                disabled={deleteInput !== confirmDelete.name}
                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Org Users Panel (expandable under org row) ---

function OrgUsersPanel({ orgId, orgName, onUserChange }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/orgs/${orgId}/users`, { credentials: 'include' });
      if (res.ok) setUsers(await res.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const createUser = async (e) => {
    e.preventDefault();
    setError('');
    if (!newUsername.trim() || !newPassword) { setError('Username and password required'); return; }
    try {
      const res = await fetch(`${API}/orgs/${orgId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setNewUsername(''); setNewPassword(''); setNewRole('user');
      fetchUsers();
      onUserChange?.();
    } catch (err) { setError(err.message); }
  };

  const promoteAdmin = async (userId) => {
    try {
      const res = await fetch(`${API}/orgs/${orgId}/promote-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      fetchUsers();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="bg-slate-900/50 border-t border-slate-700 px-6 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">
          Users in {orgName} ({users.length})
        </h3>
      </div>

      {error && (
        <div className="text-red-400 text-xs">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-300">&times;</button>
        </div>
      )}

      {/* Create user form */}
      <form onSubmit={createUser} className="flex gap-2 items-end">
        <input type="text" placeholder="Username" value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          className="px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm w-40" />
        <input type="password" placeholder="Password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm w-40" />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
          className="px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit"
          className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded transition-colors">
          Create User
        </button>
      </form>

      {/* Users list */}
      {loading ? (
        <div className="text-slate-500 text-xs">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-slate-500 text-xs">No users yet. Create the first admin user above.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-1 pr-4">Username</th>
              <th className="text-left py-1 pr-4">Role</th>
              <th className="text-left py-1 pr-4">Status</th>
              <th className="text-left py-1 pr-4">AI</th>
              <th className="text-left py-1 pr-4">Timelapse</th>
              <th className="text-left py-1 pr-4">WaSOS</th>
              <th className="text-left py-1 pr-4">InfraView</th>
              <th className="text-left py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-700/30">
                <td className="py-1.5 pr-4 text-slate-200">{u.username}</td>
                <td className="py-1.5 pr-4">
                  <span className={u.role === 'admin' ? 'text-amber-400' : 'text-slate-400'}>{u.role}</span>
                </td>
                <td className="py-1.5 pr-4">
                  {u.locked ? <span className="text-red-400">Locked</span>
                    : <span className="text-emerald-400">Active</span>}
                </td>
                <td className="py-1.5 pr-4">
                  <span className={u.aiChatEnabled ? 'text-emerald-400' : 'text-slate-600'}>{u.aiChatEnabled ? 'On' : '-'}</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className={u.timelapseEnabled ? 'text-emerald-400' : 'text-slate-600'}>{u.timelapseEnabled ? 'On' : '-'}</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className={u.wasosEnabled ? 'text-emerald-400' : 'text-slate-600'}>{u.wasosEnabled ? 'On' : '-'}</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className={u.infraviewEnabled ? 'text-emerald-400' : 'text-slate-600'}>{u.infraviewEnabled ? 'On' : '-'}</span>
                </td>
                <td className="py-1.5">
                  {u.role !== 'admin' && (
                    <button onClick={() => promoteAdmin(u.id)}
                      className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded">
                      Make Admin
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --- Super Admins Tab ---

function SuperAdminsTab() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const currentUser = useAuthStore((s) => s.user);

  const fetchAdmins = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admins`, { credentials: 'include' });
      const data = await res.json();
      setAdmins(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleCreate = async () => {
    setError('');
    try {
      const res = await fetch(`${API}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setShowCreate(false);
      setUsername('');
      setPassword('');
      fetchAdmins();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {error && (
        <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-2 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-300 hover:text-white">&times;</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-200">Super Admins ({admins.length})</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 rounded transition-colors"
        >
          + Create Super Admin
        </button>
      </div>

      {showCreate && (
        <div className="bg-slate-800 border border-slate-700 rounded p-4 space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 rounded">
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left px-4 py-2 font-medium">Username</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-right px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.id} className="border-b border-slate-700/50 hover:bg-slate-750">
                <td className="px-4 py-2 text-slate-200 font-medium">
                  {admin.username}
                  {admin.id === currentUser?.id && (
                    <span className="ml-2 text-xs text-amber-400">(you)</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-400">{new Date(admin.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right">
                  <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">super_admin</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
