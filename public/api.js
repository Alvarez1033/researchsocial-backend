// ─────────────────────────────────────────────────────────────────────────────
//  ResearchSocial — API Client
//  Shared by all pages. Handles auth tokens, refresh, and all API calls.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = '/api';

// ─── Token management ─────────────────────────────────────────────────────────
const Auth = {
  getToken() { return localStorage.getItem('rs_access_token'); },
  getRefresh() { return localStorage.getItem('rs_refresh_token'); },
  setTokens(access, refresh) {
    localStorage.setItem('rs_access_token', access);
    if (refresh) localStorage.setItem('rs_refresh_token', refresh);
  },
  clear() {
    localStorage.removeItem('rs_access_token');
    localStorage.removeItem('rs_refresh_token');
    localStorage.removeItem('rs_user');
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem('rs_user') || 'null'); } catch { return null; }
  },
  setUser(user) { localStorage.setItem('rs_user', JSON.stringify(user)); },
  isLoggedIn() { return !!this.getToken() && !!this.getUser(); }
};

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, opts);

  // Token expired — try refresh once
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch(method, path, body, false);
    Auth.clear();
    // Redirect to login only if not already on a public page
    if (!window.location.pathname.includes('login')) {
      window._authExpired = true;
      document.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function tryRefresh() {
  const refresh = Auth.getRefresh();
  if (!refresh) return false;
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    });
    if (!res.ok) return false;
    const data = await res.json();
    Auth.setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch { return false; }
}

// ─── API methods ──────────────────────────────────────────────────────────────
const API = {
  // Auth
  async register(data) {
    const res = await apiFetch('POST', '/auth/register', data);
    Auth.setTokens(res.accessToken, res.refreshToken);
    Auth.setUser(res.user);
    return res.user;
  },
  async login(email, password) {
    const res = await apiFetch('POST', '/auth/login', { email, password });
    Auth.setTokens(res.accessToken, res.refreshToken);
    Auth.setUser(res.user);
    return res.user;
  },
  async logout() {
    try { await apiFetch('POST', '/auth/logout'); } catch {}
    Auth.clear();
  },
  async me() {
    const user = await apiFetch('GET', '/auth/me');
    Auth.setUser(user);
    return user;
  },

  // Posts
  async getFeed(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch('GET', '/posts' + (q ? '?' + q : ''));
  },
  async getPost(id) { return apiFetch('GET', '/posts/' + id); },
  async createPost(data) { return apiFetch('POST', '/posts', data); },
  async likePost(id) { return apiFetch('POST', '/posts/' + id + '/like'); },
  async bookmarkPost(id) { return apiFetch('POST', '/posts/' + id + '/bookmark'); },
  async getBookmarks(page = 1) { return apiFetch('GET', '/posts/bookmarks?page=' + page); },
  async getComments(postId) { return apiFetch('GET', '/posts/' + postId + '/comments'); },
  async addComment(postId, body, parentId) { return apiFetch('POST', '/posts/' + postId + '/comments', { body, parentId }); },

  // Users
  async getUser(handle) { return apiFetch('GET', '/users/' + handle); },
  async updateProfile(data) { return apiFetch('PATCH', '/users/me', data); },
  async followUser(handle) { return apiFetch('POST', '/users/' + handle + '/follow'); },
  async getNotifications(unreadOnly) { return apiFetch('GET', '/users/me/notifications' + (unreadOnly ? '?unread_only=true' : '')); },
  async markNotificationsRead() { return apiFetch('POST', '/users/me/notifications/read'); },
  async sendCollab(handle, postId, message) { return apiFetch('POST', '/users/' + handle + '/collab', { postId, message }); },

  // Messages
  async getConversations() { return apiFetch('GET', '/messages/conversations'); },
  async getOrCreateConversation(withUserId) { return apiFetch('POST', '/messages/conversations', { withUserId }); },
  async getMessages(convId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch('GET', '/messages/conversations/' + convId + '/messages' + (q ? '?' + q : ''));
  },
  async sendMessage(convId, body) { return apiFetch('POST', '/messages/conversations/' + convId + '/messages', { body }); },

  // Search
  async predict(q) { return apiFetch('GET', '/search/predict?q=' + encodeURIComponent(q)); },
  async search(q, type='all', page=1) { return apiFetch('GET', `/search?q=${encodeURIComponent(q)}&type=${type}&page=${page}`); },
  async searchUsers(params={}) { return apiFetch('GET', '/search/users?' + new URLSearchParams(params).toString()); },

  // Friends
  async getFriends() { return apiFetch('GET', '/friends'); },
  async getFriendRequests() { return apiFetch('GET', '/friends/requests'); },
  async getSentRequests() { return apiFetch('GET', '/friends/sent'); },
  async getFriendStatus(handle) { return apiFetch('GET', '/friends/status/' + handle); },
  async getUserFriends(handle) { return apiFetch('GET', '/friends/' + handle); },
  async sendFriendRequest(handle) { return apiFetch('POST', '/friends/request/' + handle); },
  async acceptFriendRequest(friendshipId) { return apiFetch('POST', '/friends/accept/' + friendshipId); },
  async declineFriendRequest(friendshipId) { return apiFetch('POST', '/friends/decline/' + friendshipId); },
  async removeFriend(handle) { return apiFetch('DELETE', '/friends/' + handle); },
  async cancelFriendRequest(handle) { return apiFetch('DELETE', '/friends/cancel/' + handle); },
  async getFriendFeed(page = 1) { return apiFetch('GET', '/friends/feed/posts?page=' + page); },

  // Tags
  async getTags(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch('GET', '/tags' + (q ? '?' + q : ''));
  },
};

// ─── Socket.io connection ─────────────────────────────────────────────────────
let _socket = null;
function getSocket() {
  if (_socket) return _socket;
  if (typeof io === 'undefined') return null;
  _socket = io({ auth: { token: Auth.getToken() }, reconnection: true, reconnectionDelay: 1000 });
  _socket.on('connect_error', () => {});
  return _socket;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtNum(n) { if (!n) return '0'; return n >= 1000 ? (n/1000).toFixed(1).replace(/\.0$/,'') + 'k' : n; }
function fmtTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff/86400000) + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTimeFull(ts) {
  return new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function avatarSVG(user, size = 40) {
  const u = user || {};
  const color = u.color || '#818cf8';
  const initials = u.initials || (u.name || u.handle || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const r = size / 2;
  const fontSize = Math.round(size * 0.35);
  if (u.avatar_url) {
    return `<img src="${esc(u.avatar_url)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;" alt="${esc(u.name||u.handle)}">`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${color}"/><text x="${r}" y="${r + fontSize*0.35}" text-anchor="middle" font-size="${fontSize}" font-weight="700" fill="white" font-family="Inter,sans-serif">${esc(initials)}</text></svg>`;
}
function profileURL(handle) { return '/profile/' + handle; }
function messagesURL(withHandle) { return '/messages' + (withHandle ? '?with=' + encodeURIComponent(withHandle) : ''); }

// ─── Auth expiry handler ───────────────────────────────────────────────────────
document.addEventListener('auth:expired', () => {
  showAuthModal && showAuthModal();
});

// ─── Toast (shared) ───────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  let t = document.getElementById('rs-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'rs-toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:var(--color-surface,#161b22);border:1px solid var(--color-border,#3d444d);border-radius:12px;padding:10px 18px;font-size:14px;font-weight:500;color:var(--color-text,#e6edf3);box-shadow:0 12px 40px rgba(0,0,0,.5);transform:translateY(12px);opacity:0;transition:all .3s cubic-bezier(0.16,1,0.3,1);pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.transform = 'translateY(0)';
  t.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.transform = 'translateY(12px)'; t.style.opacity = '0'; }, 2800);
}

// ─── Role config (shared frontend) ───────────────────────────────────────────
const ROLE_CONFIG = {
  superadmin:      { label:'Superadmin',      color:'#7c2d12', bg:'rgba(124,45,18,.15)', icon:'👑' },
  admin:           { label:'Admin',           color:'#0369a1', bg:'rgba(3,105,161,.15)', icon:'🛡️' },
  moderator:       { label:'Moderator',       color:'#b45309', bg:'rgba(180,83,9,.15)',  icon:'🔨' },
  support:         { label:'Support',         color:'#6d28d9', bg:'rgba(109,40,217,.15)',icon:'🎧' },
  premium:         { label:'Premium',         color:'#b45309', bg:'rgba(180,83,9,.1)',   icon:'⭐' },
  pro:             { label:'Pro',             color:'#0e7490', bg:'rgba(14,116,144,.15)',icon:'🚀' },
  content_creator: { label:'Content Creator', color:'#7c3aed', bg:'rgba(124,58,237,.15)',icon:'✍️' },
  verified:        { label:'Verified',        color:'#0ea5e9', bg:'rgba(14,165,233,.15)',icon:'✓'  },
  member:          { label:'Member',          color:'#4b5563', bg:'rgba(75,85,99,.1)',   icon:null  },
};

function roleBadgeHTML(role) {
  if (!role || role === 'member') return '';
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.member;
  if (!cfg.icon) return '';
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px;background:${cfg.bg};color:${cfg.color};">${cfg.icon} ${cfg.label}</span>`;
}

// Roles API
const RolesAPI = {
  async getMyPermissions() { return apiFetch('GET', '/roles/my'); },
  async assignRole(userId, role, reason) { return apiFetch('POST', '/roles/assign', { userId, role, reason }); },
  async getRoleHistory(userId) { return apiFetch('GET', '/roles/history/' + userId); },
  async createTicket(subject, body, category) { return apiFetch('POST', '/roles/tickets', { subject, body, category }); },
  async getTickets(status) { return apiFetch('GET', '/roles/tickets' + (status ? '?status=' + status : '')); },
  async getTicket(id) { return apiFetch('GET', '/roles/tickets/' + id); },
  async replyTicket(id, body, isInternal) { return apiFetch('POST', '/roles/tickets/' + id + '/reply', { body, isInternal }); },
};
