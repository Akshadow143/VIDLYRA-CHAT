
import '../css/style.css';
import { supabase } from './supabase.js';

const app = document.querySelector('#app');

let currentEmail = '';
let currentUser = null;
let busy = false;

let selectedAvatarFile = null;
let selectedCoverFile = null;
let selectedAvatarUrl = null;

const ANIME_AVATARS = [
  '/avatars/avatar-01.png',
  '/avatars/avatar-02.png',
  '/avatars/avatar-03.png',
  '/avatars/avatar-04.png',
  '/avatars/avatar-05.png',
  '/avatars/avatar-06.png',
  '/avatars/avatar-07.png',
  '/avatars/avatar-08.png'
];
let existingAvatarUrl = null;
let existingCoverUrl = null;

let removeAvatarImage = false;
let removeCoverImage = false;

let authSubscription = null;

// ========================================
// UTILITIES
// ========================================

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

/* ========================================
   VIDLYRA CHAT - MEDIA SHARING
======================================== */

const CHAT_MEDIA_BUCKET = 'chat-media';
const CHAT_MEDIA_MAX_SIZE = 10 * 1024 * 1024;

const CHAT_MEDIA_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'text/plain': 'txt'
};
const CHAT_MEDIA_ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain'
];
function formatMediaSize(bytes) {
    if (!bytes || bytes < 0) return '0 KB';
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

let selectedChatMediaFile = null;
let selectedGroupMediaFile = null;

function validateChatMedia(file) {
    if (!file) {
        return { valid: false, message: 'Please select a file.' };
    }

    if (file.size > CHAT_MEDIA_MAX_SIZE) {
        return { valid: false, message: 'Maximum file size is 10 MB.' };
    }

    if (!CHAT_MEDIA_ALLOWED_TYPES.includes(file.type)) {
        return { valid: false, message: 'Unsupported file type.' };
    }

    return { valid: true, message: '' };
}
function showSelectedMedia(file, previewId) {
    const preview = document.querySelector(`#${previewId}`);
    if (!preview) return;

    if (!file) {
        const oldUrl = preview.dataset.previewUrl;
        if (oldUrl) URL.revokeObjectURL(oldUrl);

        preview.dataset.previewUrl = '';
        preview.innerHTML = '';
        preview.hidden = true;
        return;
    }

    preview.hidden = false;

    const isImage = file.type.startsWith('image/');
    let imagePreview = '';

    if (isImage) {
        const oldUrl = preview.dataset.previewUrl;
        if (oldUrl) URL.revokeObjectURL(oldUrl);

        const imageUrl = URL.createObjectURL(file);
        preview.dataset.previewUrl = imageUrl;

        imagePreview = `
            <img src="${imageUrl}"
                 class="chat-selected-image"
                 alt="Selected image preview">
        `;
    }

    preview.innerHTML = `
        ${imagePreview}
        <div class="chat-selected-file-info">
            <span>📎 ${escapeHTML(file.name)}</span>
            <small>${formatMediaSize(file.size)}</small>
        </div>

        <button type="button"
                class="media-clear-btn"
                data-clear-media="${previewId}">
            Remove ✕
        </button>
    `;

    preview.querySelector('[data-clear-media]')
        .addEventListener('click', () => {
            if (previewId === 'chatAttachmentPreview') {
                selectedChatMediaFile = null;
                const input = document.querySelector('#chatMediaInput');
                if (input) input.value = '';
            } else {
                selectedGroupMediaFile = null;
                const input = document.querySelector('#groupMediaInput');
                if (input) input.value = '';
            }

            showSelectedMedia(null, previewId);
        });
}
async function uploadChatMedia(file, scope, chatId) {
    const validation = validateChatMedia(file);

    if (!validation.valid) {
        throw new Error(validation.message);
    }

    const extension = CHAT_MEDIA_TYPES[file.type];

    if (!extension) {
        throw new Error('Unsupported file type.');
    }

    const randomName = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const filePath =
        `${scope}/${chatId}/${currentUser.id}/${randomName}.${extension}`;

    const { error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(filePath, file, {
            contentType: file.type,
            upsert: false
        });

    if (error) throw error;

    return filePath;
}
async function createChatMediaMarkup(item) {
    if (!item.media_path) {
        return '';
    }

    const { data, error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .createSignedUrl(item.media_path, 3600);

    if (error || !data?.signedUrl) {
        return '<p class="media-unavailable">Media unavailable</p>';
    }

    const url = escapeHTML(data.signedUrl);
    const filename = escapeHTML(item.media_name || 'Shared file');
    const mime = item.media_mime_type || '';

    if (mime.startsWith('image/')) {
        return `
            <a class="chat-media-image-link"
               href="${url}" target="_blank" rel="noopener noreferrer">
                <img class="chat-media-image"
                     src="${url}"
                     alt="${filename}"
                     loading="lazy">
            </a>
            <small class="media-filename">${filename}</small>
        `;
    }

    const icon = mime === 'application/pdf' ? '📕' : '📄';

    return `
        <a class="chat-file-link"
           href="${url}"
           target="_blank"
           rel="noopener noreferrer">
            <span>${icon}</span>
            <span>
                <strong>${filename}</strong>
                <small>${formatMediaSize(Number(item.media_size || 0))} · Open file</small>
            </span>
        </a>
    `;
}

function clearChatMediaSelection(scope) {
    if (scope === 'direct') {
        selectedChatMediaFile = null;

        const input = document.querySelector('#chatMediaInput');
        if (input) input.value = '';

        showSelectedMedia(null, 'chatAttachmentPreview');
    } else {
        selectedGroupMediaFile = null;

        const input = document.querySelector('#groupMediaInput');
        if (input) input.value = '';

        showSelectedMedia(null, 'groupAttachmentPreview');
    }
}

function brandHTML() {
  return `
    <section class="auth-brand">
      <div class="brand-icon">V<span>•••</span></div>
      <h1>VIDLYRA <span>CHAT</span></h1>
      <p>CONNECT BEYOND LIMITS.</p>
      <div class="brand-decoration"></div>
      <small>A VIDLYRA PRODUCT</small>
    </section>
  `;
}

function showMessage(message, type = 'info') {
  const element = document.querySelector('#authMessage');

  if (!element) return;

  element.textContent = message;
  element.className = `auth-message ${type}`;
}

function showProfileMessage(message, type = 'info') {
  const element = document.querySelector('#profileMessage');

  if (!element) return;

  element.textContent = message;
  element.className = `auth-message ${type}`;
}

function renderLoading(message = 'Please wait while we verify your session.') {
  app.innerHTML = `
    <main class="auth-layout">
      ${brandHTML()}

      <section class="auth-panel">
        <div class="auth-card">
          <div class="mobile-logo">V<span>•••</span></div>

          <div class="eyebrow">VIDLYRA SECURITY</div>

          <h2>Connecting<br><span>your account.</span></h2>

          <p class="description">${escapeHTML(message)}</p>
        </div>
      </section>
    </main>
  `;
}
// ========================================
// REMEMBER LAST PAGE
// ========================================

const APP_STATE_KEY = 'vidlyra_chat_last_page';

function saveAppPage(page, extra = {}) {
    if (!currentUser?.id) return;

    try {
        localStorage.setItem(
            APP_STATE_KEY,
            JSON.stringify({
                page,
                userId: currentUser.id,
                ...extra
            })
        );
    } catch (error) {
        console.warn('Could not save page state:', error);
    }
}

function getAppPage(user) {
    try {
        const state = JSON.parse(
            localStorage.getItem(APP_STATE_KEY) || '{}'
        );

        // Never restore another account's page.
        if (state.userId !== user.id) return {};

        return state;
    } catch {
        return {};
    }
}
// ========================================
// VIDLYRA CHAT - MESSAGE NOTIFICATIONS
// ========================================

let messageNotificationChannel = null;
let notificationToastTimer = null;

let notificationAudioContext = null;
const NOTIFICATION_SOUND_KEY_PREFIX = 'vidlyra_chat_sound_';

function isNotificationSoundEnabled() {
  if (!currentUser?.id) return false;

  return localStorage.getItem(
    `${NOTIFICATION_SOUND_KEY_PREFIX}${currentUser.id}`
  ) === 'true';
}

function updateNotificationSoundButton() {
  const button = document.querySelector('#notificationSoundButton');
  if (!button) return;

  const enabled = isNotificationSoundEnabled();

  button.textContent = enabled
    ? '🔊 Notification sound: ON'
    : '🔇 Notification sound: OFF';

  button.setAttribute('aria-pressed', String(enabled));
}

async function toggleNotificationSound() {
  if (!currentUser?.id) return;

  const nextEnabled = !isNotificationSoundEnabled();

  if (nextEnabled) {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        alert('This browser does not support notification sound.');
        return;
      }

      if (!notificationAudioContext) {
        notificationAudioContext = new AudioContextClass();
      }

      if (notificationAudioContext.state === 'suspended') {
        await notificationAudioContext.resume();
      }

      playNotificationSound(true);

    } catch (error) {
      console.warn('Could not enable notification sound:', error);
      alert('Could not enable sound. Check browser settings.');
      return;
    }
  }

  localStorage.setItem(
    `${NOTIFICATION_SOUND_KEY_PREFIX}${currentUser.id}`,
    String(nextEnabled)
  );

  updateNotificationSoundButton();
}

function playNotificationSound(forcePreview = false) {
  if (!forcePreview && !isNotificationSoundEnabled()) return;

  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    if (!notificationAudioContext) {
      notificationAudioContext = new AudioContextClass();
    }

    const context = notificationAudioContext;

    if (context.state === 'suspended') {
      context.resume().catch(error => {
        console.warn('Audio resume failed:', error);
      });
    }

    const now = context.currentTime;

    [880, 1175].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = now + index * 0.13;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(startAt);
      oscillator.stop(startAt + 0.23);
    });

  } catch (error) {
    console.warn('Notification sound playback failed:', error);
  }
}

function ensureNotificationToast() {
  let toast = document.querySelector('#vidlyraNotificationToast');

  if (!toast) {
    toast = document.createElement('button');
    toast.type = 'button';
    toast.id = 'vidlyraNotificationToast';
    toast.className = 'vidlyra-notification-toast';
    toast.hidden = true;

    toast.addEventListener('click', () => {
    const conversationId = toast.dataset.conversationId;
    const groupId = toast.dataset.groupId;

    toast.hidden = true;

    if (groupId) {
        renderGroupChatScreen(groupId);
    } else if (conversationId) {
        renderChatScreen(conversationId);
    }
});

    document.body.appendChild(toast);
  }

  return toast;
}

function showMessageNotification({ conversationId, senderName, content }) {
  const toast = ensureNotificationToast();

  toast.innerHTML = `
    <span class="notification-toast-icon">V</span>

    <span class="notification-toast-copy">
      <strong>${escapeHTML(senderName)}</strong>
      <small>${escapeHTML(content)}</small>
    </span>

    <span class="notification-toast-arrow">›</span>
  `;

  toast.dataset.conversationId = conversationId;
  toast.hidden = false;

  clearTimeout(notificationToastTimer);

  notificationToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6000);

  if (
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    const notification = new Notification(
      `New message from ${senderName}`,
      {
        body: content,
        tag: `vidlyra-${conversationId}`,
        icon: '/favicon.ico'
      }
    );

    notification.onclick = () => {
      window.focus();
      renderChatScreen(conversationId);
      notification.close();
    };
  }
}

async function enableBrowserNotifications() {
  if (!('Notification' in window)) {
    alert('This browser does not support desktop notifications.');
    return;
  }

  if (Notification.permission === 'granted') {
    alert('Browser notifications are already enabled.');
    updateNotificationButton();
    return;
  }

  if (Notification.permission === 'denied') {
    alert(
      'Notifications are blocked in browser settings. Allow them there, then reload VIDLYRA CHAT.'
    );
    updateNotificationButton();
    return;
  }

  const permission = await Notification.requestPermission();

  updateNotificationButton();

  if (permission === 'granted') {
    alert('VIDLYRA CHAT notifications enabled!');
  } else {
    alert('Notification permission was not granted.');
  }
}

function updateNotificationButton() {
  const button = document.querySelector('#enableNotificationsButton');

  if (!button) return;

  if (!('Notification' in window)) {
    button.textContent = 'Browser notifications unsupported';
    button.disabled = true;
  } else if (Notification.permission === 'granted') {
    button.textContent = '✓ Browser notifications enabled';
    button.disabled = true;
  } else if (Notification.permission === 'denied') {
    button.textContent = 'Notifications blocked in browser settings';
    button.disabled = true;
  } else {
    button.textContent = 'Enable browser notifications';
    button.disabled = false;
  }
}

async function handleIncomingMessageNotification(payload) {
  const incoming = payload.new;

  if (
    !currentUser ||
    !incoming ||
    incoming.sender_id === currentUser.id
  ) {
    return;
  }

  // Active chat already has its own Realtime listener.
  if (activeConversationId === incoming.conversation_id) {
    return;
  }

  let senderName = 'VIDLYRA Member';

  try {
    const { data: sender } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', incoming.sender_id)
      .maybeSingle();

    senderName = sender?.display_name || senderName;

  } catch (error) {
    console.warn('Could not load notification sender:', error);
  }

  showMessageNotification({
    conversationId: incoming.conversation_id,
    senderName,
    content: incoming.content || 'Sent you a message'
  });
   playNotificationSound();
  // Refresh unread badges when conversations are visible.
  if (document.querySelector('#conversationsList')) {
    await renderConversations();
  }
}

// ========================================
// GROUP MESSAGE NOTIFICATIONS
// ========================================

let groupNotificationChannel = null;

async function handleIncomingGroupNotification(payload) {
    const incoming = payload.new;

    if (
        !currentUser ||
        !incoming ||
        incoming.sender_id === currentUser.id
    ) {
        return;
    }

    // If the user is already viewing this group, its chat listener handles it.
    if (activeGroupId === incoming.group_id) return;

    try {
        // Confirm that the current user belongs to this group.
        const { data: membership, error: membershipError } = await supabase
            .from('group_members')
            .select('group_id')
            .eq('group_id', incoming.group_id)
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (membershipError) throw membershipError;
        if (!membership) return;

        const [{ data: sender }, { data: group }] = await Promise.all([
            supabase
                .from('profiles')
                .select('display_name, username')
                .eq('id', incoming.sender_id)
                .maybeSingle(),

            supabase
                .from('group_conversations')
                .select('name')
                .eq('id', incoming.group_id)
                .maybeSingle()
        ]);

        const senderName =
            sender?.display_name || sender?.username || 'Group member';

        const groupName = group?.name || 'Group chat';

        showGroupMessageNotification({
            groupId: incoming.group_id,
            groupName,
            senderName,
            content: incoming.content || 'Sent a message'
        });

        if (typeof playNotificationSound === 'function') {
            playNotificationSound();
        }

        // Refresh the group list if it is visible.
        if (document.querySelector('#groupConversationsList')) {
            await renderGroupConversations();
        }

    } catch (error) {
        console.warn('Group notification error:', error);
    }
}


// ========================================
// GROUP NOTIFICATION DISPLAY
// ========================================

function showGroupMessageNotification({
    groupId,
    groupName,
    senderName,
    content
}) {
    const toast = ensureNotificationToast();

    toast.innerHTML = `
        <span class="notification-toast-icon">V</span>

        <span class="notification-toast-copy">
            <strong>${escapeHTML(senderName)} · ${escapeHTML(groupName)}</strong>
            <small>${escapeHTML(content)}</small>
        </span>

        <span class="notification-toast-arrow">›</span>
    `;

    toast.dataset.conversationId = '';
    toast.dataset.groupId = groupId;
    toast.hidden = false;

    clearTimeout(notificationToastTimer);

    notificationToastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 6000);

    if (
        'Notification' in window &&
        Notification.permission === 'granted'
    ) {
        const notification = new Notification(
            `${senderName} · ${groupName}`,
            {
                body: content,
                tag: `vidlyra-group-${groupId}`,
                icon: '/favicon.ico'
            }
        );

        notification.onclick = () => {
            window.focus();
            renderGroupChatScreen(groupId);
            notification.close();
        };
    }
}


// ========================================
// SUBSCRIBE TO GROUP NOTIFICATIONS
// ========================================

function subscribeToUserGroupMessages() {
    if (!currentUser?.id) return;

    if (groupNotificationChannel) {
        supabase.removeChannel(groupNotificationChannel);
        groupNotificationChannel = null;
    }

    groupNotificationChannel = supabase
        .channel(`user-group-notifications-${currentUser.id}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'group_messages'
            },
            handleIncomingGroupNotification
        )
        .subscribe(status => {
            console.log('Group notifications Realtime:', status);
        });
}

function subscribeToUserMessages() {
  if (!currentUser?.id) return;

  if (messageNotificationChannel) {
    supabase.removeChannel(messageNotificationChannel);
    messageNotificationChannel = null;
  }

  messageNotificationChannel = supabase
    .channel(`user-message-notifications-${currentUser.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      },
      handleIncomingMessageNotification
    )
    .subscribe((status, err) => {
    console.log('Realtime Status:', status);

    if (err) {
        console.error('Realtime Error Details:', err);
    }
});
}
async function restoreLastPage(user) {
    currentUser = user;

    const state = getAppPage(user);

    switch (state.page) {
    case 'profile':
    case 'find-people':
    case 'incoming-requests':
    case 'conversations':
    case 'chat':
    case 'profile-setup':
    case 'create-group':
    case 'blocked-users':
    case 'group-chat':
        break;

    default:
        renderDashboard(user);
        return;
}
    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (error) throw error;

        if (!profile) {
            await openProfileSetup(user);
            return;
        }

        switch (state.page) {
            case 'profile':
                renderProfileComplete(profile);
                break;

            case 'profile-setup':
                renderProfileSetup(profile);
                break;

            case 'find-people':
                renderFindPeople();
                break;

            case 'incoming-requests':
                renderIncomingRequests();
                break;

            case 'conversations':
                renderConversations();
                break;

            case 'chat':
                if (state.conversationId) {
                    await renderChatScreen(state.conversationId);
                } else {
                    renderConversations();
                
                }
                break;
                case 'blocked-users':
                renderBlockedUsers();
                break;
                case 'group-chat':
               if (state.groupId) {
               await renderGroupChatScreen(state.groupId);
              } else {
               renderConversations();
             }
             break;
            }
             
    } catch (error) {
        console.error('Page restore error:', error);
        renderDashboard(user);
    }
}
// ========================================
// AUTHENTICATION - LOGIN
// ========================================

function renderLogin() {
  app.innerHTML = `
    <main class="auth-layout">
      ${brandHTML()}

      <section class="auth-panel">
        <div class="auth-card">

          <div class="mobile-logo">V<span>•••</span></div>

          <div class="eyebrow">WELCOME TO VIDLYRA</div>

          <h2>Connect with<br><span>your people.</span></h2>

          <p class="description">
            Enter your email address. We'll send you a secure sign-in link.
          </p>

          <form id="emailForm">

            <label for="email">EMAIL ADDRESS</label>

            <input
              class="email-input"
              id="email"
              type="email"
              autocomplete="email"
              placeholder="you@gmail.com"
              maxlength="254"
              required
            />

            <button class="primary-btn" id="sendButton" type="submit">
              Send Magic Link <span>→</span>
            </button>

          </form>

          <div id="authMessage" class="auth-message" aria-live="polite"></div>

          <div class="security-note">
            🔒 Your account is protected with secure email authentication.
          </div>

          <div class="auth-footer">
            BY CONTINUING, YOU AGREE TO OUR
            <span>TERMS & PRIVACY POLICY</span>
          </div>

        </div>
      </section>
    </main>
  `;

  document.querySelector('#emailForm')
    .addEventListener('submit', sendMagicLink);
}

async function sendMagicLink(event) {
  event.preventDefault();

  if (busy) return;

  const emailInput = document.querySelector('#email');
  const sendButton = document.querySelector('#sendButton');

  const email = emailInput.value.trim().toLowerCase();

  if (!emailInput.checkValidity()) {
    showMessage('Please enter a valid email address.', 'error');
    return;
  }

  currentEmail = email;

  busy = true;
  sendButton.disabled = true;
  sendButton.textContent = 'Sending link...';

  showMessage('Requesting your secure sign-in link...', 'info');

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`
      }
    });

    if (error) throw error;

    renderLinkSent();

  } catch (error) {
    console.error('Magic Link Error:', error);

    showMessage(
      error.message || 'Unable to send the sign-in link.',
      'error'
    );

    sendButton.disabled = false;
    sendButton.innerHTML = 'Send Magic Link <span>→</span>';

  } finally {
    busy = false;
  }
}

// ========================================
// MAGIC LINK SENT SCREEN
// ========================================

function renderLinkSent() {
  app.innerHTML = `
    <main class="auth-layout">
      ${brandHTML()}

      <section class="auth-panel">
        <div class="auth-card">

          <button class="back-btn" id="backButton">
            ← Change email
          </button>

          <div class="step-icon">✉</div>

          <div class="eyebrow">CHECK YOUR INBOX</div>

          <h2>Your sign-in<br><span>link is on its way.</span></h2>

          <p class="description">
            We requested a secure sign-in link for
            <strong>${escapeHTML(currentEmail)}</strong>.
            Open that email and click the Sign in link.
          </p>

          <div class="auth-message info">
            Check your inbox and spam folder.
          </div>

          <button class="primary-btn" id="resendButton">
            Resend Magic Link →
          </button>

          <p class="security-note">
            Sign-in links are single-use and expire.
          </p>

        </div>
      </section>
    </main>
  `;

  document.querySelector('#backButton')
    .addEventListener('click', renderLogin);

  document.querySelector('#resendButton')
    .addEventListener('click', () => {
      renderLogin();

      document.querySelector('#email').value = currentEmail;

      document.querySelector('#emailForm').requestSubmit();
    });
}

// ========================================
// AUTHENTICATION SUCCESS DASHBOARD
// ========================================

function renderDashboard(user) {
  saveAppPage('dashboard');
  const email = escapeHTML(user.email || 'Verified account');

  app.innerHTML = `
    <main class="auth-layout">
      ${brandHTML()}

      <section class="auth-panel">
        <div class="auth-card">

          <div class="step-icon">✓</div>

          <div class="eyebrow">AUTHENTICATION SUCCESSFUL</div>

          <h2>Welcome to<br><span>VIDLYRA CHAT.</span></h2>

          <p class="description">
            Your account is securely connected.
          </p>

          <div class="profile-preview">
            <div class="profile-avatar">V</div>

            <div>
              <strong>Verified User</strong>
              <p>${email}</p>
            </div>
          </div>

          <button class="primary-btn" id="continueButton">
            Continue to Profile →
          </button>

          <button class="back-btn signout-btn" id="signOutButton">
            Sign Out
          </button>

        </div>
      </section>
    </main>
  `;

  document.querySelector('#continueButton')
    .addEventListener('click', () => openProfileSetup(user));

  document.querySelector('#signOutButton')
    .addEventListener('click', signOut);
}

// ========================================
// LOAD EXISTING PROFILE
// ========================================

async function openProfileSetup(user) {
  saveAppPage('profile-setup');
  currentUser = user;

  renderLoading('Loading your profile...');

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;

    renderProfileSetup(data || {});

  } catch (error) {
    console.error('Profile loading error:', error);

    renderDashboard(user);

    alert(`Could not load your profile: ${error.message}`);
  }
}

// ========================================
// IMAGE UPLOAD HELPER
// ========================================

async function uploadProfileImage(file, folder) {
  if (!file) return null;

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error('Please select a JPG, PNG or WebP image.');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image size must be 5 MB or less.');
  }

  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }[file.type];

  const filePath =
    `${currentUser.id}/${folder}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from('profile-media')
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from('profile-media')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

// ========================================
// IMAGE PREVIEW
// ========================================

function previewSelectedImage(input, previewElement) {
  const file = input.files?.[0];

  if (!file) return null;

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowedTypes.includes(file.type)) {
    alert('Please select a JPG, PNG or WebP image.');
    input.value = '';
    return null;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('Image size must be 5 MB or less.');
    input.value = '';
    return null;
  }

  const imageUrl = URL.createObjectURL(file);

  previewElement.innerHTML = `
    <img src="${imageUrl}" alt="Selected image preview">
  `;

  previewElement.classList.add('has-image');

  return file;
}

// ========================================
// PROFILE SETUP SCREEN
// ========================================

function renderProfileSetup(profile = {}) {
  selectedAvatarFile = null;
  selectedCoverFile = null;

  existingAvatarUrl = profile.avatar_url || null;
  existingCoverUrl = profile.cover_url || null;

  removeAvatarImage = false;
  removeCoverImage = false;

  const isEditing = Boolean(profile.username);

  const avatarHTML = profile.avatar_url
    ? `<img src="${escapeHTML(profile.avatar_url)}" alt="Profile photo">`
    : '<span>V</span>';

  const coverHTML = profile.cover_url
    ? `<img src="${escapeHTML(profile.cover_url)}" alt="Cover image">`
    : '<span>YOUR COVER BANNER</span>';

  app.innerHTML = `
    <main class="profile-layout">

      <header class="profile-header">

        <div class="profile-brand">
          <span class="profile-brand-icon">V</span>
          <span>VIDLYRA <b>CHAT</b></span>
        </div>

        <button class="back-btn profile-logout" id="profileSignOut">
          Sign Out
        </button>

      </header>

      <section class="profile-container">

        <div class="profile-heading">

          <div class="eyebrow">YOUR DIGITAL IDENTITY</div>

          <h1>
            ${isEditing ? 'Edit your' : 'Create your'}
            <span>profile.</span>
          </h1>

          <p>
            Introduce yourself to the VIDLYRA CHAT community.
          </p>

        </div>

        <div class="profile-form-card">

          <!-- PROFILE PHOTO AND COVER -->

          <div class="profile-media-section">

            <div class="media-field">

              <label>PROFILE PHOTO</label>

              <div class="media-preview-row">

                <div class="media-preview" id="avatarPreview">
                  ${avatarHTML}
                </div>

                <div class="media-actions">

                  <strong>Your profile picture</strong>

                  <p>JPG, PNG or WebP · Maximum 5 MB</p>

                  <label class="upload-btn" for="avatarFile">
                    Choose Photo
                  </label>

                  <input
                    type="file"
                    id="avatarFile"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                  >

                  <button
                    type="button"
                    class="remove-media-btn"
                    id="removeAvatar"
                  >
                    Remove photo
                  </button>

                </div>

              </div>

            </div>

            <div class="media-field">

              <label>PROFILE COVER BANNER</label>
              <div class="avatar-gallery-section">

  <div class="avatar-gallery-heading">
    <strong>CHOOSE AN ANIME AVATAR</strong>
    <small>Choose your favourite character</small>
  </div>

  <div class="avatar-gallery" id="avatarGallery">

    ${ANIME_AVATARS.map((avatar, index) => `
      <button
        type="button"
        class="avatar-option ${
          profile.avatar_url === avatar ? 'selected' : ''
        }"
        data-avatar="${avatar}"
        aria-label="Select anime avatar ${index + 1}"
        aria-pressed="${profile.avatar_url === avatar}"
      >
        <img
          src="${avatar}"
          alt="Anime avatar ${index + 1}"
          loading="lazy"
        >
        <span class="avatar-check">✓</span>
      </button>
    `).join('')}

  </div>

  <p class="avatar-gallery-hint" id="avatarGalleryHint">
    Select an avatar or upload your own photo above.
  </p>

</div>

              <div class="cover-preview" id="coverPreview">
                ${coverHTML}
              </div>

              <label class="upload-btn" for="coverFile">
                Choose Cover Image
              </label>

              <input
                type="file"
                id="coverFile"
                accept="image/jpeg,image/png,image/webp"
                hidden
              >

              <button
                type="button"
                class="remove-media-btn"
                id="removeCover"
              >
                Remove cover
              </button>

            </div>

          </div>

          <!-- PROFILE DETAILS -->

          <form id="profileForm">

            <div class="form-field">

              <label for="displayName">DISPLAY NAME</label>

              <input
                class="profile-input"
                id="displayName"
                type="text"
                maxlength="40"
                placeholder="Your name"
                value="${escapeHTML(profile.display_name || '')}"
                required
              >

            </div>

            <div class="form-field">

              <label for="username">USERNAME</label>

              <div class="username-input-wrap">

                <span>@</span>

                <input
                  class="profile-input"
                  id="username"
                  type="text"
                  minlength="3"
                  maxlength="20"
                  pattern="[A-Za-z0-9_]{3,20}"
                  autocomplete="username"
                  placeholder="your_username"
                  value="${escapeHTML(profile.username || '')}"
                  required
                >

              </div>

              <small>
                3–20 characters. Letters, numbers and underscores only.
              </small>

            </div>

            <div class="form-field">

              <label for="bio">BIO</label>

              <textarea
                class="profile-input profile-textarea"
                id="bio"
                maxlength="160"
                placeholder="Tell people something about yourself..."
              >${escapeHTML(profile.bio || '')}</textarea>

              <small>Maximum 160 characters.</small>

            </div>

            <div class="form-field">

              <label for="status">ACTIVITY STATUS</label>

              <select class="profile-input" id="status">

                <option
                  value="online"
                  ${profile.status === 'online' || !profile.status ? 'selected' : ''}
                >
                  🟢 Online
                </option>

                <option
                  value="away"
                  ${profile.status === 'away' ? 'selected' : ''}
                >
                  🟡 Away
                </option>

                <option
                  value="busy"
                  ${profile.status === 'busy' ? 'selected' : ''}
                >
                  🔴 Busy
                </option>

                <option
                  value="invisible"
                  ${profile.status === 'invisible' ? 'selected' : ''}
                >
                  ⚫ Invisible
                </option>

              </select>

            </div>

            <div class="form-field">

              <label for="statusMessage">STATUS MESSAGE</label>

              <input
                class="profile-input"
                id="statusMessage"
                type="text"
                maxlength="80"
                placeholder="What's happening?"
                value="${escapeHTML(profile.status_message || '')}"
              >

            </div>

            <div
              id="profileMessage"
              class="auth-message"
              aria-live="polite"
            ></div>

            <button
              class="primary-btn profile-save-btn"
              id="saveProfileButton"
              type="submit"
            >
              ${isEditing ? 'Save Changes' : 'Create My Profile'} →
            </button>

          </form>

        </div>

        <p class="profile-footer">
          CONNECT BEYOND LIMITS. · A VIDLYRA PRODUCT
        </p>

      </section>

    </main>
  `;

  // FORM EVENT

  document.querySelector('#profileForm')
    .addEventListener('submit', saveProfile);

  // SIGN OUT

  document.querySelector('#profileSignOut')
    .addEventListener('click', signOut);

  // USERNAME FILTER

  document.querySelector('#username')
    .addEventListener('input', event => {
      event.target.value = event.target.value
        .replace(/[^a-zA-Z0-9_]/g, '');
    });
    // ANIME AVATAR GALLERY

selectedAvatarUrl = ANIME_AVATARS.includes(profile.avatar_url)
  ? profile.avatar_url
  : null;

document.querySelectorAll('.avatar-option').forEach(option => {

  option.addEventListener('click', () => {

    const avatarUrl = option.dataset.avatar;

    selectedAvatarUrl = avatarUrl;
    selectedAvatarFile = null;
    removeAvatarImage = false;

    avatarInput.value = '';

    const preview = document.querySelector('#avatarPreview');

    preview.innerHTML = `
      <img src="${avatarUrl}" alt="Selected anime avatar">
    `;

    preview.classList.add('has-image');

    document.querySelectorAll('.avatar-option').forEach(item => {
      const isSelected = item.dataset.avatar === avatarUrl;

      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-pressed', String(isSelected));
    });

    document.querySelector('#avatarGalleryHint').textContent =
      'Anime avatar selected successfully.';

  });

});

  // AVATAR UPLOAD PREVIEW

  const avatarInput = document.querySelector('#avatarFile');

  avatarInput.addEventListener('change', () => {

  selectedAvatarFile = previewSelectedImage(
    avatarInput,
    document.querySelector('#avatarPreview')
  );

  if (selectedAvatarFile) {

    selectedAvatarUrl = null;
    removeAvatarImage = false;

    document.querySelectorAll('.avatar-option').forEach(item => {
      item.classList.remove('selected');
      item.setAttribute('aria-pressed', 'false');
    });

    document.querySelector('#avatarGalleryHint').textContent =
      'Custom photo selected.';

  }

});

  // COVER UPLOAD PREVIEW

  const coverInput = document.querySelector('#coverFile');

  coverInput.addEventListener('change', () => {
    selectedCoverFile = previewSelectedImage(
      coverInput,
      document.querySelector('#coverPreview')
    );

    if (selectedCoverFile) {
      removeCoverImage = false;
    }
  });

  // REMOVE AVATAR

  document.querySelector('#removeAvatar')
    .addEventListener('click', () => {

      selectedAvatarFile = null;
      selectedAvatarUrl = null;
      removeAvatarImage = true;

      avatarInput.value = '';

      const preview = document.querySelector('#avatarPreview');

      preview.innerHTML = '<span>V</span>';
      preview.classList.remove('has-image');
    });

  // REMOVE COVER

  document.querySelector('#removeCover')
    .addEventListener('click', () => {

      selectedCoverFile = null;
      removeCoverImage = true;

      coverInput.value = '';

      const preview = document.querySelector('#coverPreview');

      preview.innerHTML = '<span>YOUR COVER BANNER</span>';
      preview.classList.remove('has-image');
    });
}

// ========================================
// SAVE PROFILE
// ========================================

async function saveProfile(event) {
  event.preventDefault();

  if (busy || !currentUser) return;

  const displayName = document
    .querySelector('#displayName')
    .value.trim();

  const username = document
    .querySelector('#username')
    .value.trim()
    .toLowerCase();

  const bio = document
    .querySelector('#bio')
    .value.trim();

  const status = document
    .querySelector('#status')
    .value;

  const statusMessage = document
    .querySelector('#statusMessage')
    .value.trim();

  if (displayName.length < 2) {
    showProfileMessage(
      'Display name must contain at least 2 characters.',
      'error'
    );
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    showProfileMessage(
      'Username must be 3–20 characters using letters, numbers or underscores.',
      'error'
    );
    return;
  }

  const button = document.querySelector('#saveProfileButton');

  busy = true;

  button.disabled = true;
  button.textContent = 'Saving profile...';

  showProfileMessage(
    'Saving your profile securely...',
    'info'
  );

  try {

    // UPLOAD AVATAR

    const avatarUrl = selectedAvatarFile
  ? await uploadProfileImage(selectedAvatarFile, 'avatar')
  : selectedAvatarUrl
    ? selectedAvatarUrl
    : removeAvatarImage
      ? null
      : existingAvatarUrl;

    // UPLOAD COVER

    const coverUrl = selectedCoverFile
      ? await uploadProfileImage(selectedCoverFile, 'cover')
      : removeCoverImage
        ? null
        : existingCoverUrl;

    // SAVE PROFILE DATABASE

    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: currentUser.id,
        username,
        display_name: displayName,
        bio,
        status,
        status_message: statusMessage,
        avatar_url: avatarUrl,
        cover_url: coverUrl
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (error) throw error;

    existingAvatarUrl = avatarUrl;
    existingCoverUrl = coverUrl;

    selectedAvatarFile = null;
    selectedCoverFile = null;

    removeAvatarImage = false;
    removeCoverImage = false;

    renderProfileComplete(data);

  } catch (error) {

    console.error('Profile save error:', error);

    let message = error.message || 'Unable to save your profile.';

    if (error.code === '23505') {
      message = 'This username is already taken. Please choose another.';
    }

    showProfileMessage(message, 'error');

    button.disabled = false;
    button.textContent = 'Try Again →';

  } finally {
    busy = false;
  }
}

// ========================================
// PROFILE CREATED SUCCESS SCREEN
// ========================================


function renderProfileComplete(profile) {
  saveAppPage('profile');
  const avatar = profile.avatar_url
    ? `<img src="${escapeHTML(profile.avatar_url)}" alt="Profile photo">`
    : 'V';
  const cover = profile.cover_url
    ? `
      <div class="success-cover">
        <img src="${escapeHTML(profile.cover_url)}" alt="Profile cover">
      </div>
    `
    : '';

  app.innerHTML = `
    <main class="profile-layout">
      <section class="profile-complete-card">

        <div class="step-icon">✓</div>

        <div class="eyebrow">PROFILE READY</div>

        <h1>
          Welcome,<br>
          <span>${escapeHTML(profile.display_name)}.</span>
        </h1>

        ${cover}

        <div class="profile-preview">
          <div class="profile-avatar">${avatar}</div>
          <div style="min-width:0;overflow-wrap:anywhere;">
            <strong>${escapeHTML(profile.display_name)}</strong>
            <p>@${escapeHTML(profile.username)}</p>
          </div>
        </div>

        <p class="description">
          Your VIDLYRA CHAT identity is ready.
        </p>

        <button class="primary-btn" id="findPeopleButton">
          Find People →
        </button>
        <button class="back-btn" id="openConversationsButton">
          My Conversations →
        </button>
        <button class="back-btn" id="editProfileButton">
          Edit Profile
        </button>
         
        <p class="profile-footer">
          CONNECT BEYOND LIMITS.
        </p>

      </section>
    </main>
  `;
  
  document.querySelector('#findPeopleButton')
    .addEventListener('click', renderFindPeople);

  document.querySelector('#editProfileButton')
    .addEventListener('click', () => renderProfileSetup(profile));

  document.querySelector('#openConversationsButton')
  .addEventListener('click', renderConversations);
}
// ========================================
// VIDLYRA CHAT - FIND PEOPLE
// ========================================

function renderFindPeople() {
  saveAppPage('find-people');
  app.innerHTML = `
    <main class="profile-layout">

      <header class="profile-header">
        <div class="profile-brand">
          <span class="profile-brand-icon">V</span>
          <span>VIDLYRA <b>CHAT</b></span>
        </div>

        <button class="back-btn" id="peopleBackButton">
          ← Back
        </button>
      </header>

      <section class="profile-container">

        <div class="profile-heading">
          <div class="eyebrow">DISCOVER YOUR PEOPLE</div>
          <h1>Find <span>people.</span></h1>
          <p>Search for friends using their VIDLYRA username.</p>
        </div>

        <div class="profile-form-card">

          <label for="peopleSearch">SEARCH USERNAME</label>

          <div class="people-search-wrap">
            <span>@</span>
            <input
              id="peopleSearch"
              class="profile-input"
              type="text"
              maxlength="20"
              placeholder="Enter username"
              autocomplete="off"
            >
          </div>

          <button
            class="primary-btn people-search-button"
            id="peopleSearchButton"
          >
            Search People →
          </button>
           <button
            class="back-btn"
            id="incomingRequestsButton"
            type="button"
          >
  Incoming Requests →
</button>
          <div
            id="peopleSearchMessage"
            class="auth-message"
            aria-live="polite"
          ></div>

          <div id="peopleResults" class="people-results"></div>

        </div>

      </section>
    </main>
  `;
  
  document.querySelector('#peopleBackButton')
    .addEventListener('click', async () => {
      await openProfileSetup(currentUser);
    });
    document.querySelector('#incomingRequestsButton')
    .addEventListener('click', () => {
      renderIncomingRequests();
    });
  const input = document.querySelector('#peopleSearch');

  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
  });

  document.querySelector('#peopleSearchButton')
    .addEventListener('click', searchPeople);

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      searchPeople();
    }
  });
}


// ========================================
// SEARCH PROFILES BY USERNAME
// ========================================

async function searchPeople() {
  if (!currentUser || busy) return;

  const input = document.querySelector('#peopleSearch');
  const button = document.querySelector('#peopleSearchButton');
  const message = document.querySelector('#peopleSearchMessage');
  const results = document.querySelector('#peopleResults');

  const query = input.value.trim().toLowerCase();

  results.innerHTML = '';
  message.textContent = '';

  if (query.length < 3) {
    message.textContent = 'Enter at least 3 characters.';
    message.className = 'auth-message error';
    return;
  }

  busy = true;
  button.disabled = true;
  button.textContent = 'Searching...';

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        username,
        display_name,
        bio,
        avatar_url,
        status
      `)
      .neq('id', currentUser.id)
      .ilike('username', `%${query}%`)
      .limit(20);

    if (error) throw error;

    if (!data || data.length === 0) {
      message.textContent = 'No users found. Try another username.';
      message.className = 'auth-message info';
      return;
    }

    message.textContent = `${data.length} user(s) found.`;
    message.className = 'auth-message success';

    results.innerHTML = data.map(user => {
      const avatar = user.avatar_url
        ? `<img src="${escapeHTML(user.avatar_url)}" alt="">`
        : '<span>V</span>';

      return `
        <article class="people-result">

          <div class="people-result-avatar">
            ${avatar}
          </div>

          <div class="people-result-info">
            <strong>${escapeHTML(user.display_name)}</strong>
            <span>@${escapeHTML(user.username)}</span>
            <small>${escapeHTML(user.bio || 'VIDLYRA CHAT member')}</small>
          </div>

          <button
            class="people-request-btn"
            data-user-id="${escapeHTML(user.id)}"
          >
            Add
          </button>

        </article>
      `;
    }).join('');

    results.querySelectorAll('.people-request-btn')
      .forEach(button => {
        button.addEventListener('click', () => {
          sendChatRequest(button.dataset.userId, button);
        });
      });

  } catch (error) {
    console.error('People search error:', error);

    message.textContent = error.message || 'Search failed.';
    message.className = 'auth-message error';

  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = 'Search People →';
  }
}


// ========================================
// SEND CHAT REQUEST
// ========================================

async function sendChatRequest(receiverId, button) {
  if (!currentUser || busy) return;

  busy = true;
  button.disabled = true;
  button.textContent = 'Sending...';

  try {
    const { data: existing, error: checkError } = await supabase
      .from('chat_requests')
      .select('id, status')
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${currentUser.id})`
      )
      .limit(1);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      const status = existing[0].status;

      button.textContent = status === 'accepted'
        ? 'Connected'
        : status === 'pending'
          ? 'Request exists'
          : 'Previously rejected';

      return;
    }

    const { error } = await supabase
      .from('chat_requests')
      .insert({
        sender_id: currentUser.id,
        receiver_id: receiverId
      });

    if (error) throw error;

    button.textContent = 'Request sent ✓';

  } catch (error) {
    console.error('Chat request error:', error);

    button.textContent = 'Try again';
    button.disabled = false;

    alert(`Could not send request: ${error.message}`);

  } finally {
    busy = false;
  }
}

// ========================================
// INCOMING CHAT REQUESTS
// ========================================

async function renderIncomingRequests(notice = '') {
  saveAppPage('incoming-requests');
  app.innerHTML = `
    <main class="profile-layout">

      <header class="profile-header">
        <div class="profile-brand">
          <span class="profile-brand-icon">V</span>
          <span>VIDLYRA <b>CHAT</b></span>
        </div>

        <button class="back-btn" id="requestsBackButton">
          ← Back
        </button>
      </header>

      <section class="profile-container">

        <div class="profile-heading">
          <div class="eyebrow">YOUR CONNECTIONS</div>
          <h1>Chat <span>requests.</span></h1>
          <p>People who want to connect with you.</p>
        </div>

        <div class="profile-form-card">

          <div
            id="requestsMessage"
            class="auth-message"
            aria-live="polite"
          ></div>

          <div id="incomingRequestsList" class="people-results">
            <p>Loading requests...</p>
          </div>

        </div>

      </section>
    </main>
  `;

  document.querySelector('#requestsBackButton')
    .addEventListener('click', renderFindPeople);

  const message = document.querySelector('#requestsMessage');
  const results = document.querySelector('#incomingRequestsList');

  if (notice) {
    message.textContent = notice;
    message.className = 'auth-message success';
  }

  busy = true;

  try {
    const { data: requests, error } = await supabase
      .from('chat_requests')
      .select('id, sender_id, created_at')
      .eq('receiver_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!requests || requests.length === 0) {
      results.innerHTML = `
        <p class="description">
          No pending incoming requests.
        </p>
      `;
      return;
    }

    const senderIds = [
      ...new Set(requests.map(request => request.sender_id))
    ];

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, bio, avatar_url')
      .in('id', senderIds);

    if (profileError) throw profileError;

    const profileMap = new Map(
      (profiles || []).map(profile => [profile.id, profile])
    );

    results.innerHTML = requests.map(request => {
      const profile = profileMap.get(request.sender_id);

      const avatar = profile?.avatar_url
        ? `<img src="${escapeHTML(profile.avatar_url)}" alt="">`
        : '<span>V</span>';

      const name = profile?.display_name || 'VIDLYRA Member';
      const username = profile?.username || 'unknown';

      return `
        <article class="people-result">

          <div class="people-result-avatar">
            ${avatar}
          </div>

          <div class="people-result-info">
            <strong>${escapeHTML(name)}</strong>
            <span>@${escapeHTML(username)}</span>
            <small>Wants to connect with you</small>
          </div>

          <div class="request-actions">
            <button
              type="button"
              class="people-request-btn"
              data-action="accept"
              data-request-id="${escapeHTML(request.id)}"
            >
              Accept
            </button>

            <button
              type="button"
              class="people-reject-btn"
              data-action="reject"
              data-request-id="${escapeHTML(request.id)}"
            >
              Reject
            </button>
          </div>

        </article>
      `;
    }).join('');

    results.querySelectorAll('[data-request-id]')
      .forEach(button => {
        button.addEventListener('click', () => {
          handleIncomingRequest(
            button.dataset.requestId,
            button.dataset.action,
            button
          );
        });
      });

  } catch (error) {
    console.error('Incoming requests error:', error);

    message.textContent =
      error.message || 'Unable to load incoming requests.';

    message.className = 'auth-message error';

  } finally {
    busy = false;
  }
}


// ========================================
// ACCEPT / REJECT CHAT REQUEST
// ========================================

async function handleIncomingRequest(requestId, action, button) {
  if (!currentUser || busy) return;

  const card = button.closest('.people-result');
  const buttons = card?.querySelectorAll('button') || [button];

  busy = true;

  buttons.forEach(item => {
    item.disabled = true;
  });

  button.textContent =
    action === 'accept' ? 'Accepting...' : 'Rejecting...';

  try {
    const functionName = action === 'accept'
      ? 'accept_chat_request'
      : 'reject_chat_request';

    const { data, error } = await supabase.rpc(functionName, {
      request_id: requestId
    });

    if (error) throw error;

    const notice = action === 'accept'
      ? 'Request accepted! Your conversation has been created.'
      : 'Chat request rejected.';

    busy = false;

    await renderIncomingRequests(notice);

  } catch (error) {
    console.error('Request action error:', error);

    alert(
      `Could not ${action} request: ${error.message}`
    );

    buttons.forEach(item => {
      item.disabled = false;
    });

    button.textContent =
      action === 'accept' ? 'Accept' : 'Reject';

  } finally {
    busy = false;
  }
}
// ========================================
// VIDLYRA CHAT - CONVERSATIONS LIST
// ========================================

async function renderConversations() {

  saveAppPage('conversations');
  if (!currentUser) return;

  if (chatRealtimeChannel) {
    supabase.removeChannel(chatRealtimeChannel);
    chatRealtimeChannel = null;
  }

  activeConversationId = null;

  app.innerHTML = `
    <main class="profile-layout">
      <header class="profile-header">
        <div class="profile-brand">
          <span class="profile-brand-icon">V</span>
          <span>VIDLYRA <b>CHAT</b></span>
        </div>
        <button class="back-btn" id="conversationsBackButton">
          ← Back
        </button>
      </header>

      <section class="profile-container">
        <div class="profile-heading">
          <div class="eyebrow">YOUR CONNECTIONS</div>
          <h1>My <span>conversations.</span></h1>
          <p>Your accepted VIDLYRA CHAT connections.</p>
         <button
         type="button"
         class="primary-btn"
         id="createGroupButton"
         >
         + Create New Group
         </button>
         <button
          type="button"
          class="back-btn"
          id="openBlockedUsersButton"
        >
          🚫 Blocked Users
         </button>
          <button
           type="button"
           class="notification-enable-btn"
           id="enableNotificationsButton"
          >
         Enable browser notifications
         </button>

         <p class="notification-settings-hint">
         Get alerts when a connection sends you a message.
         </p>
         <button
        type="button"
       class="notification-sound-btn"
        id="notificationSoundButton"
       aria-pressed="false"
      >
       🔇 Notification sound: OFF
       </button>
        </div>

        <div class="profile-form-card">
          <div id="conversationsMessage" class="auth-message">
            Loading your conversations...
          </div>
          <div id="conversationsList" class="people-results"></div>
          <div class="group-section">
          <div class="eyebrow">YOUR COMMUNITIES</div>
         <h2>Group <span>chats.</span></h2>
         <div
         id="groupConversationsList"
         class="people-results"
         >
         <p class="description">Loading groups...</p>
        </div>
        </div>
        </div>
      </section>
    </main>
  `;

  document.querySelector('#conversationsBackButton')
    .addEventListener('click', renderFindPeople);
    document.querySelector('#createGroupButton')
  .addEventListener('click', renderCreateGroup);
  document.querySelector('#openBlockedUsersButton')
    .addEventListener('click', renderBlockedUsers);
  document.querySelector('#enableNotificationsButton')
  .addEventListener('click', enableBrowserNotifications);

updateNotificationButton();
document.querySelector('#notificationSoundButton')
  .addEventListener('click', toggleNotificationSound);

updateNotificationSoundButton();
  const message = document.querySelector('#conversationsMessage');
  const list = document.querySelector('#conversationsList');
  renderGroupConversations();

  try {
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select('id, user_one, user_two, created_at')
      .or(`user_one.eq.${currentUser.id},user_two.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!conversations || conversations.length === 0) {
      message.textContent = 'No conversations yet. Accept a chat request to connect!';
      message.className = 'auth-message info';
      list.innerHTML = '';
      return;
    }

    const otherUserIds = conversations.map(conversation =>
      conversation.user_one === currentUser.id
        ? conversation.user_two
        : conversation.user_one
    );

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, status')
      .in('id', otherUserIds);

    if (profileError) throw profileError;

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('conversation_id, sender_id, content, created_at, is_read')
      .in('conversation_id', conversations.map(item => item.id))
      .order('created_at', { ascending: false });

    if (messagesError) throw messagesError;

    const profileMap = new Map(
      (profiles || []).map(profile => [profile.id, profile])
    );

    const latestMessageMap = new Map();
    const unreadCountMap = new Map();

    (messages || []).forEach(item => {
      if (!latestMessageMap.has(item.conversation_id)) {
        latestMessageMap.set(item.conversation_id, item);
      }

      if (
        item.sender_id !== currentUser.id &&
        !item.is_read
      ) {
        unreadCountMap.set(
          item.conversation_id,
          (unreadCountMap.get(item.conversation_id) || 0) + 1
        );
      }
    });

    list.innerHTML = conversations.map(conversation => {
      const otherUserId =
        conversation.user_one === currentUser.id
          ? conversation.user_two
          : conversation.user_one;

      const profile = profileMap.get(otherUserId);

      const name = profile?.display_name || 'VIDLYRA Member';
      const username = profile?.username || 'unknown';

      const avatar = profile?.avatar_url
        ? `<img src="${escapeHTML(profile.avatar_url)}" alt="">`
        : '<span>V</span>';

      const latestMessage = latestMessageMap.get(conversation.id);

      const unreadCount =
        unreadCountMap.get(conversation.id) || 0;

      let preview = 'Start a new conversation';

      if (latestMessage) {
        const prefix = latestMessage.sender_id === currentUser.id
          ? 'You: '
          : '';

        preview = prefix + latestMessage.content;
      }

      const messageTime = latestMessage
        ? new Date(latestMessage.created_at).toLocaleString([], {
            dateStyle: 'short',
            timeStyle: 'short'
          })
        : '';

      return `
        <article
          class="people-result conversation-card"
          data-conversation-id="${escapeHTML(conversation.id)}"
          role="button"
          tabindex="0"
          aria-label="Open chat with ${escapeHTML(name)}"
        >
          <div class="people-result-avatar">
            ${avatar}
          </div>

          <div class="people-result-info">
            <strong>${escapeHTML(name)}</strong>
            <span>@${escapeHTML(username)}</span>
            <small>${escapeHTML(preview)}</small>

            ${messageTime
              ? `<small>${escapeHTML(messageTime)}</small>`
              : ''
            }
          </div>

          <span class="conversation-status">
            ${escapeHTML(profile?.status || 'offline')}
          </span>

          ${unreadCount > 0
            ? `<span class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`
            : ''
          }
        </article>
      `;
    }).join('');

    list.querySelectorAll('.conversation-card').forEach(card => {
      const openChat = () => {
        renderChatScreen(card.dataset.conversationId);
      };

      card.addEventListener('click', openChat);

      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openChat();
        }
      });
    });

    message.textContent =
      `${conversations.length} conversation(s) found.`;

    message.className = 'auth-message success';

  } catch (error) {
    console.error('Conversations loading error:', error);

    message.textContent =
      error.message || 'Unable to load conversations.';

    message.className = 'auth-message error';
  }
}

// ========================================
// VIDLYRA CHAT - CREATE GROUP
// ========================================

let selectedGroupMembers = [];
let groupSearchResults = [];

function renderCreateGroup() {
  saveAppPage('create-group');

  selectedGroupMembers = [];
  groupSearchResults = [];

  app.innerHTML = `
    <main class="profile-layout">
      <header class="profile-header">
        <div class="profile-brand">
          <span class="profile-brand-icon">V</span>
          <span>VIDLYRA <b>CHAT</b></span>
        </div>

        <button class="back-btn" id="groupBackButton">
          ← Conversations
        </button>
      </header>

      <section class="profile-container">
        <div class="profile-heading">
          <div class="eyebrow">CONNECT TOGETHER</div>
          <h1>Create <span>group.</span></h1>
          <p>Build your own VIDLYRA community.</p>
        </div>

        <div class="profile-form-card">

          <label for="groupName">GROUP NAME</label>
          <input
            class="profile-input"
            id="groupName"
            type="text"
            maxlength="60"
            placeholder="Enter group name"
          >

          <label for="groupMemberSearch">
            ADD MEMBERS BY USERNAME
          </label>

          <div class="people-search-wrap">
            <span>@</span>
            <input
              class="profile-input"
              id="groupMemberSearch"
              type="text"
              maxlength="20"
              placeholder="Search username"
              autocomplete="off"
            >
          </div>

          <button
            type="button"
            class="primary-btn"
            id="groupSearchButton"
          >
            Search Members →
          </button>

          <div
            id="groupSearchMessage"
            class="auth-message"
          ></div>

          <div id="groupSearchResults" class="people-results"></div>

          <h3>Selected Members</h3>

          <div
            id="selectedGroupMembers"
            class="people-results"
          >
            <p class="description">No members selected yet.</p>
          </div>

          <div id="createGroupMessage" class="auth-message"></div>

          <button
            type="button"
            class="primary-btn"
            id="saveGroupButton"
          >
            Create Group →
          </button>

        </div>
      </section>
    </main>
  `;

  document.querySelector('#groupBackButton')
    .addEventListener('click', renderConversations);

  document.querySelector('#groupSearchButton')
    .addEventListener('click', searchGroupMembers);

  document.querySelector('#groupMemberSearch')
    .addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchGroupMembers();
      }
    });

  document.querySelector('#saveGroupButton')
    .addEventListener('click', createNewGroup);
}

async function searchGroupMembers() {
  const input = document.querySelector('#groupMemberSearch');
  const message = document.querySelector('#groupSearchMessage');
  const results = document.querySelector('#groupSearchResults');
  const button = document.querySelector('#groupSearchButton');

  const query = input.value.trim().replace(/^@/, '');

  if (query.length < 3) {
    message.textContent = 'Enter at least 3 characters.';
    message.className = 'auth-message error';
    return;
  }

  button.disabled = true;
  button.textContent = 'Searching...';

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .neq('id', currentUser.id)
      .ilike('username', `%${query}%`)
      .limit(20);

    if (error) throw error;

    groupSearchResults = data || [];

    if (!groupSearchResults.length) {
      results.innerHTML = '';
      message.textContent = 'No users found.';
      message.className = 'auth-message info';
      return;
    }

    message.textContent = `${data.length} member(s) found.`;
    message.className = 'auth-message success';

    results.innerHTML = groupSearchResults.map(user => {
      const selected = selectedGroupMembers.some(
        member => member.id === user.id
      );

      const avatar = user.avatar_url
        ? `<img src="${escapeHTML(user.avatar_url)}" alt="">`
        : '<span>V</span>';

      return `
        <article class="people-result">
          <div class="people-result-avatar">${avatar}</div>

          <div class="people-result-info">
            <strong>${escapeHTML(user.display_name || 'Member')}</strong>
            <span>@${escapeHTML(user.username)}</span>
          </div>

          <button
            type="button"
            class="people-request-btn"
            data-group-user="${escapeHTML(user.id)}"
          >
            ${selected ? 'Selected ✓' : 'Add +'}
          </button>
        </article>
      `;
    }).join('');

    results.querySelectorAll('[data-group-user]')
      .forEach(button => {
        button.addEventListener('click', () => {
          toggleGroupMember(button.dataset.groupUser);
        });
      });

  } catch (error) {
    console.error('Group member search error:', error);
    message.textContent = error.message || 'Search failed.';
    message.className = 'auth-message error';

  } finally {
    button.disabled = false;
    button.textContent = 'Search Members →';
  }
}

function toggleGroupMember(userId) {
  const user = groupSearchResults.find(item => item.id === userId);

  if (!user) return;

  const existingIndex = selectedGroupMembers.findIndex(
    member => member.id === userId
  );

  if (existingIndex >= 0) {
    selectedGroupMembers.splice(existingIndex, 1);
  } else {
    if (selectedGroupMembers.length >= 49) {
      alert('Maximum 50 members including you.');
      return;
    }

    selectedGroupMembers.push(user);
  }

  renderSelectedGroupMembers();
  refreshGroupSearchButtons();
}

function renderSelectedGroupMembers() {
  const container = document.querySelector('#selectedGroupMembers');

  if (!container) return;

  if (!selectedGroupMembers.length) {
    container.innerHTML =
      '<p class="description">No members selected yet.</p>';
    return;
  }

  container.innerHTML = selectedGroupMembers.map(user => `
    <article class="people-result">
      <div class="people-result-info">
        <strong>${escapeHTML(user.display_name || 'Member')}</strong>
        <span>@${escapeHTML(user.username)}</span>
      </div>

      <button
        type="button"
        class="people-reject-btn"
        data-remove-group-user="${escapeHTML(user.id)}"
      >
        Remove
      </button>
    </article>
  `).join('');

  container.querySelectorAll('[data-remove-group-user]')
    .forEach(button => {
      button.addEventListener('click', () => {
        toggleGroupMember(button.dataset.removeGroupUser);
      });
    });
}

function refreshGroupSearchButtons() {
  const results = document.querySelector('#groupSearchResults');

  if (!results) return;

  results.querySelectorAll('[data-group-user]').forEach(button => {
    const selected = selectedGroupMembers.some(
      member => member.id === button.dataset.groupUser
    );

    button.textContent = selected ? 'Selected ✓' : 'Add +';
  });
}

async function createNewGroup() {
  const nameInput = document.querySelector('#groupName');
  const button = document.querySelector('#saveGroupButton');
  const message = document.querySelector('#createGroupMessage');

  const name = nameInput.value.trim();

  if (!name || name.length > 60) {
    message.textContent = 'Enter a group name (1–60 characters).';
    message.className = 'auth-message error';
    return;
  }

  if (!currentUser) return;

  button.disabled = true;
  button.textContent = 'Creating group...';

  try {
    const { data, error } = await supabase.rpc(
      'create_chat_group',
      {
        p_name: name,
        p_member_ids: selectedGroupMembers.map(member => member.id)
      }
    );

    if (error) throw error;

    alert('Group created successfully!');

    await renderConversations();

  } catch (error) {
    console.error('Create group error:', error);

    message.textContent = error.message || 'Could not create group.';
    message.className = 'auth-message error';

    button.disabled = false;
    button.textContent = 'Create Group →';
  }
}

// ========================================
// VIDLYRA CHAT - GROUP CONVERSATIONS LIST
// ========================================

async function renderGroupConversations() {
  const list = document.querySelector('#groupConversationsList');

  if (!list || !currentUser) return;

  try {
    // Find groups where current user is a member
    const { data: memberships, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', currentUser.id);

    if (memberError) throw memberError;

    if (!memberships || memberships.length === 0) {
      list.innerHTML = `
        <p class="description">
          No groups yet. Create your first group!
        </p>
      `;
      return;
    }

    const groupIds = memberships.map(item => item.group_id);

    const { data: groups, error: groupError } = await supabase
      .from('group_conversations')
      .select('id, name, created_by, created_at')
      .in('id', groupIds)
      .order('created_at', { ascending: false });

    if (groupError) throw groupError;

    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('group_id, user_id, role')
      .in('group_id', groupIds);

    if (membersError) throw membersError;

    const { data: messages, error: messagesError } = await supabase
      .from('group_messages')
      .select('id, group_id, sender_id, content, created_at')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false });

    if (messagesError) throw messagesError;

    const latestMessageMap = new Map();

    (messages || []).forEach(item => {
      if (!latestMessageMap.has(item.group_id)) {
        latestMessageMap.set(item.group_id, item);
      }
    });

    list.innerHTML = (groups || []).map(group => {
      const count = (members || []).filter(
        member => member.group_id === group.id
      ).length;

      const latest = latestMessageMap.get(group.id);

      const preview = latest
        ? `${latest.sender_id === currentUser.id ? 'You: ' : ''}${latest.content}`
        : 'Start your group conversation';

      const time = latest
        ? new Date(latest.created_at).toLocaleString([], {
            dateStyle: 'short',
            timeStyle: 'short'
          })
        : '';

      return `
        <article
          class="people-result conversation-card group-conversation-card"
          data-group-id="${escapeHTML(group.id)}"
          role="button"
          tabindex="0"
        >
          <div class="people-result-avatar group-avatar">
            <span>👥</span>
          </div>

          <div class="people-result-info">
            <strong>${escapeHTML(group.name)}</strong>
            <span>${count} member(s)</span>
            <small>${escapeHTML(preview)}</small>
            ${time ? `<small>${escapeHTML(time)}</small>` : ''}
          </div>

          <span class="conversation-status">GROUP</span>
        </article>
      `;
    }).join('');

    list.querySelectorAll('.group-conversation-card')
      .forEach(card => {
        const openGroup = () => {
          renderGroupChatScreen(card.dataset.groupId);
        };

        card.addEventListener('click', openGroup);

        card.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openGroup();
          }
        });
      });

  } catch (error) {
    console.error('Group conversations error:', error);

    list.innerHTML = `
      <p class="auth-message error">
        ${escapeHTML(error.message || 'Unable to load groups.')}
      </p>
    `;
  }
}
// ========================================
// VIDLYRA CHAT - BLOCKED USERS
// ========================================

let currentChatBlocked = false;
let chatMessagingBlocked = false;

async function checkCurrentChatBlockStatus() {
    if (!currentUser?.id || !activeChatProfile?.id) return false;

    // Check whether YOU blocked this user
    const { data: ownBlock, error: ownError } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('blocker_id', currentUser.id)
        .eq('blocked_id', activeChatProfile.id)
        .maybeSingle();

    if (ownError) throw ownError;

    currentChatBlocked = !!ownBlock;

    // Check whether either person blocked the other
    const { data: blocked, error: blockedError } = await supabase.rpc(
        'is_chat_blocked',
        { p_other_user_id: activeChatProfile.id }
    );

    if (blockedError) throw blockedError;

    chatMessagingBlocked = !!blocked;

    return currentChatBlocked;
}
async function toggleCurrentChatBlock() {
    if (!currentUser?.id || !activeChatProfile?.id) return;

    const otherUserId = activeChatProfile.id;
    const otherName = activeChatProfile.display_name || 'this user';

    try {
        if (currentChatBlocked) {
            const confirmed = confirm(`Unblock ${otherName}?`);
            if (!confirmed) return;

            const { error } = await supabase
                .from('blocked_users')
                .delete()
                .eq('blocker_id', currentUser.id)
                .eq('blocked_id', otherUserId);

            if (error) throw error;

            alert(`${otherName} has been unblocked.`);
        } else {
            const confirmed = confirm(
                `Block ${otherName}?\n\nThey will not be able to exchange new messages or chat requests with you.`
            );

            if (!confirmed) return;

            const { error } = await supabase
                .from('blocked_users')
                .insert({
                    blocker_id: currentUser.id,
                    blocked_id: otherUserId
                });

            if (error) throw error;

            alert(`${otherName} has been blocked.`);
        }

        await checkCurrentChatBlockStatus();
        updateChatBlockUI();

    } catch (error) {
        console.error('Block action error:', error);
        alert(`Could not update block status: ${error.message}`);
    }
}

function updateChatBlockUI() {
    const button = document.querySelector('#chatBlockButton');
    const input = document.querySelector('#chatInput');
    const sendButton = document.querySelector('#chatSendButton');
    const message = document.querySelector('#chatMessage');

    if (button) {
    button.textContent = currentChatBlocked
        ? '🔓 Unblock User'
        : '🚫 Block User';
}

    if (input) {
        input.disabled = chatMessagingBlocked;
        input.placeholder = chatMessagingBlocked
            ? 'Messaging is unavailable.'
            : 'Type your message...';
    }

    if (sendButton) {
        sendButton.disabled = chatMessagingBlocked;
    }

    if (message && chatMessagingBlocked) {
        message.textContent =
            'Messaging is unavailable because one of you has blocked the other.';
        message.className = 'auth-message error';
    } else if (message) {
        message.textContent = '';
        message.className = 'auth-message';
    }
}


// BLOCKED USERS PAGE
async function renderBlockedUsers() {
    if (!currentUser?.id) return;

    saveAppPage('blocked-users');

    app.innerHTML = `
        <main class="profile-layout">
            <header class="profile-header">
                <div class="profile-brand">
                    <span class="profile-brand-icon">V</span>
                    <span>VIDLYRA <b>CHAT</b></span>
                </div>

                <button class="back-btn" id="blockedUsersBackButton">
                    ← Conversations
                </button>
            </header>

            <section class="profile-container">
                <div class="profile-heading">
                    <div class="eyebrow">PRIVACY & SAFETY</div>
                    <h1>Blocked <span>users.</span></h1>
                    <p>Manage people you have blocked.</p>
                </div>

                <div class="profile-form-card">
                    <div id="blockedUsersMessage" class="auth-message">
                        Loading blocked users...
                    </div>
                    <div id="blockedUsersList" class="people-results"></div>
                </div>
            </section>
        </main>
    `;

    document.querySelector('#blockedUsersBackButton')
        .addEventListener('click', renderConversations);

    const message = document.querySelector('#blockedUsersMessage');
    const list = document.querySelector('#blockedUsersList');

    try {
        const { data: blockedRows, error } = await supabase
            .from('blocked_users')
            .select('id, blocked_id, created_at')
            .eq('blocker_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!blockedRows?.length) {
            message.textContent = 'You have not blocked anyone.';
            message.className = 'auth-message success';
            list.innerHTML = '';
            return;
        }

        const blockedIds = blockedRows.map(row => row.blocked_id);

        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', blockedIds);

        if (profilesError) throw profilesError;

        const profileMap = new Map(
            (profiles || []).map(profile => [profile.id, profile])
        );

        message.textContent = `${blockedRows.length} blocked user(s).`;
        message.className = 'auth-message';

        list.innerHTML = blockedRows.map(row => {
            const profile = profileMap.get(row.blocked_id);
            const name = profile?.display_name || 'VIDLYRA Member';
            const avatar = profile?.avatar_url
                ? `<img src="${escapeHTML(profile.avatar_url)}" alt="">`
                : '<span>V</span>';

            return `
                <article class="people-result blocked-user-card">
                    <div class="people-result-avatar">
                        ${avatar}
                    </div>

                    <div class="people-result-info">
                        <strong>${escapeHTML(name)}</strong>
                        <span>@${escapeHTML(profile?.username || 'unknown')}</span>
                    </div>

                    <button
                        type="button"
                        class="back-btn unblock-user-btn"
                        data-user-id="${escapeHTML(row.blocked_id)}"
                    >
                        Unblock
                    </button>
                </article>
            `;
        }).join('');

        list.querySelectorAll('.unblock-user-btn')
            .forEach(button => {
                button.addEventListener('click', async () => {
                    const userId = button.dataset.userId;

                    if (!confirm('Unblock this user?')) return;

                    button.disabled = true;

                    try {
                        const { error } = await supabase
                            .from('blocked_users')
                            .delete()
                            .eq('blocker_id', currentUser.id)
                            .eq('blocked_id', userId);

                        if (error) throw error;

                        await renderBlockedUsers();

                    } catch (error) {
                        console.error('Unblock error:', error);
                        alert(`Could not unblock user: ${error.message}`);
                        button.disabled = false;
                    }
                });
            });

    } catch (error) {
        console.error('Blocked users loading error:', error);
        message.textContent = error.message || 'Unable to load blocked users.';
        message.className = 'auth-message error';
    }
}
// ========================================
// VIDLYRA CHAT - ONE TO ONE MESSAGING
// ========================================

let activeConversationId = null;
let activeChatProfile = null;
let selectedChatMessageId = null;
let chatSending = false;

async function renderChatScreen(conversationId) {
    saveAppPage('chat', { conversationId });

    if (!currentUser || !conversationId) return;

    activeConversationId = conversationId;

    subscribeToChatMessages(conversationId);

    app.innerHTML = `
        <main class="profile-layout chat-layout">

            <header class="profile-header">
                <div class="profile-brand">
                    <span class="profile-brand-icon">V</span>
                    <span>VIDLYRA <b>CHAT</b></span>
                </div>

                <button class="back-btn" id="chatBackButton">
                    ← Conversations
                </button>
            </header>

            <section class="profile-container chat-container">
                <div class="profile-form-card chat-card">

                    <div class="chat-user-header" id="chatUserHeader">
                        Loading conversation...
                    </div>

                    <div class="chat-messages"
                         id="chatMessages"
                         aria-live="polite">
                        <p class="description">Loading messages...</p>
                    </div>

                    <div id="chatAttachmentPreview"
                         class="chat-attachment-preview"
                         hidden></div>

                    <form class="chat-composer" id="chatForm">

                        <label class="chat-attach-btn"
                               for="chatMediaInput"
                               title="Attach image or file">
                            📎
                        </label>

                        <input
                            type="file"
                            id="chatMediaInput"
                            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain"
                            hidden
                        >

                        <textarea
                            class="profile-input chat-input"
                            id="chatInput"
                            placeholder="Type your message..."
                            maxlength="5000"
                            rows="2"
                        ></textarea>

                        <button
                            class="primary-btn chat-send-btn"
                            id="chatSendButton"
                            type="submit">
                            Send →
                        </button>

                    </form>

                    <div class="auth-message"
                         id="chatMessage"
                         aria-live="polite"></div>

                </div>
            </section>
        </main>
    `;

    document.querySelector('#chatBackButton')
        .addEventListener('click', renderConversations);

    document.querySelector('#chatForm')
        .addEventListener('submit', sendChatMessage);

    // Attachment selection
    document.querySelector('#chatMediaInput')
        .addEventListener('change', event => {
            const file = event.target.files?.[0];

            if (!file) return;

            try {
                validateChatMedia(file);

                selectedChatMediaFile = file;

                showSelectedMedia(
                    file,
                    'chatAttachmentPreview'
                );

                document.querySelector('#chatMessage').textContent = '';

            } catch (error) {
                selectedChatMediaFile = null;
                event.target.value = '';

                const message = document.querySelector('#chatMessage');
                message.textContent = error.message;
                message.className = 'auth-message error';
            }
        });

    document.querySelector('#chatInput')
        .addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                document.querySelector('#chatForm').requestSubmit();
            }
        });

    await loadChatConversation();
}

// ========================================
// VIDLYRA CHAT - GROUP MESSAGING
// ========================================

let activeGroupId = null;
let groupRealtimeChannel = null;
let groupSending = false;

async function renderGroupChatScreen(groupId) {
    if (!currentUser || !groupId) return;

    saveAppPage('group-chat', { groupId });

    activeGroupId = groupId;
    activeConversationId = null;

    if (chatRealtimeChannel) {
        await supabase.removeChannel(chatRealtimeChannel);
        chatRealtimeChannel = null;
    }

    subscribeToGroupMessages(groupId);

    app.innerHTML = `
        <main class="profile-layout chat-layout">
            <header class="profile-header">
                <div class="profile-brand">
                    <span class="profile-brand-icon">V</span>
                    <span>VIDLYRA <b>CHAT</b></span>
                </div>

                <button class="back-btn" id="groupChatBackButton">
                    ← Group Chats
                </button>
            </header>

            <section class="profile-container chat-container">
                <div class="profile-form-card chat-card">

                    <div class="chat-user-header" id="groupChatHeader">
                        Loading group...
                    </div>

                    <div class="chat-messages"
                         id="groupChatMessages"
                         aria-live="polite">
                        <p class="description">Loading messages...</p>
                    </div>

                    <div id="groupAttachmentPreview"
                         class="chat-attachment-preview"></div>

                    <form class="chat-composer" id="groupChatForm">

                        <input
                            type="file"
                            id="groupMediaInput"
                            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain"
                            hidden
                        >

                        <button
                            type="button"
                            class="chat-attach-btn"
                            id="groupAttachButton"
                            title="Attach image or file">
                            +
                        </button>

                        <textarea
                            class="profile-input chat-input"
                            id="groupChatInput"
                            placeholder="Message your group..."
                            maxlength="5000"
                            rows="2"
                        ></textarea>

                        <button
                            class="primary-btn chat-send-btn"
                            id="groupChatSendButton"
                            type="submit">
                            Send →
                        </button>
                    </form>

                    <div class="auth-message"
                         id="groupChatMessage"
                         aria-live="polite"></div>
                </div>
            </section>
        </main>
    `;

    document.querySelector('#groupChatBackButton')
        .addEventListener('click', renderConversations);

    document.querySelector('#groupChatForm')
        .addEventListener('submit', sendGroupMessage);

    document.querySelector('#groupAttachButton')
        .addEventListener('click', () => {
            document.querySelector('#groupMediaInput').click();
        })

    document.querySelector('#groupMediaInput')
    .addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;

        const validation = validateChatMedia(file);
        const message = document.querySelector('#groupChatMessage');

        if (!validation.valid) {
            if (message) {
                message.textContent = validation.message;
                message.className = 'auth-message error';
            }

            event.target.value = '';
            selectedGroupMediaFile = null;
            return;
        }

        selectedGroupMediaFile = file;
        showSelectedMedia(file, 'groupAttachmentPreview');

        if (message) {
            message.textContent = '';
            message.className = 'auth-message';
        }
    });

    await loadGroupMessages();
}
// ========================================
// LOAD GROUP DETAILS AND MESSAGES
// ========================================


async function loadGroupMessages() {
    if (!activeGroupId || !currentUser) return;

    const groupId = activeGroupId;

    const messagesContainer =
        document.querySelector('#groupChatMessages');

    const header =
        document.querySelector('#groupChatHeader');

    if (!messagesContainer || !header) return;
    selectedChatMessageId = null;

const editSelectedButton = document.querySelector('#editSelectedMessageButton');
const deleteSelectedButton = document.querySelector('#deleteSelectedMessageButton');

if (editSelectedButton) editSelectedButton.disabled = true;
if (deleteSelectedButton) deleteSelectedButton.disabled = true;

messagesContainer
    .querySelectorAll('.chat-message-row.is-selected')
    .forEach(row => row.classList.remove('is-selected'));
    try {
        // LOAD GROUP, MEMBERS AND MESSAGES
        const [
            { data: group, error: groupError },
            { data: members, error: membersError },
            { data: messages, error: messagesError }
        ] = await Promise.all([

            supabase
                .from('group_conversations')
                .select('id, name, created_by')
                .eq('id', groupId)
                .single(),

            supabase
                .from('group_members')
                .select('user_id, role')
                .eq('group_id', groupId),

            supabase
                .from('group_messages')
                .select(`
                    id,
                    group_id,
                    sender_id,
                    content,
                    created_at,
                    message_type,
                    media_path,
                    media_name,
                    media_mime_type,
                    media_size
                `)
                .eq('group_id', groupId)
                .order('created_at', { ascending: true })

        ]);

        if (groupError) throw groupError;
        if (membersError) throw membersError;
        if (messagesError) throw messagesError;

        // CHECK GROUP MEMBERSHIP
        const memberIds = (members || []).map(
            item => item.user_id
        );

        if (!memberIds.includes(currentUser.id)) {
            throw new Error(
                'You are no longer a member of this group.'
            );
        }

        // LOAD MEMBER PROFILES
        let profiles = [];

        if (memberIds.length > 0) {
            const {
                data,
                error: profilesError
            } = await supabase
                .from('profiles')
                .select(`
                    id,
                    username,
                    display_name,
                    avatar_url
                `)
                .in('id', memberIds);

            if (profilesError) throw profilesError;

            profiles = data || [];
        }

        // CREATE PROFILE MAP
        const profileMap = new Map(
            profiles.map(profile => [
                profile.id,
                profile
            ])
        );

        // UPDATE GROUP HEADER
        header.innerHTML = `
            <div class="group-header-info">
                <strong>${escapeHTML(group.name)}</strong>
                <small>${memberIds.length} members</small>
            </div>
        `;

        // EMPTY GROUP CHAT
        if (!messages || messages.length === 0) {
            messagesContainer.innerHTML = `
                <p class="description">
                    No messages yet. Start the conversation!
                </p>
            `;
            return;
        }

        // RENDER ALL GROUP MESSAGES
        const renderedMessages = await Promise.all(
            messages.map(async item => {

                const own =
                    item.sender_id === currentUser.id;

                const sender =
                    profileMap.get(item.sender_id);

                const senderName =
                    sender?.display_name ||
                    sender?.username ||
                    'VIDLYRA Member';

                const messageTime = new Date(
                    item.created_at
                ).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // LOAD IMAGE / FILE MARKUP
                const mediaMarkup =
                    await createChatMediaMarkup(item);

                // CHECK MEDIA PLACEHOLDER
                const content =
                    String(item.content || '');

                const isMediaMarker =
                    content === '📷 Image' ||
                    content.startsWith('📎 ');

                // TEXT MESSAGE MARKUP
                const textMarkup = isMediaMarker
                    ? ''
                    : `<p>${escapeHTML(content)}</p>`;

                // COMPLETE MESSAGE HTML
                return `
                    <div
    class="chat-message-row ${own ? 'sent' : 'received'}"
    data-message-id="${escapeHTML(item.id)}"
    data-message-owner="${own ? 'true' : 'false'}">

                        <div class="chat-message-bubble">

                            ${!own ? `
                                <small class="group-sender-name">
                                    ${escapeHTML(senderName)}
                                </small>
                            ` : ''}

                            ${mediaMarkup}

                            ${textMarkup}

                            <small class="message-time">
                                ${escapeHTML(messageTime)}
                            </small>

                        </div>

                    </div>
                `;
            })
        );

        // DISPLAY MESSAGES
        messagesContainer.innerHTML =
            renderedMessages.join('');

        // SCROLL TO LATEST MESSAGE
        messagesContainer.scrollTop =
            messagesContainer.scrollHeight;

    } catch (error) {

        console.error(
            'Load group messages error:',
            error
        );

        messagesContainer.innerHTML = `
            <p class="auth-message error">
                ${escapeHTML(
                    error.message ||
                    'Unable to load group messages.'
                )}
            </p>
        `;
    }
}

// ========================================
// SEND GROUP MESSAGE
// ========================================

async function sendGroupMessage(event) {
    event.preventDefault();

    if (!activeGroupId || !currentUser || groupSending) return;

    const input = document.querySelector('#groupChatInput');
    const button = document.querySelector('#groupChatSendButton');
    const message = document.querySelector('#groupChatMessage');

    const content = input.value.trim();
    const file = selectedGroupMediaFile;

    if (!content && !file) return;

    if (content.length > 5000) {
        message.textContent = 'Message cannot exceed 5000 characters.';
        message.className = 'auth-message error';
        return;
    }

    groupSending = true;
    button.disabled = true;
    button.textContent = 'Sending...';

    let uploadedPath = null;

    try {
        let mediaType = 'text';

        if (file) {
            mediaType = file.type.startsWith('image/') ? 'image' : 'file';

            button.textContent = 'Uploading...';

            uploadedPath = await uploadChatMedia(
                file,
                'group',
                activeGroupId
            );
        }

        const messageContent = content ||
            (mediaType === 'image' ? '📷 Image' : `📎 ${file.name}`);

        const { error } = await supabase
            .from('group_messages')
            .insert({
                group_id: activeGroupId,
                sender_id: currentUser.id,
                content: messageContent,
                message_type: mediaType,
                media_path: uploadedPath,
                media_name: file?.name || null,
                media_mime_type: file?.type || null,
                media_size: file?.size || null
            });

        if (error) throw error;

        input.value = '';
        clearChatMediaSelection('group');

        message.textContent = 'Message sent ✓';
        message.className = 'auth-message success';

        await loadGroupMessages();

    } catch (error) {
        console.error('Group message sending error:', error);

        if (uploadedPath) {
            await supabase.storage
                .from(CHAT_MEDIA_BUCKET)
                .remove([uploadedPath]);
        }

        message.textContent =
            error.message || 'Unable to send group message.';

        message.className = 'auth-message error';

    } finally {
        groupSending = false;

        if (button.isConnected) {
            button.disabled = false;
            button.textContent = 'Send →';
        }
    }
}

// ========================================
// GROUP MESSAGE REALTIME
// ========================================

function subscribeToGroupMessages(groupId) {
    if (groupRealtimeChannel) {
        supabase.removeChannel(groupRealtimeChannel);
        groupRealtimeChannel = null;
    }

    groupRealtimeChannel = supabase
        .channel(`group-messages-${groupId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'group_messages',
                filter: `group_id=eq.${groupId}`
            },
            async payload => {
                if (activeGroupId !== groupId) return;

                // Own messages are refreshed after successful sending.
                if (payload.new.sender_id === currentUser?.id) return;

                await loadGroupMessages();
            }
        )
       .subscribe((status, err) => {
    console.log('Realtime Status:', status);

    if (err) {
        console.error('Realtime Error Details:', err);
    }
});
}

// ========================================
// LOAD CHAT DETAILS AND MESSAGES
// ========================================

async function loadChatConversation() {
  if (!activeConversationId || !currentUser) return;

  const messagesContainer =
    document.querySelector('#chatMessages');

  const header =
    document.querySelector('#chatUserHeader');

  if (!messagesContainer || !header) return;



  try {
    const conversationId = activeConversationId;

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('id, user_one, user_two')
      .eq('id', conversationId)
      .maybeSingle();

    if (error) throw error;

    if (
      !conversation ||
      ![conversation.user_one, conversation.user_two]
        .includes(currentUser.id)
    ) {
      throw new Error('Conversation not found or access denied.');
    }

    const otherUserId =
      conversation.user_one === currentUser.id
        ? conversation.user_two
        : conversation.user_one;

    // MARK INCOMING MESSAGES AS READ

    const { error: readError } = await supabase.rpc(
      'mark_conversation_messages_read',
      {
        p_conversation_id: conversationId
      }
    );

    if (readError) throw readError;

    if (activeConversationId !== conversationId) return;

    // LOAD OTHER USER PROFILE

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, status')
      .eq('id', otherUserId)
      .maybeSingle();

    if (profileError) throw profileError;

    activeChatProfile = profile;
    await checkCurrentChatBlockStatus();
    
    const name = profile?.display_name || 'VIDLYRA Member';
    const username = profile?.username || 'unknown';

    const avatar = profile?.avatar_url
      ? `<img src="${escapeHTML(profile.avatar_url)}" alt="">`
      : '<span>V</span>';

    header.innerHTML = `
      <div class="chat-user-avatar">
        ${avatar}
      </div>

      <div class="chat-user-info">
        <strong>${escapeHTML(name)}</strong>
        <span>@${escapeHTML(username)}</span>
        <small>${escapeHTML(profile?.status || 'offline')}</small>
      </div>

      <div class="chat-header-actions">
  <button
    type="button"
    class="back-btn chat-refresh-btn"
    id="refreshChatButton">
    ↻ Refresh
  </button>

  <details class="chat-options-menu">
    <summary aria-label="Chat options">⋮</summary>

    <div class="chat-options-dropdown">

    <button type="button" id="editSelectedMessageButton" disabled>
        ✏️ Edit Selected Message
    </button>

    <button type="button" id="deleteSelectedMessageButton" disabled>
        🗑️ Delete Selected Message
    </button>

    <hr>

    <button type="button" id="chatBlockButton">
        ${currentChatBlocked ? '🔓 Unblock User' : '🚫 Block User'}
    </button>

</div>
  </details>
</div>
    `;

    document.querySelector('#refreshChatButton')
      .addEventListener('click', loadChatConversation);
        document.querySelector('#chatBlockButton')
      .addEventListener('click', toggleCurrentChatBlock);

    updateChatBlockUI();
    // LOAD MESSAGE HISTORY

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select(`
    id,
    sender_id,
    content,
    created_at,
    is_read,
    message_type,
    media_path,
    media_name,
    media_mime_type,
    media_size,
    edited_at
`)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    if (activeConversationId !== conversationId) return;

    if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = `
        <p class="description">
            No messages yet. Start the conversation!
        </p>
    `;
    return;
}

messagesContainer.innerHTML = (
    await Promise.all(
        messages.map(async item => {
            const own = item.sender_id === currentUser.id;
            const senderName = own
            ? 'You'
           : (
           activeChatProfile?.display_name ||
            activeChatProfile?.username ||
            'VIDLYRA Member'
           );

            const messageTime = new Date(item.created_at)
                .toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });

            const mediaMarkup = await createChatMediaMarkup(item);

            const isMediaPlaceholder =
                item.content === '📷 Image' ||
                item.content === '📎 File';

            return `
    <div
    class="chat-message-row ${own ? 'sent' : 'received'}"
    data-message-id="${escapeHTML(item.id)}"
    data-message-owner="${own ? 'true' : 'false'}"
    data-message-can-edit="${own && item.message_type === 'text' && !item.media_path ? 'true' : 'false'}"
>

        <div class="chat-message-bubble">

            ${!own ? `
                <small class="group-sender-name">
                    ${escapeHTML(senderName)}
                </small>
            ` : ''}

            ${mediaMarkup}

            ${!isMediaPlaceholder ? `
                <div class="chat-message-content">
                    ${escapeHTML(item.content)}
                </div>
            ` : ''}

            <small class="message-time">
                ${escapeHTML(messageTime)}
            </small>
             ${item.edited_at ? `
            <small class="message-edited-label">
              ✏️ Edited
              </small>
             ` : ''}

        </div>

    </div>
`;
        })
    )
).join('');

messagesContainer.scrollTop = messagesContainer.scrollHeight;
messagesContainer.onclick = async event => {
    // SELECT MESSAGE
    const actionTarget = event.target.closest(
        '[data-edit-message], [data-delete-message]'
        
    );
        // HEADER MENU ACTIONS
    const editSelectedButton = document.querySelector('#editSelectedMessageButton');
    const deleteSelectedButton = document.querySelector('#deleteSelectedMessageButton');

    if (editSelectedButton) {
        editSelectedButton.onclick = async () => {
            if (!selectedChatMessageId) return;

            const trigger = document.createElement('button');
            trigger.dataset.editMessage = selectedChatMessageId;

            const menu = document.querySelector('.chat-options-menu');
            if (menu) menu.open = false;

            await messagesContainer.onclick({ target: trigger });
        };
    }

    if (deleteSelectedButton) {
        deleteSelectedButton.onclick = async () => {
            if (!selectedChatMessageId) return;

            const trigger = document.createElement('button');
            trigger.dataset.deleteMessage = selectedChatMessageId;

            const menu = document.querySelector('.chat-options-menu');
            if (menu) menu.open = false;

            await messagesContainer.onclick({ target: trigger });
        };
    }

    if (!actionTarget) {
        const row = event.target.closest('.chat-message-row');

        if (!row) return;

        messagesContainer
            .querySelectorAll('.chat-message-row.is-selected')
            .forEach(item => item.classList.remove('is-selected'));

        row.classList.add('is-selected');

        selectedChatMessageId = row.dataset.messageId;

        const isOwnMessage = row.dataset.messageOwner === 'true';
        const canEdit = row.dataset.messageCanEdit === 'true';

        const editButton = document.querySelector('#editSelectedMessageButton');
        const deleteButton = document.querySelector('#deleteSelectedMessageButton');

        if (editButton) editButton.disabled = !(isOwnMessage && canEdit);
        if (deleteButton) deleteButton.disabled = !isOwnMessage;

        return;
    }
    // EDIT MESSAGE
    const editButton = event.target.closest('[data-edit-message]');

    if (editButton) {
        const messageId = editButton.dataset.editMessage;

        const { data: message, error: fetchError } = await supabase
            .from('messages')
            .select('content')
            .eq('id', messageId)
            .eq('conversation_id', activeConversationId)
            .eq('sender_id', currentUser.id)
            .eq('message_type', 'text')
            .is('media_path', null)
            .single();

        if (fetchError || !message) {
            alert('Could not load this message.');
            return;
        }

        const newContent = prompt('Edit your message:', message.content);

        if (newContent === null) return;

        const trimmedContent = newContent.trim();

        if (!trimmedContent) {
            alert('Message cannot be empty.');
            return;
        }

        if (trimmedContent === message.content) return;

        editButton.disabled = true;

        try {
            const { error } = await supabase
                .from('messages')
                .update({
    content: trimmedContent,
    edited_at: new Date().toISOString()
})
                .eq('id', messageId)
                .eq('conversation_id', activeConversationId)
                .eq('sender_id', currentUser.id)
                .eq('message_type', 'text')
                .is('media_path', null);

            if (error) throw error;

            await loadChatConversation();

        } catch (error) {
            console.error('Edit message error:', error);
            alert(error.message || 'Could not edit message.');
            editButton.disabled = false;
        }

        return;
    }


    // DELETE MESSAGE
    
// DELETE MESSAGE
const deleteButton = event.target.closest('[data-delete-message]');

if (!deleteButton) return;

const messageId = deleteButton.dataset.deleteMessage;

if (!confirm('Delete this message permanently?')) return;

deleteButton.disabled = true;
deleteButton.textContent = 'Deleting...';

try {
    // 1. Get the media path before deleting the message
    const { data: message, error: fetchError } = await supabase
        .from('messages')
        .select('media_path')
        .eq('id', messageId)
        .eq('conversation_id', activeConversationId)
        .eq('sender_id', currentUser.id)
        .maybeSingle();

    if (fetchError) throw fetchError;

    // 2. Delete the database message
    const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId)
        .eq('conversation_id', activeConversationId)
        .eq('sender_id', currentUser.id);

    if (deleteError) throw deleteError;

    // 3. Delete the actual file from Supabase Storage
    if (message?.media_path) {
        const { error: storageError } = await supabase
            .storage
            .from('chat-media')
            .remove([message.media_path]);

        if (storageError) {
            console.error('Storage cleanup error:', storageError);

            alert(
                'Message deleted, but the media file could not be removed from Storage. Check Storage DELETE permissions.'
            );
        }
    }

    // 4. Refresh conversation
    await loadChatConversation();

} catch (error) {
    console.error('Delete message error:', error);
    alert(error.message || 'Could not delete message.');

    deleteButton.disabled = false;
    deleteButton.textContent = 'Delete';
}

    try {
        const { error } = await supabase
            .from('messages')
            .delete()
            .eq('id', messageId)
            .eq('conversation_id', activeConversationId)
            .eq('sender_id', currentUser.id);

        if (error) throw error;

        await loadChatConversation();

    } catch (error) {
        console.error('Delete message error:', error);
        alert(error.message || 'Could not delete message.');

        deleteButton.disabled = false;
        deleteButton.textContent = 'Delete';
    }
};
// HEADER MENU ACTIONS
const editSelectedButton = document.querySelector('#editSelectedMessageButton');
const deleteSelectedButton = document.querySelector('#deleteSelectedMessageButton');

if (editSelectedButton) {
    editSelectedButton.onclick = async () => {
        if (!selectedChatMessageId) return;

        const trigger = document.createElement('button');
        trigger.dataset.editMessage = selectedChatMessageId;

        const menu = document.querySelector('.chat-options-menu');
        if (menu) menu.open = false;

        await messagesContainer.onclick({ target: trigger });
    };
}

if (deleteSelectedButton) {
    deleteSelectedButton.onclick = async () => {
        if (!selectedChatMessageId) return;

        const trigger = document.createElement('button');
        trigger.dataset.deleteMessage = selectedChatMessageId;

        const menu = document.querySelector('.chat-options-menu');
        if (menu) menu.open = false;

        await messagesContainer.onclick({ target: trigger });
    };
}
  } catch (error) {
    console.error('Chat loading error:', error);

    messagesContainer.innerHTML = `
      <p class="auth-message error">
        ${escapeHTML(error.message || 'Unable to load messages.')}
      </p>
    `;
  }
}

// ========================================
// SEND CHAT MESSAGE
// ========================================

async function sendChatMessage(event) {
    event.preventDefault();

    if (chatSending || !currentUser || !activeConversationId) return;

    const input = document.querySelector('#chatInput');
    const button = document.querySelector('#chatSendButton');
    const message = document.querySelector('#chatMessage');

    const content = input.value.trim();
    const file = selectedChatMediaFile;

    if (!content && !file) return;

    if (content.length > 5000) {
        message.textContent = 'Message cannot exceed 5000 characters.';
        message.className = 'auth-message error';
        return;
    }

    chatSending = true;
    button.disabled = true;
    button.textContent = 'Sending...';

    let uploadedPath = null;

    try {
        let mediaType = 'text';

        if (file) {
            mediaType = file.type.startsWith('image/')
                ? 'image'
                : 'file';

            button.textContent = 'Uploading...';

            uploadedPath = await uploadChatMedia(
                file,
                'direct',
                activeConversationId
            );
        }

        const messageContent = content ||
            (mediaType === 'image' ? '📷 Image' : `📎 ${file.name}`);

        const { error } = await supabase
            .from('messages')
            .insert({
                conversation_id: activeConversationId,
                sender_id: currentUser.id,
                content: messageContent,
                message_type: mediaType,
                media_path: uploadedPath,
                media_name: file?.name || null,
                media_mime_type: file?.type || null,
                media_size: file?.size || null
            });

        if (error) throw error;

        input.value = '';
        clearChatMediaSelection('direct');

        message.textContent = 'Message sent ✓';
        message.className = 'auth-message success';

        await loadChatConversation();
        input.focus();

    } catch (error) {
        console.error('Send message error:', error);

        // Remove uploaded object if its message could not be saved.
        if (uploadedPath) {
            await supabase.storage
                .from(CHAT_MEDIA_BUCKET)
                .remove([uploadedPath]);
        }

        message.textContent =
            error.message || 'Unable to send message.';

        message.className = 'auth-message error';

    } finally {
        chatSending = false;

        const currentButton =
            document.querySelector('#chatSendButton');

        if (currentButton) {
            currentButton.disabled = false;
            currentButton.textContent = 'Send →';
        }
    }
}

// ========================================
// SUPABASE REALTIME - LIVE MESSAGES
// ========================================

let chatRealtimeChannel = null;

function subscribeToChatMessages(conversationId) {
  if (chatRealtimeChannel) {
    supabase.removeChannel(chatRealtimeChannel);
    chatRealtimeChannel = null;
  }

  chatRealtimeChannel = supabase
    .channel(`chat-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      },
      async payload => {
        if (activeConversationId !== conversationId) return;

        if (payload.new.sender_id === currentUser?.id) return;

        await loadChatConversation();
      }
    )
   .subscribe((status, err) => {
    console.log('Chat Realtime Status:', status);

    if (err) {
        console.error('Chat Realtime Error Details:', err);
    }
});
}
// ========================================
// SIGN OUT
// ========================================

async function signOut() {
  if (busy) return;

  busy = true;

  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    currentUser = null;
    if (messageNotificationChannel) {
  supabase.removeChannel(messageNotificationChannel);
  messageNotificationChannel = null;
}
 if (groupNotificationChannel) {
    await supabase.removeChannel(groupNotificationChannel);
    groupNotificationChannel = null;
}
if (chatRealtimeChannel) {
  supabase.removeChannel(chatRealtimeChannel);
  chatRealtimeChannel = null;
}
    localStorage.removeItem(APP_STATE_KEY);
    renderLogin();

  } catch (error) {
    alert(`Sign out failed: ${error.message}`);

  } finally {
    busy = false;
  }
}

// ========================================
// INITIALIZE APPLICATION
// ========================================

async function initializeApp() {
  renderLoading();

  try {

    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
    currentUser = data.session.user;
    await restoreLastPage(currentUser);
    subscribeToUserMessages();
    subscribeToUserGroupMessages();
  } else {
    sessionStorage.removeItem(APP_STATE_KEY);
    renderLogin();
  }

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {

        if (event === 'SIGNED_IN' && session?.user) {
          currentUser = session.user;
          renderDashboard(session.user);
        }

        if (event === 'SIGNED_OUT') {
          currentUser = null;
          if (messageNotificationChannel) {
         supabase.removeChannel(messageNotificationChannel);
         messageNotificationChannel = null;
         }
        
         if (chatRealtimeChannel) {
         supabase.removeChannel(chatRealtimeChannel);
         chatRealtimeChannel = null;
         }
          localStorage.removeItem(APP_STATE_KEY);
          renderLogin();
        }

      }
    );

    authSubscription = listener.subscription;

  } catch (error) {

    console.error('Session initialization error:', error);

    app.innerHTML = `
      <main class="auth-layout">
        ${brandHTML()}

        <section class="auth-panel">
          <div class="auth-card">

            <h2>Connection <span>error.</span></h2>

            <p class="description">
              ${escapeHTML(error.message)}
            </p>

            <button
              class="primary-btn"
              id="retryButton"
            >
              Retry
            </button>

          </div>
        </section>
      </main>
    `;

    document.querySelector('#retryButton')
      .addEventListener('click', () => location.reload());
  }
}

// ========================================
// CLEANUP
// ========================================

window.addEventListener('beforeunload', () => {
  authSubscription?.unsubscribe();
});

// START APPLICATION

initializeApp();
