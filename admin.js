const config = window.APEXSPARC_SUPABASE || {};
const setupNotice = document.querySelector('#setup-notice');
const authPanel = document.querySelector('#auth-panel');
const inbox = document.querySelector('#inbox');
const loginForm = document.querySelector('#login-form');
const loginFeedback = document.querySelector('#login-feedback');
const requestList = document.querySelector('#request-list');
const pageFeedback = document.querySelector('#page-feedback');
const toast = document.querySelector('#toast');
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');
const settingsDialog = document.querySelector('#settings-dialog');
const themeSetting = document.querySelector('#theme-setting');
const pageSizeSetting = document.querySelector('#page-size-setting');
const notificationsSetting = document.querySelector('#notifications-setting');
const pageSizeChoices = [10, 25, 50];
let client = null;
let requests = [];
let filter = 'all';
let query = '';
let page = 0;
let channel = null;
let toastTimer;

function readSetting(key, fallback) {
  try {
    const value = localStorage.getItem(`apex-admin-${key}`);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(`apex-admin-${key}`, value);
  } catch {
    showToast('This browser could not save that preference.');
  }
}

function applyTheme(preference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

themeSetting.value = readSetting('theme', 'system');
pageSizeSetting.value = readSetting('page-size', '10');
notificationsSetting.checked = readSetting('notifications', 'off') === 'on';
applyTheme(themeSetting.value);
themeSetting.addEventListener('change', () => {
  writeSetting('theme', themeSetting.value);
  applyTheme(themeSetting.value);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeSetting.value === 'system') applyTheme('system');
});
pageSizeSetting.addEventListener('change', () => {
  writeSetting('page-size', pageSizeSetting.value);
  page = 0;
  renderRequests();
});
notificationsSetting.addEventListener('change', async () => {
  if (notificationsSetting.checked && !('Notification' in window)) {
    notificationsSetting.checked = false;
    showToast('Desktop notifications are not supported in this browser.');
    return;
  }
  if (notificationsSetting.checked && Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') notificationsSetting.checked = false;
  }
  writeSetting('notifications', notificationsSetting.checked ? 'on' : 'off');
});

document.querySelector('#settings-button').addEventListener('click', () => settingsDialog.showModal());
document.querySelector('#refresh-button').addEventListener('click', loadRequests);
document.querySelector('#sign-out-button').addEventListener('click', async () => {
  if (client) await client.auth.signOut();
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  page = 0;
  document.querySelectorAll('[data-filter]').forEach(option => {
    const active = option === button;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
  renderRequests();
}));
document.querySelector('#search-input').addEventListener('input', event => {
  query = event.target.value.trim().toLowerCase();
  page = 0;
  renderRequests();
});
document.querySelector('#export-button').addEventListener('click', exportRequests);
document.querySelector('#previous-page').addEventListener('click', () => { page -= 1; renderRequests(); });
document.querySelector('#next-page').addEventListener('click', () => { page += 1; renderRequests(); });

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function setConnection(connected, label) {
  connectionDot.classList.toggle('online', connected);
  connectionLabel.textContent = label;
}

function showError(target, message) {
  target.textContent = message;
  target.hidden = false;
}

function setView(view) {
  setupNotice.hidden = view !== 'setup';
  authPanel.hidden = view !== 'login';
  inbox.hidden = view !== 'inbox';
  document.querySelector('#sign-out-button').hidden = view !== 'inbox';
  document.querySelector('#settings-button').hidden = view === 'setup';
  document.querySelector('#refresh-button').hidden = view !== 'inbox';
}

function setCount(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function updateCounts() {
  setCount('total-count', requests.length);
  setCount('new-count', requests.filter(item => item.status === 'new').length);
  setCount('progress-count', requests.filter(item => item.status === 'in_progress').length);
  setCount('closed-count', requests.filter(item => item.status === 'closed').length);
  setCount('filter-all-count', requests.length);
  setCount('filter-new-count', requests.filter(item => item.status === 'new').length);
}

function makeCell(className, text) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function makeContactLink(value, prefix) {
  const link = document.createElement('a');
  link.textContent = value;
  link.href = `${prefix}:${value}`;
  return link;
}

function renderRequest(request) {
  const card = document.createElement('article');
  card.className = 'request-card';
  const main = document.createElement('div');
  main.className = 'request-main';

  const person = makeCell('request-person', '');
  const name = document.createElement('strong');
  name.textContent = request.name || 'Unnamed contact';
  const received = document.createElement('small');
  received.textContent = new Date(request.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  person.append(name, received);

  const contact = makeCell('request-contact primary', '');
  contact.append(makeContactLink(request.email, 'mailto'));
  if (request.phone) {
    const phone = makeContactLink(request.phone, 'tel');
    phone.className = 'secondary';
    contact.append(phone);
  }
  if (request.call_anytime) {
    contact.append(makeCell('secondary', 'Call me anytime'));
  } else if (request.preferred_call_at) {
    contact.append(makeCell('secondary', `Preferred: ${new Date(request.preferred_call_at).toLocaleString()}`));
  }
  if (request.whatsapp_requested) {
    contact.append(makeCell('secondary', 'WhatsApp requested'));
  }
  if (request.whatsapp_requested && request.phone) {
    const whatsapp = document.createElement('a');
    whatsapp.textContent = 'Open WhatsApp';
    whatsapp.href = `https://wa.me/${request.phone.replace(/\D/g, '')}`;
    whatsapp.target = '_blank';
    whatsapp.rel = 'noopener noreferrer';
    contact.append(whatsapp);
  }

  const status = document.createElement('select');
  status.className = 'status-select';
  status.setAttribute('aria-label', `Status for ${request.name || 'contact request'}`);
  for (const [value, label] of [['new', 'New'], ['in_progress', 'In progress'], ['closed', 'Closed']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = request.status === value;
    status.append(option);
  }
  status.addEventListener('change', () => updateStatus(request.id, status.value));

  const tools = document.createElement('div');
  tools.className = 'request-tools';
  const detailsButton = document.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'details-button';
  detailsButton.setAttribute('aria-label', `Show message from ${request.name || 'contact'}`);
  detailsButton.title = 'Show message';
  detailsButton.textContent = '+';
  const message = document.createElement('div');
  message.className = 'request-message';
  message.hidden = true;
  message.textContent = request.message || 'No message provided.';
  detailsButton.addEventListener('click', () => {
    message.hidden = !message.hidden;
    detailsButton.textContent = message.hidden ? '+' : '\u2212';
    detailsButton.title = message.hidden ? 'Show message' : 'Hide message';
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-button';
  deleteButton.setAttribute('aria-label', `Delete request from ${request.name || 'contact'}`);
  deleteButton.title = 'Delete request';
  deleteButton.textContent = '\u00d7';
  deleteButton.addEventListener('click', () => deleteRequest(request));
  tools.append(detailsButton, deleteButton);
  main.append(person, contact, status, tools);
  card.append(main, message);
  return card;
}

function filteredRequests() {
  return requests.filter(request => {
    const matchesFilter = filter === 'all' || request.status === filter;
    const searchable = `${request.name || ''} ${request.email || ''} ${request.phone || ''} ${request.message || ''} ${request.preferred_call_at || ''} ${request.call_anytime ? 'call anytime' : ''} ${request.whatsapp_requested ? 'whatsapp' : ''}`.toLowerCase();
    return matchesFilter && searchable.includes(query);
  });
}

function renderRequests() {
  updateCounts();
  const filtered = filteredRequests();
  const perPage = pageSizeChoices.includes(Number(pageSizeSetting.value)) ? Number(pageSizeSetting.value) : 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  page = Math.min(Math.max(0, page), pageCount - 1);
  requestList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('strong');
    title.textContent = requests.length ? 'No matching requests' : 'No requests yet';
    const copy = document.createElement('p');
    copy.textContent = requests.length ? 'Try another search or status filter.' : 'New contact form submissions will appear here.';
    empty.append(title, copy);
    requestList.append(empty);
  } else {
    filtered.slice(page * perPage, (page + 1) * perPage).forEach(request => requestList.append(renderRequest(request)));
  }

  const pagination = document.querySelector('#pagination');
  pagination.hidden = filtered.length <= perPage;
  document.querySelector('#page-summary').textContent = `${page + 1} of ${pageCount}`;
  document.querySelector('#previous-page').disabled = page === 0;
  document.querySelector('#next-page').disabled = page >= pageCount - 1;
}

async function loadRequests() {
  if (!client) return;
  pageFeedback.hidden = true;
  document.querySelector('#refresh-button').disabled = true;
  const { data, error } = await client.from('contact_requests').select('*').order('created_at', { ascending: false });
  document.querySelector('#refresh-button').disabled = false;
  if (error) {
    showError(pageFeedback, error.message.includes('permission') ? 'This account does not have admin access. Set app_metadata.role to admin in Supabase, then sign in again.' : error.message);
    return;
  }
  requests = data || [];
  renderRequests();
}

async function updateStatus(id, status) {
  const { error } = await client.from('contact_requests').update({ status }).eq('id', id);
  if (error) {
    showToast(`Could not update request: ${error.message}`);
    await loadRequests();
    return;
  }
  requests = requests.map(request => request.id === id ? { ...request, status } : request);
  renderRequests();
  showToast('Request status updated.');
}

async function deleteRequest(request) {
  if (!confirm(`Delete the request from ${request.name || request.email}? This cannot be undone.`)) return;
  const { error } = await client.from('contact_requests').delete().eq('id', request.id);
  if (error) {
    showToast(`Could not delete request: ${error.message}`);
    return;
  }
  requests = requests.filter(item => item.id !== request.id);
  renderRequests();
  showToast('Request deleted.');
}

function exportRequests() {
  const rows = filteredRequests();
  if (!rows.length) {
    showToast('There are no requests to export.');
    return;
  }
  const columns = ['name', 'email', 'phone', 'preferred_call_at', 'call_anytime', 'whatsapp_requested', 'message', 'status', 'created_at'];
  const csv = [columns.join(','), ...rows.map(request => columns.map(column => {
    const value = String(request[column] ?? '').replaceAll('"', '""');
    return `"${value}"`;
  }).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `apexsparc-requests-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function announceNewRequest(request) {
  showToast(`New request from ${request.name || request.email}.`);
  if (notificationsSetting.checked && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('New contact request', { body: `${request.name || request.email} sent a message.` });
  }
}

async function startRealtime() {
  const { data, error } = await client.auth.getSession();
  if (error) {
    setConnection(false, 'Connection error');
    showError(loginFeedback, error.message);
    return;
  }
  if (!data.session) {
    setView('login');
    setConnection(false, 'Sign in required');
    return;
  }
  if (data.session.user.app_metadata?.role !== 'admin') {
    setView('login');
    setConnection(false, 'Admin access required');
    showError(loginFeedback, 'This account is not an admin. Add app_metadata.role = admin in Supabase and sign in again.');
    return;
  }
  setView('inbox');
  setConnection(true, 'Connected');
  await loadRequests();
  channel?.unsubscribe();
  channel = client.channel('contact-requests').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contact_requests' }, payload => {
    if (!requests.some(request => request.id === payload.new.id)) {
      requests.unshift(payload.new);
      renderRequests();
      announceNewRequest(payload.new);
    }
  }).subscribe();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginFeedback.hidden = true;
  const button = loginForm.querySelector('[type="submit"]');
  button.disabled = true;
  const { error } = await client.auth.signInWithPassword({
    email: document.querySelector('#login-email').value.trim(),
    password: document.querySelector('#login-password').value
  });
  button.disabled = false;
  if (error) showError(loginFeedback, error.message);
});

if (!config.url || !config.publishableKey || !window.supabase?.createClient) {
  setView('setup');
  setConnection(false, 'Not connected');
} else {
  client = window.supabase.createClient(config.url, config.publishableKey);
  client.auth.onAuthStateChange(() => { startRealtime(); });
  startRealtime();
}
