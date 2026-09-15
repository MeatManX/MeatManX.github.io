(() => {
  'use strict';

  const root = document.querySelector('[data-ogx-afk-app]');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const els = {
    relay: $('relay-status'),
    signedOut: $('signed-out'),
    signedIn: $('signed-in'),
    identity: $('identity'),
    username: $('username'),
    signin: $('signin'),
    signout: $('signout'),
    notice: $('notice'),
    deviceSelect: $('device-select'),
    deviceOnline: $('device-online'),
    remoteEnabled: $('remote-enabled'),
    gameProfile: $('game-profile'),
    xboxInstruction: $('xbox-instruction'),
    firmware: $('firmware-version'),
    lastSeen: $('last-seen'),
    requestForm: $('request-form'),
    requestCode: $('request-code'),
    mapEmpty: $('map-empty'),
    mapControls: $('map-controls'),
    mapGrid: $('map-grid'),
    changeMap: $('change-map'),
    launchGame: $('launch-game'),
    correctCurrent: $('correct-current'),
    modeNote: $('mode-note'),
    scrollUp: $('scroll-up'),
    scrollDown: $('scroll-down')
  };

  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const configuredGateway = root.dataset.gateway || window.OGX_AFK_GATEWAY_URL || '';
  const gateway = configuredGateway.replace(/\/$/, '');
  const sessionKey = 'ogx_afk_web_session_v1';
  let token = sessionStorage.getItem(sessionKey) || '';
  let user = null;
  let devices = [];
  let device = null;
  let selectedMap = '';
  let correctionMode = false;
  let pollTimer = null;

  const demoDevice = {
    device_id: 'AFK-001',
    display_name: 'Rainbow Six 3 Server',
    online: true,
    remote_enabled: true,
    busy: false,
    game_profile: 'rs3',
    firmware_version: 'AFK Internet Preview',
    last_seen_at: new Date().toISOString(),
    current_map: 'Peaks',
    map_order: [
      'Airport 1', 'Presidio', 'Warehouse', 'Peaks',
      'Close Quarter', 'Garage', 'Parkade', 'Scharins V2'
    ],
    active_command: null
  };

  function takeSessionFromFragment() {
    if (!location.hash.startsWith('#afk_session=')) return;
    const value = decodeURIComponent(location.hash.slice('#afk_session='.length));
    if (value) {
      token = value;
      sessionStorage.setItem(sessionKey, token);
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  function showNotice(message, type = '') {
    els.notice.textContent = message;
    els.notice.className = 'notice' + (type ? ' ' + type : '');
  }

  function clearNotice() {
    els.notice.className = 'notice hidden';
    els.notice.textContent = '';
  }

  async function api(path, body = {}) {
    if (!gateway) throw new Error('relay_not_configured');
    const response = await fetch(gateway + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
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

  function signedIn(value) {
    els.signedOut.classList.toggle('hidden', value);
    els.signedIn.classList.toggle('hidden', !value);
    els.identity.classList.toggle('hidden', !value);
  }

  function formatTime(value) {
    if (!value) return 'Never';
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return 'Unknown';
    return time.toLocaleString();
  }

  function renderDeviceList() {
    const previous = device && device.device_id;
    els.deviceSelect.replaceChildren();
    if (!devices.length) {
      const option = document.createElement('option');
      option.textContent = 'No authorized dongles';
      option.value = '';
      els.deviceSelect.appendChild(option);
      els.deviceSelect.disabled = true;
      renderDevice(null);
      return;
    }
    els.deviceSelect.disabled = false;
    devices.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.device_id;
      option.textContent = item.display_name + ' // ' + item.device_id;
      els.deviceSelect.appendChild(option);
    });
    const wanted = devices.find((item) => item.device_id === previous) || devices[0];
    els.deviceSelect.value = wanted.device_id;
    loadDevice(wanted.device_id);
  }

  function setButtonBusy(busy) {
    els.changeMap.disabled = busy || !selectedMap || !device || !device.online || !device.remote_enabled;
    els.launchGame.disabled = busy || correctionMode || !device || !device.online || !device.remote_enabled;
    els.correctCurrent.disabled = busy || !device;
    els.deviceSelect.disabled = busy || !devices.length;
    [...els.mapGrid.querySelectorAll('button')].forEach((button) => {
      button.disabled = busy || button.classList.contains('current');
    });
  }

  function renderMaps() {
    els.mapGrid.replaceChildren();
    if (!device || !Array.isArray(device.map_order) || !device.map_order.length) {
      els.mapEmpty.textContent = device
        ? 'This dongle has not reported a saved map list yet.'
        : 'Choose an authorized dongle to load its maps.';
      els.mapEmpty.classList.remove('hidden');
      els.mapControls.classList.add('hidden');
      return;
    }
    els.mapEmpty.classList.add('hidden');
    els.mapControls.classList.remove('hidden');
    device.map_order.forEach((name, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map';
      button.dataset.map = name;
      const isCurrent = name === device.current_map;
      const isSelected = name === selectedMap;
      if (isCurrent) button.classList.add('current');
      else if (isSelected) button.classList.add('selected');
      const strong = document.createElement('strong');
      strong.textContent = (index + 1) + '. ' + name;
      const small = document.createElement('small');
      small.textContent = isCurrent ? 'Current map' : (isSelected ? (correctionMode ? 'Record as current' : 'Selected') : 'Available');
      button.append(strong, small);
      button.disabled = Boolean(device.active_command) || isCurrent;
      button.addEventListener('click', () => selectMap(name));
      els.mapGrid.appendChild(button);
    });
    updateAction();
  }

  function renderDevice(value) {
    const previousCommand = device && device.active_command
      ? device.active_command.command_id
      : '';
    device = value;
    selectedMap = '';
    correctionMode = false;
    const online = Boolean(device && device.online);
    const isBlackArrow = Boolean(device && device.game_profile === 'rsba');
    els.deviceOnline.innerHTML = '<span class="dot' + (online ? ' online' : '') + '"></span>' + (online ? 'Online' : 'Offline');
    els.remoteEnabled.textContent = device ? (device.remote_enabled ? 'Enabled locally' : 'Disabled locally') : 'Unknown';
    els.gameProfile.textContent = device
      ? (isBlackArrow ? 'Rainbow Six 3: Black Arrow' : 'Rainbow Six 3')
      : 'Unknown';
    els.xboxInstruction.innerHTML = '<strong>Before changing maps or launching:</strong> '
      + 'the saved order must match the Xbox map list exactly, and the in-game cursor must be on <strong>'
      + (isBlackArrow ? 'Setup Options' : 'Statistics') + '</strong>.';
    els.firmware.textContent = device && device.firmware_version ? device.firmware_version : 'Unknown';
    els.lastSeen.textContent = device ? formatTime(device.last_seen_at) : 'Never';
    renderMaps();
    if (device && device.active_command) {
      showNotice(
        device.active_command.action === 'launch_game'
          ? 'Launching the game. The dongle has the command now.'
          : 'Changing to ' + device.active_command.target_map + '. The dongle has the command now.',
        'busy'
      );
      setButtonBusy(true);
    } else if (
      device &&
      previousCommand &&
      device.last_command &&
      device.last_command.command_id === previousCommand
    ) {
      if (device.last_command.status === 'succeeded') {
        showNotice(
          device.last_command.action === 'launch_game'
            ? (isBlackArrow
              ? 'Dongle initiated the Black Arrow round. Setup Options returns when the round ends.'
              : 'Dongle completed the launch sequence and returned the cursor to Statistics.')
            : 'Dongle completed the sequence. Recorded current map: ' + device.current_map + '.',
          'success'
        );
      } else {
        showNotice(
          'Dongle reported ' + device.last_command.status + '. The recorded current map was not changed.',
          'error'
        );
      }
    }
  }

  function selectMap(name) {
    if (!device || device.active_command) return;
    selectedMap = name;
    renderMaps();
  }

  function updateAction() {
    if (!selectedMap) {
      els.changeMap.textContent = correctionMode ? 'Select the actual current map' : 'Select a map';
    } else {
      els.changeMap.textContent = correctionMode
        ? 'Set current map to ' + selectedMap
        : 'Change to ' + selectedMap;
    }
    els.correctCurrent.textContent = correctionMode ? 'Cancel correction' : 'Correct current map';
    els.modeNote.textContent = correctionMode
      ? 'Correction mode only updates the dongle’s saved current-map position. It does not press buttons on the Xbox.'
      : 'Current map is green. Choose another map, then press Change Map. There is no extra confirmation popup.';
    setButtonBusy(Boolean(device && device.active_command));
  }

  async function loadDevice(deviceId) {
    const summary = devices.find((item) => item.device_id === deviceId);
    if (demo) {
      renderDevice({...demoDevice});
      return;
    }
    if (!summary) {
      renderDevice(null);
      return;
    }
    try {
      const status = await api('/v1/web/devices/status', {device_id: deviceId});
      renderDevice(status);
    } catch (error) {
      renderDevice(summary);
      showNotice(error.message || 'Could not load this dongle.', 'error');
    }
  }

  async function refresh(silent = false) {
    if (demo) {
      user = {user_id: 'demo', username: 'Demo Operator'};
      devices = [{...demoDevice}];
      signedIn(true);
      els.username.textContent = user.username.toUpperCase();
      els.relay.textContent = 'REMOTE RELAY // DEMO DATA';
      renderDeviceList();
      return;
    }
    if (!token) {
      signedIn(false);
      els.relay.textContent = gateway ? 'REMOTE RELAY // SIGNED OUT' : 'REMOTE RELAY // NOT CONFIGURED';
      return;
    }
    try {
      const session = await api('/v1/web/session');
      user = session.user;
      devices = session.devices || [];
      signedIn(true);
      els.username.textContent = user.username.toUpperCase();
      els.relay.textContent = 'REMOTE RELAY // AUTHENTICATED';
      renderDeviceList();
      if (!silent && !devices.length) {
        showNotice('You are signed in. Enter a dongle code to request access.');
      }
    } catch (error) {
      if (error.status === 401) {
        token = '';
        sessionStorage.removeItem(sessionKey);
        signedIn(false);
      }
      els.relay.textContent = 'REMOTE RELAY // UNAVAILABLE';
      if (!silent) showNotice(error.message || 'The control relay is unavailable.', 'error');
    }
  }

  els.signin.addEventListener('click', () => {
    if (!gateway) {
      alert('The OGX-Mini AFK relay has not been enabled yet.');
      return;
    }
    const returnTo = location.origin + location.pathname;
    location.href = gateway + '/v1/web/auth/start?return_to=' + encodeURIComponent(returnTo);
  });

  els.signout.addEventListener('click', async () => {
    try { if (!demo && token) await api('/v1/web/logout'); } catch (_) {}
    token = '';
    sessionStorage.removeItem(sessionKey);
    clearInterval(pollTimer);
    location.href = location.pathname;
  });

  els.deviceSelect.addEventListener('change', () => {
    clearNotice();
    loadDevice(els.deviceSelect.value);
  });

  els.requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = els.requestCode.value.trim().toUpperCase();
    if (!/^AFK-\d{3}$/.test(code)) {
      showNotice('Enter a dongle code such as AFK-001.', 'error');
      return;
    }
    if (demo) {
      showNotice('Demo request created. In the live system, Hamuel sends MeatMan an approval card.', 'success');
      return;
    }
    try {
      const result = await api('/v1/web/access/request', {device_id: code});
      els.requestCode.value = '';
      showNotice(
        result.status === 'already_authorized'
          ? 'You already have access to that dongle.'
          : 'Access request sent. Hamuel will notify MeatMan.',
        'success'
      );
      await refresh(true);
    } catch (error) {
      showNotice(error.message || 'Could not request access.', 'error');
    }
  });

  els.correctCurrent.addEventListener('click', () => {
    correctionMode = !correctionMode;
    selectedMap = '';
    renderMaps();
  });

  els.launchGame.addEventListener('click', async () => {
    if (!device || device.active_command || correctionMode) return;
    if (demo) {
      showNotice('Demo: dongle completed the launch sequence and returned to Statistics.', 'success');
      return;
    }
    setButtonBusy(true);
    try {
      await api('/v1/web/commands/queue', {
        device_id: device.device_id,
        action: 'launch_game',
        target_map: ''
      });
      showNotice('Launch command queued. Waiting for the dongle.', 'busy');
      await loadDevice(device.device_id);
    } catch (error) {
      showNotice(error.message || 'Could not queue the launch command.', 'error');
      setButtonBusy(false);
    }
  });

  els.changeMap.addEventListener('click', async () => {
    if (!device || !selectedMap || device.active_command) return;
    if (demo) {
      demoDevice.current_map = selectedMap;
      device.current_map = selectedMap;
      showNotice(
        correctionMode
          ? 'Demo: recorded current map corrected.'
          : 'Demo: dongle completed the sequence; current map record updated.',
        'success'
      );
      selectedMap = '';
      correctionMode = false;
      renderDevice({...device});
      return;
    }
    const action = correctionMode ? 'correct_current_map' : 'change_map';
    setButtonBusy(true);
    try {
      const result = await api('/v1/web/commands/queue', {
        device_id: device.device_id,
        action,
        target_map: selectedMap
      });
      showNotice(
        action === 'change_map'
          ? 'Command queued for ' + result.target_map + '. Waiting for the dongle.'
          : 'Current-map correction queued.',
        'busy'
      );
      selectedMap = '';
      correctionMode = false;
      await loadDevice(device.device_id);
    } catch (error) {
      showNotice(error.message || 'Could not queue the map command.', 'error');
      setButtonBusy(false);
    }
  });

  els.scrollUp.addEventListener('click', () => {
    window.scrollBy({top: -Math.max(260, window.innerHeight * 0.72), behavior: 'smooth'});
  });
  els.scrollDown.addEventListener('click', () => {
    window.scrollBy({top: Math.max(260, window.innerHeight * 0.72), behavior: 'smooth'});
  });

  takeSessionFromFragment();
  refresh();
  pollTimer = window.setInterval(() => {
    if ((token || demo) && document.visibilityState === 'visible') refresh(true);
  }, 4000);
})();
