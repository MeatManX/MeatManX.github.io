(() => {
  'use strict';

  const root = document.querySelector('[data-adoption-app]');
  if (!root) return;

  const gateway = String(root.dataset.gateway || '').replace(/\/$/, '');
  const sessionKey = 'ogx_afk_web_session_v1';
  let token = sessionStorage.getItem(sessionKey) || '';

  const signedOut = document.getElementById('signed-out');
  const signedIn = document.getElementById('signed-in');
  const loading = document.getElementById('application-loading');
  const host = document.getElementById('application-host');
  const identity = document.getElementById('discord-identity');
  const signin = document.getElementById('discord-signin');
  const signout = document.getElementById('discord-signout');
  const notice = document.getElementById('gate-notice');
  const successModal = document.getElementById('success-modal');
  const errorModal = document.getElementById('error-modal');
  const errorDetail = document.getElementById('error-detail');

  function takeSessionFromFragment() {
    if (!location.hash.startsWith('#afk_session=')) return;
    const value = decodeURIComponent(location.hash.slice('#afk_session='.length));
    if (value) {
      token = value;
      sessionStorage.setItem(sessionKey, value);
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  function show(element, visible) {
    element.classList.toggle('hidden', !visible);
  }

  function showNotice(message, kind = '') {
    notice.textContent = message;
    notice.className = 'notice' + (kind ? ' ' + kind : '');
  }

  function clearNotice() {
    notice.textContent = '';
    notice.className = 'notice hidden';
  }

  function openModal(modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function api(path, body = {}) {
    const response = await fetch(gateway + path, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.message || payload.error || ('HTTP ' + response.status));
      error.code = payload.error || 'request_failed';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setMetadata(form) {
    form.querySelector('#form_started_at').value = new Date().toISOString();
    form.querySelector('#browser_user_agent').value = navigator.userAgent;
    form.querySelector('#screen_resolution').value =
      window.screen.width + 'x' + window.screen.height;
    form.querySelector('#timezone').value =
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    form.querySelector('#page_url').value = location.origin + location.pathname;

    const tourTotal = sessionStorage.getItem('xbox_tour_total_seconds');
    const tourSteps = sessionStorage.getItem('xbox_tour_step_times');
    const tourStartedAt = sessionStorage.getItem('xbox_tour_started_at');
    if (tourTotal !== null) {
      form.querySelector('#tour_total_seconds').value = tourTotal + 's';
      form.querySelector('#tour_step_times').value = tourSteps || '';
      form.querySelector('#tour_started_at').value = tourStartedAt || '';
    }
  }

  function formPayload(form) {
    const values = {};
    for (const [name, value] of new FormData(form).entries()) {
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        values[name] += ' | ' + value;
      } else {
        values[name] = value;
      }
    }
    values.submitted_at = new Date().toISOString();
    return values;
  }

  function attachForm() {
    const form = document.getElementById('adoptionForm');
    if (!form) throw new Error('The authenticated form could not be loaded.');
    setMetadata(form);
    const status = document.getElementById('form-status');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.style.display = 'block';
      status.textContent = 'Submitting authenticated application…';
      clearNotice();

      try {
        const result = await api('/v1/web/application/submit', formPayload(form));
        status.textContent = '';
        status.style.display = 'none';
        form.reset();
        document.getElementById('submission-id').textContent =
          result.submission_id || 'recorded';
        openModal(successModal);
      } catch (error) {
        status.textContent = '';
        status.style.display = 'none';
        errorDetail.textContent = error.message || 'The application could not be submitted.';
        openModal(errorModal);
        if (error.status === 401) {
          token = '';
          sessionStorage.removeItem(sessionKey);
        }
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadAuthenticatedForm() {
    show(signedOut, false);
    show(signedIn, false);
    show(host, false);
    show(loading, true);
    clearNotice();

    try {
      const result = await api('/v1/web/application/form');
      identity.textContent =
        result.user.username + ' · Discord ID ' + result.user.user_id;
      host.innerHTML = result.form_html;
      attachForm();
      show(loading, false);
      show(signedIn, true);
      show(host, true);
    } catch (error) {
      show(loading, false);
      token = '';
      sessionStorage.removeItem(sessionKey);
      show(signedOut, true);
      showNotice(
        error.status === 401
          ? 'Your login expired. Sign in with Discord to continue.'
          : (error.message || 'Hamuel could not load the application.'),
        'error'
      );
    }
  }

  signin.addEventListener('click', () => {
    const returnTo = location.origin + location.pathname;
    location.href =
      gateway + '/v1/web/auth/start?return_to=' + encodeURIComponent(returnTo);
  });

  signout.addEventListener('click', async () => {
    try { await api('/v1/web/logout'); } catch (_) {}
    token = '';
    sessionStorage.removeItem(sessionKey);
    host.replaceChildren();
    show(host, false);
    show(signedIn, false);
    show(signedOut, true);
    showNotice('Signed out.', 'success');
  });

  document.getElementById('close-success-modal').addEventListener(
    'click',
    () => closeModal(successModal)
  );
  document.getElementById('close-error-modal').addEventListener(
    'click',
    () => closeModal(errorModal)
  );
  successModal.addEventListener('click', (event) => {
    if (event.target === successModal) closeModal(successModal);
  });
  errorModal.addEventListener('click', (event) => {
    if (event.target === errorModal) closeModal(errorModal);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(successModal);
      closeModal(errorModal);
    }
  });

  takeSessionFromFragment();
  if (token) {
    loadAuthenticatedForm();
  } else {
    show(loading, false);
    show(signedIn, false);
    show(host, false);
    show(signedOut, true);
  }
})();
