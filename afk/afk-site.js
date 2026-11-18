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
    cursorFallback: $('cursor-fallback'),
    cursorStartStatistics: $('cursor-start-statistics'),
    cursorStartOptions: $('cursor-start-options'),
    firmware: $('firmware-version'),
    lastSeen: $('last-seen'),
    requestForm: $('request-form'),
    requestCode: $('request-code'),
    managerPanel: $('manager-panel'),
    managerDevice: $('manager-device'),
    mapDisplayForm: $('map-display-form'),
    mapDisplayMode: $('map-display-mode'),
    mapDisplayHelp: $('map-display-help'),
    mapLabelList: $('map-label-list'),
    mapDisplaySave: $('map-display-save'),
    mapDisplayReset: $('map-display-reset'),
    grantForm: $('grant-form'),
    grantUserId: $('grant-user-id'),
    grantKind: $('grant-kind'),
    grantSubmit: $('grant-submit'),
    accessList: $('access-list'),
    mapEmpty: $('map-empty'),
    mapControls: $('map-controls'),
    mapGrid: $('map-grid'),
    changeMap: $('change-map'),
    launchGame: $('launch-game'),
    correctCurrent: $('correct-current'),
    modeNote: $('mode-note'),
    videoPlaceholder: $('video-placeholder'),
    videoView: $('video-view'),
    broadcastPreview: $('broadcast-preview'),
    broadcastCanvas: $('broadcast-canvas'),
    startCamera: $('start-camera'),
    startScreen: $('start-screen'),
    stopBroadcast: $('stop-broadcast'),
    videoLive: $('video-live'),
    cursorDetection: $('cursor-detection'),
    mapDetection: $('map-detection'),
    manualStatus: $('manual-status'),
    manualRequest: $('manual-request'),
    manualRevoke: $('manual-revoke'),
    manualRequests: $('manual-requests'),
    remotePad: $('remote-pad'),
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
  let managedDeviceIds = new Set();
  let device = null;
  let selectedMap = '';
  let correctionMode = false;
  let mapDisplayDirty = false;
  let mapDisplayEditingDevice = '';
  let pollTimer = null;
  let manualSessions = [];
  let manualIsOwner = false;
  let manualTapLocked = false;
  let captureStream = null;
  let captureTimer = null;
  let captureBusy = false;
  let broadcastDeviceId = '';
  let videoObjectUrl = '';
  let videoAssistReady = false;
  let videoAssistBlocked = false;
  let manualCursorStart = 'statistics';

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
    map_display: {
      mode: 'native',
      configured_mode: 'native',
      labels: [],
      valid: true
    },
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

  function mapSlotsFor(value = device) {
    if (!value) return [];
    const maps = Array.isArray(value.map_order) ? value.map_order : [];
    if (Array.isArray(value.map_slots) && value.map_slots.length === maps.length) {
      return value.map_slots.map((slot, index) => ({
        slot: Number(slot.slot || index + 1),
        command_map: String(slot.command_map || maps[index] || ''),
        label: String(slot.label || slot.command_map || maps[index] || '')
      }));
    }
    const display = value.map_display || {};
    const labels = Array.isArray(display.labels) && display.labels.length === maps.length
      ? display.labels
      : maps;
    return maps.map((name, index) => ({
      slot: index + 1,
      command_map: String(name),
      label: String(labels[index] || name)
    }));
  }

  function mapLabelFor(commandMap) {
    const wanted = String(commandMap || '').toLowerCase();
    const match = mapSlotsFor().find((slot) => slot.command_map.toLowerCase() === wanted);
    return match ? match.label : String(commandMap || '');
  }

  function mapDisplayMode(value = device) {
    return value && value.map_display && value.map_display.mode
      ? value.map_display.mode
      : 'native';
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

  function activeManualSession() {
    return manualSessions.find((item) => item.status === 'active' && item.can_control) || null;
  }

  function liveManualSession() {
    return manualSessions.find((item) => ['pending', 'active'].includes(item.status)
      && user && item.operator_user_id === user.user_id) || null;
  }

  function renderManualState() {
    const active = activeManualSession();
    const mine = liveManualSession();
    const anyLive = manualSessions.find((item) => ['pending', 'active'].includes(item.status));
    const revocable = manualSessions.find((item) => item.can_revoke);
    const usable = Boolean(
      active && device && device.online && device.remote_enabled
      && !device.active_command && !manualTapLocked
    );
    els.manualRequests.replaceChildren();

    if (!device) {
      els.manualStatus.textContent = 'Choose an authorized dongle first.';
    } else if (active) {
      els.manualStatus.textContent = 'Manual control approved until '
        + formatTime(active.expires_at) + '. Each button is one atomic tap.';
    } else if (mine && mine.status === 'pending') {
      els.manualStatus.textContent = 'Waiting for the dongle owner to approve this request.';
    } else {
      els.manualStatus.textContent = 'No temporary manual-control session is active.';
    }

    els.manualRequest.classList.toggle('hidden', Boolean(anyLive));
    els.manualRequest.disabled = !device;
    els.manualRevoke.classList.toggle('hidden', !revocable && !(mine && mine.status === 'pending'));
    els.remotePad.classList.toggle('hidden', !active);
    [...els.remotePad.querySelectorAll('[data-manual-button]')].forEach((button) => {
      button.disabled = !usable;
    });

    if (!manualIsOwner) return;
    manualSessions.filter((item) => item.status === 'pending').forEach((item) => {
      const row = document.createElement('div');
      row.className = 'manual-request';
      const detail = document.createElement('div');
      detail.textContent = (item.operator_name || item.operator_user_id)
        + ' requests temporary manual control.';
      const actions = document.createElement('div');
      actions.className = 'assist-actions';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn primary';
      approve.textContent = 'Approve 10 min';
      approve.addEventListener('click', () => decideManual(item.session_id, 'approve'));
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'btn danger';
      deny.textContent = 'Deny';
      deny.addEventListener('click', () => decideManual(item.session_id, 'deny'));
      actions.append(approve, deny);
      row.append(detail, actions);
      els.manualRequests.appendChild(row);
    });
  }

  async function loadManualState() {
    const deviceId = device && device.device_id;
    if (!deviceId || demo) {
      manualSessions = demo ? [{
        session_id: 'AFKM-DEMO0001',
        device_id: 'AFK-001',
        operator_user_id: 'demo',
        operator_name: 'Demo Operator',
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        can_control: true,
        can_revoke: true
      }] : [];
      manualIsOwner = demo;
      renderManualState();
      return;
    }
    try {
      const result = await api('/v1/web/manual/list', {device_id: deviceId});
      if (!device || device.device_id !== deviceId) return;
      manualSessions = result.sessions || [];
      manualIsOwner = Boolean(result.is_owner);
      renderManualState();
    } catch (error) {
      if (!device || device.device_id !== deviceId) return;
      manualSessions = [];
      manualIsOwner = false;
      renderManualState();
      els.manualStatus.textContent = error.message || 'Manual-control status is unavailable.';
    }
  }

  async function decideManual(sessionId, decision) {
    try {
      await api('/v1/web/manual/decide', {
        session_id: sessionId,
        decision,
        duration_minutes: 10
      });
      showNotice(
        decision === 'approve'
          ? 'Manual control approved for 10 minutes.'
          : 'Manual-control request denied.',
        decision === 'approve' ? 'success' : ''
      );
      await loadManualState();
    } catch (error) {
      showNotice(error.message || 'Could not decide the manual-control request.', 'error');
    }
  }

  function releaseVideoObjectUrl() {
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = '';
  }

  function updateCursorAssistUi(cursor = 'unknown', confidence = 0, ageSeconds = Infinity) {
    const live = ageSeconds <= 15;
    videoAssistReady = live && ageSeconds <= 3 && confidence >= 90
      && (cursor === 'statistics' || cursor === 'options');
    videoAssistBlocked = live && !videoAssistReady;
    els.cursorFallback.classList.toggle('hidden', live);
    if (videoAssistReady) {
      const label = cursor === 'options' ? 'Options' : 'Statistics';
      els.xboxInstruction.innerHTML = '<strong>VIDEO ASSIST ACTIVE:</strong> cursor detected on <strong>'
        + label + '</strong>. Change Map and Launch Game select the matching starting macro.';
    } else if (live) {
      els.xboxInstruction.innerHTML = '<strong>WAITING FOR VIDEO:</strong> the live frame is stale or the cursor is uncertain. '
        + 'Adjust the view or stop broadcasting to choose the starting cursor manually.';
    } else {
      els.xboxInstruction.innerHTML = '<strong>MANUAL CURSOR MODE:</strong> select the actual Xbox cursor position below '
        + 'before changing maps or launching.';
    }
    if (device) setButtonBusy(Boolean(device.active_command));
  }

  function setManualCursorStart(value) {
    manualCursorStart = value === 'options' ? 'options' : 'statistics';
    els.cursorStartStatistics.classList.toggle('selected', manualCursorStart === 'statistics');
    els.cursorStartOptions.classList.toggle('selected', manualCursorStart === 'options');
  }

  function commandAction(base) {
    if (videoAssistReady || manualCursorStart === 'statistics') return base;
    return base + '_from_options';
  }

  function renderCursorDetection(detection, ageSeconds = Infinity) {
    const cursor = String(detection && detection.cursor || 'unknown');
    const label = String(detection && detection.label || 'Unknown');
    const confidence = Math.round(Number(detection && detection.confidence || 0) * 100);
    let state = 'unknown';
    if (cursor === 'statistics') state = 'safe';
    else if (cursor === 'options') state = 'recovery';
    else if (cursor !== 'unknown') state = 'unsafe';
    els.cursorDetection.className = 'cursor-badge ' + state;
    els.cursorDetection.textContent = cursor === 'unknown'
      ? 'CURSOR // UNKNOWN'
      : 'CURSOR // ' + label.toUpperCase() + ' · ' + confidence + '%';
    els.cursorDetection.title = detection && detection.reason
      ? 'Detector result: ' + detection.reason
      : 'No cursor analysis is available.';
    updateCursorAssistUi(cursor, confidence, Number(ageSeconds));
  }

  function renderMapDetection(detection, ageSeconds = Infinity) {
    const map = ageSeconds <= 3 && detection && detection.map;
    if (!map) {
      els.mapDetection.className = 'cursor-badge unknown';
      els.mapDetection.textContent = ageSeconds <= 15 ? 'SCREEN MAP // UNREADABLE' : 'SCREEN MAP // NO VIDEO';
      els.mapDetection.title = detection && detection.reason ? detection.reason : '';
      return;
    }
    const saved = String(device && device.current_map || '');
    const same = saved.toLowerCase() === String(map).toLowerCase();
    els.mapDetection.className = 'cursor-badge ' + (same ? 'safe' : 'recovery');
    els.mapDetection.textContent = 'SCREEN MAP // ' + (detection.label || map)
      + (same ? ' · matches saved' : ' · differs from saved');
    els.mapDetection.title = 'OCR: ' + (detection.raw_text || '')
      + ' · match quality ' + Math.round(Number(detection.match_quality || 0) * 100) + '%';
  }

  function renderVideoOffline(message = 'No live AFK video is available for this dongle.') {
    if (captureStream && broadcastDeviceId === (device && device.device_id)) return;
    releaseVideoObjectUrl();
    els.videoView.classList.add('hidden');
    els.videoPlaceholder.classList.remove('hidden');
    els.videoPlaceholder.textContent = message;
    els.videoLive.textContent = 'VIDEO OFFLINE';
    els.videoLive.classList.remove('on');
    renderCursorDetection(null);
    renderMapDetection(null);
    els.cursorDetection.textContent = 'CURSOR // NO VIDEO';
  }

  async function loadVideoFrame() {
    const deviceId = device && device.device_id;
    if (!deviceId || demo || (captureStream && broadcastDeviceId === deviceId)) {
      if (demo) renderVideoOffline('Demo mode does not transmit camera frames.');
      return;
    }
    try {
      const status = await api('/v1/web/video/status', {device_id: deviceId});
      if (!device || device.device_id !== deviceId) return;
      if (!status.live) {
        renderVideoOffline();
        return;
      }
      const response = await fetch(
        gateway + '/v1/web/video/frame?device_id=' + encodeURIComponent(deviceId),
        {
          headers: {'Authorization': 'Bearer ' + token},
          cache: 'no-store'
        }
      );
      if (!response.ok) {
        renderVideoOffline();
        return;
      }
      const blob = await response.blob();
      if (!device || device.device_id !== deviceId) return;
      releaseVideoObjectUrl();
      videoObjectUrl = URL.createObjectURL(blob);
      els.videoView.src = videoObjectUrl;
      els.videoView.classList.remove('hidden');
      els.videoPlaceholder.classList.add('hidden');
      els.videoLive.textContent = 'LIVE · ' + Math.max(0, Math.round(Number(status.age_seconds || 0))) + 's';
      els.videoLive.classList.add('on');
      renderCursorDetection(status.cursor_detection, Number(status.age_seconds || 0));
      renderMapDetection(status.map_detection, Number(status.age_seconds || 0));
    } catch (_) {
      renderVideoOffline('The private video relay is unavailable.');
    }
  }

  function stopBroadcast() {
    clearInterval(captureTimer);
    captureTimer = null;
    captureBusy = false;
    if (captureStream) captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
    broadcastDeviceId = '';
    els.broadcastPreview.srcObject = null;
    els.broadcastPreview.classList.add('hidden');
    els.stopBroadcast.classList.add('hidden');
    els.startCamera.classList.remove('hidden');
    els.startScreen.classList.remove('hidden');
    renderVideoOffline();
  }

  async function uploadVideoFrame() {
    if (!captureStream || captureBusy || !broadcastDeviceId || !token) return;
    const video = els.broadcastPreview;
    if (!video.videoWidth || !video.videoHeight) return;
    captureBusy = true;
    try {
      const maxWidth = 960;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = els.broadcastCanvas;
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
      if (!blob) throw new Error('Could not encode the video frame.');
      const response = await fetch(gateway + '/v1/web/video/frame', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'image/jpeg',
          'X-OGX-AFK-Device-ID': broadcastDeviceId
        },
        body: blob,
        cache: 'no-store'
      });
      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        throw new Error(payload.message || payload.error || ('HTTP ' + response.status));
      }
      const payload = await response.json();
      els.videoLive.textContent = 'BROADCASTING';
      els.videoLive.classList.add('on');
      renderCursorDetection(payload.cursor_detection, 0);
      renderMapDetection(payload.map_detection, 0);
    } catch (error) {
      showNotice(error.message || 'Could not upload the private video frame.', 'error');
      stopBroadcast();
    } finally {
      captureBusy = false;
    }
  }

  async function startBroadcast(kind) {
    if (!device) {
      showNotice('Choose an authorized dongle before starting video.', 'error');
      return;
    }
    stopBroadcast();
    try {
      captureStream = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({video: true, audio: false})
        : await navigator.mediaDevices.getUserMedia({
          video: {width: {ideal: 1280}, height: {ideal: 720}},
          audio: false
        });
      broadcastDeviceId = device.device_id;
      els.broadcastPreview.srcObject = captureStream;
      els.broadcastPreview.classList.remove('hidden');
      els.videoView.classList.add('hidden');
      els.videoPlaceholder.classList.add('hidden');
      els.startCamera.classList.add('hidden');
      els.startScreen.classList.add('hidden');
      els.stopBroadcast.classList.remove('hidden');
      els.videoLive.textContent = 'STARTING…';
      const track = captureStream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', stopBroadcast, {once: true});
      await els.broadcastPreview.play();
      await uploadVideoFrame();
      captureTimer = window.setInterval(uploadVideoFrame, 1200);
    } catch (error) {
      stopBroadcast();
      if (error && error.name !== 'NotAllowedError') {
        showNotice(error.message || 'Could not start video capture.', 'error');
      }
    }
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

  function accessDetail(item) {
    if (item.grant_kind === 'temporary') {
      return '30-day access · expires ' + formatTime(item.expires_at);
    }
    if (item.grant_kind === 'once') {
      const uses = Number(item.uses_remaining || 0);
      return uses + (uses === 1 ? ' use remaining' : ' uses remaining');
    }
    return 'Permanent access';
  }

  function renderAccessList(grants) {
    els.accessList.replaceChildren();
    if (!grants.length) {
      const empty = document.createElement('div');
      empty.className = 'access-empty';
      empty.textContent = 'No active access grants.';
      els.accessList.appendChild(empty);
      return;
    }
    grants.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'access-row';

      const identity = document.createElement('div');
      identity.className = 'access-user';
      identity.textContent = item.user_id;
      if (item.is_manager) {
        const role = document.createElement('span');
        role.className = 'access-role';
        role.textContent = 'Manager';
        identity.appendChild(role);
      }

      const detail = document.createElement('div');
      detail.className = 'access-detail';
      detail.textContent = accessDetail(item);
      row.append(identity, detail);

      if (!item.is_manager) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn danger';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          if (!device || !window.confirm('Remove access for Discord user ' + item.user_id + '?')) return;
          remove.disabled = true;
          try {
            await api('/v1/web/access/revoke', {
              device_id: device.device_id,
              user_id: item.user_id
            });
            showNotice('Access removed for Discord user ' + item.user_id + '.', 'success');
            await loadManagerAccess();
          } catch (error) {
            showNotice(error.message || 'Could not remove access.', 'error');
            remove.disabled = false;
          }
        });
        row.appendChild(remove);
      }

      els.accessList.appendChild(row);
    });
  }

  function updateMapDisplayEditor() {
    const mode = els.mapDisplayMode.value;
    const translated = mode !== 'native';
    els.mapLabelList.classList.toggle('hidden', !translated);
    els.mapDisplayReset.disabled = mode === 'native';
    els.mapDisplayHelp.textContent = mode === 'black_arrow_live'
      ? 'Enter the Black Arrow Xbox Live map name for each numbered OldBow firmware slot.'
      : (mode === 'custom'
        ? 'Enter the custom or modded map name represented by each numbered firmware slot.'
        : 'Use the map names reported by the dongle with no website translation.');
  }

  function renderMapDisplayEditor() {
    if (mapDisplayDirty && device && mapDisplayEditingDevice === device.device_id) return;
    const slots = mapSlotsFor();
    mapDisplayEditingDevice = device ? device.device_id : '';
    const config = device && device.map_display ? device.map_display : {};
    const configuredMode = ['native', 'black_arrow_live', 'custom'].includes(config.configured_mode)
      ? config.configured_mode
      : (['native', 'black_arrow_live', 'custom'].includes(config.mode) ? config.mode : 'native');
    els.mapDisplayMode.value = configuredMode;
    els.mapLabelList.replaceChildren();

    slots.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'map-label-row';

      const number = document.createElement('span');
      number.className = 'map-label-slot';
      number.textContent = 'SLOT ' + String(slot.slot).padStart(2, '0');

      const field = document.createElement('div');
      const input = document.createElement('input');
      input.className = 'map-label-input';
      input.maxLength = 64;
      input.required = true;
      input.value = slot.label;
      input.setAttribute('aria-label', 'Display name for map slot ' + slot.slot);

      const source = document.createElement('small');
      source.className = 'map-label-source';
      source.textContent = 'Firmware: ' + slot.command_map;

      field.append(input, source);
      row.append(number, field);
      els.mapLabelList.appendChild(row);
    });

    els.mapDisplaySave.disabled = !slots.length;
    updateMapDisplayEditor();
  }

  async function loadManagerAccess() {
    const deviceId = device && device.device_id;
    const canManage = Boolean(deviceId && managedDeviceIds.has(deviceId));
    els.managerPanel.classList.toggle('hidden', !canManage);
    if (!canManage) return;

    els.managerDevice.textContent = deviceId;
    renderMapDisplayEditor();
    const loading = document.createElement('div');
    loading.className = 'access-empty';
    loading.textContent = 'Loading authorized users…';
    els.accessList.replaceChildren(loading);

    if (demo) {
      renderAccessList([
        {
          user_id: '123456789012345678',
          grant_kind: 'permanent',
          uses_remaining: null,
          expires_at: null,
          is_manager: 1
        },
        {
          user_id: '987654321098765432',
          grant_kind: 'temporary',
          uses_remaining: null,
          expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
          is_manager: 0
        }
      ]);
      return;
    }

    try {
      const result = await api('/v1/web/access/list', {device_id: deviceId});
      if (!device || device.device_id !== deviceId) return;
      renderAccessList(result.grants || []);
    } catch (error) {
      if (!device || device.device_id !== deviceId) return;
      const failure = document.createElement('div');
      failure.className = 'access-empty';
      failure.textContent = error.message || 'Could not load authorized users.';
      els.accessList.replaceChildren(failure);
    }
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
    els.changeMap.disabled = busy || (videoAssistBlocked && !correctionMode) || !selectedMap || !device || !device.online || !device.remote_enabled;
    els.launchGame.disabled = busy || videoAssistBlocked || correctionMode || !device || !device.online || !device.remote_enabled;
    els.correctCurrent.disabled = busy || !device;
    els.deviceSelect.disabled = busy || !devices.length;
    [...els.mapGrid.querySelectorAll('button')].forEach((button) => {
      button.disabled = busy || button.classList.contains('current');
    });
  }

  function renderMaps() {
    els.mapGrid.replaceChildren();
    const slots = mapSlotsFor();
    if (!device || !slots.length) {
      els.mapEmpty.textContent = device
        ? 'This dongle has not reported a saved map list yet.'
        : 'Choose an authorized dongle to load its maps.';
      els.mapEmpty.classList.remove('hidden');
      els.mapControls.classList.add('hidden');
      return;
    }
    els.mapEmpty.classList.add('hidden');
    els.mapControls.classList.remove('hidden');
    slots.forEach((slot) => {
      const commandMap = slot.command_map;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map';
      button.dataset.map = commandMap;
      const isCurrent = commandMap.toLowerCase() === String(device.current_map || '').toLowerCase();
      const isSelected = commandMap === selectedMap;
      if (isCurrent) button.classList.add('current');
      else if (isSelected) button.classList.add('selected');
      const strong = document.createElement('strong');
      strong.textContent = slot.slot + '. ' + slot.label;
      const small = document.createElement('small');
      small.textContent = isCurrent ? 'Current map' : (isSelected ? (correctionMode ? 'Record as current' : 'Selected') : 'Available');
      button.append(strong, small);
      button.disabled = Boolean(device.active_command) || isCurrent;
      button.addEventListener('click', () => selectMap(commandMap));
      els.mapGrid.appendChild(button);
    });
    updateAction();
  }

  function renderDevice(value) {
    const previousCommand = device && device.active_command
      ? device.active_command.command_id
      : '';
    const previousDeviceId = device && device.device_id;
    const previousSelectedMap = selectedMap;
    const previousCorrectionMode = correctionMode;
    device = value;
    const sameDevice = Boolean(
      device && previousDeviceId && device.device_id === previousDeviceId
    );
    const selectedStillExists = Boolean(
      sameDevice && previousSelectedMap && mapSlotsFor(device).some(
        (slot) => slot.command_map === previousSelectedMap
      )
    );
    const selectedBecameCurrent = Boolean(
      selectedStillExists &&
      previousSelectedMap.toLowerCase() === String(device.current_map || '').toLowerCase()
    );
    selectedMap = selectedStillExists && !selectedBecameCurrent
      ? previousSelectedMap
      : '';
    correctionMode = sameDevice ? previousCorrectionMode : false;
    const online = Boolean(device && device.online);
    const controlIsBlackArrow = Boolean(device && device.game_profile === 'rsba');
    const displayMode = mapDisplayMode();
    const displayName = displayMode === 'black_arrow_live'
      ? 'Rainbow Six 3: Black Arrow (Xbox Live)'
      : (displayMode === 'custom'
        ? 'Custom / Modded Map List'
        : (controlIsBlackArrow ? 'Rainbow Six 3: Black Arrow' : 'Rainbow Six 3'));
    const cursorName = 'Statistics';
    els.deviceOnline.innerHTML = '<span class="dot' + (online ? ' online' : '') + '"></span>' + (online ? 'Online' : 'Offline');
    els.remoteEnabled.textContent = device ? (device.remote_enabled ? 'Enabled locally' : 'Disabled locally') : 'Unknown';
    els.gameProfile.textContent = device ? displayName : 'Unknown';
    els.xboxInstruction.innerHTML = '<strong>Before changing maps or launching:</strong> '
      + 'the displayed map order must match the Xbox map list exactly, and the in-game cursor must be on <strong>'
      + cursorName + '</strong>.';
    els.firmware.textContent = device && device.firmware_version ? device.firmware_version : 'Unknown';
    els.lastSeen.textContent = device ? formatTime(device.last_seen_at) : 'Never';
    renderMaps();
    loadManagerAccess();
    loadManualState();
    loadVideoFrame();
    if (device && device.active_command) {
      const activeAction = device.active_command.action;
      showNotice(
        activeAction === 'launch_game'
          ? 'Launching the game. The dongle has the command now.'
          : (activeAction === 'tap_button'
            ? 'Manual ' + String(device.active_command.target_map || '').toUpperCase()
              + ' tap queued. Waiting for the dongle.'
            : 'Changing to ' + mapLabelFor(device.active_command.target_map)
              + '. The dongle has the command now.'),
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
            ? 'Dongle completed the launch sequence and returned the cursor to Statistics.'
            : (device.last_command.action === 'tap_button'
              ? 'Dongle completed the manual '
                + String(device.last_command.target_map || '').toUpperCase() + ' tap.'
              : 'Dongle completed the sequence. Recorded current map: '
                + (device.current_map_display || mapLabelFor(device.current_map)) + '.'),
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
      const selectedLabel = mapLabelFor(selectedMap);
      els.changeMap.textContent = correctionMode
        ? 'Set current map to ' + selectedLabel
        : 'Change to ' + selectedLabel;
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
      managedDeviceIds = new Set(['AFK-001']);
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
      managedDeviceIds = new Set(session.managed_device_ids || []);
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
    stopBroadcast();
    try { if (!demo && token) await api('/v1/web/logout'); } catch (_) {}
    token = '';
    sessionStorage.removeItem(sessionKey);
    clearInterval(pollTimer);
    location.href = location.pathname;
  });

  els.deviceSelect.addEventListener('change', () => {
    stopBroadcast();
    releaseVideoObjectUrl();
    manualSessions = [];
    manualIsOwner = false;
    clearNotice();
    mapDisplayDirty = false;
    mapDisplayEditingDevice = els.deviceSelect.value;
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
      showNotice('Demo request created. In the live system, Hamuel sends the dongle manager and owner an approval card.', 'success');
      return;
    }
    try {
      const result = await api('/v1/web/access/request', {device_id: code});
      els.requestCode.value = '';
      showNotice(
        result.status === 'already_authorized'
          ? 'You already have access to that dongle.'
          : 'Access request sent. Hamuel will notify the dongle manager and owner.',
        'success'
      );
      await refresh(true);
    } catch (error) {
      showNotice(error.message || 'Could not request access.', 'error');
    }
  });

  els.mapDisplayMode.addEventListener('change', () => {
    mapDisplayDirty = true;
    mapDisplayEditingDevice = device ? device.device_id : '';
    updateMapDisplayEditor();
  });

  els.mapLabelList.addEventListener('input', () => {
    mapDisplayDirty = true;
    mapDisplayEditingDevice = device ? device.device_id : '';
  });

  els.mapDisplayReset.addEventListener('click', () => {
    mapDisplayDirty = true;
    els.mapDisplayMode.value = 'native';
    updateMapDisplayEditor();
    els.mapDisplayForm.requestSubmit();
  });

  els.mapDisplayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!device || !managedDeviceIds.has(device.device_id)) return;
    const mode = els.mapDisplayMode.value;
    const labels = mode === 'native'
      ? []
      : [...els.mapLabelList.querySelectorAll('.map-label-input')].map((input) => input.value.trim());
    if (mode !== 'native' && labels.some((label) => !label)) {
      showNotice('Every numbered map slot needs a display name.', 'error');
      return;
    }

    els.mapDisplaySave.disabled = true;
    els.mapDisplayReset.disabled = true;
    if (demo) {
      demoDevice.map_display = {
        mode,
        configured_mode: mode,
        labels,
        valid: true
      };
      showNotice(
        mode === 'native'
          ? 'Demo: restored the names reported by the dongle.'
          : 'Demo: saved the website map names without changing firmware commands.',
        'success'
      );
      mapDisplayDirty = false;
      renderDevice({...demoDevice});
      return;
    }

    try {
      await api('/v1/web/map-display/save', {
        device_id: device.device_id,
        mode,
        labels
      });
      showNotice(
        mode === 'native'
          ? 'Restored the names reported by the dongle.'
          : 'Saved the online map names. Firmware commands are unchanged.',
        'success'
      );
      mapDisplayDirty = false;
      await loadDevice(device.device_id);
    } catch (error) {
      showNotice(error.message || 'Could not save the map names.', 'error');
      els.mapDisplaySave.disabled = false;
      els.mapDisplayReset.disabled = mode === 'native';
    }
  });

  els.grantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!device || !managedDeviceIds.has(device.device_id)) return;
    const targetUserId = els.grantUserId.value.trim();
    if (!/^\d{15,22}$/.test(targetUserId)) {
      showNotice('Enter a valid Discord user ID.', 'error');
      return;
    }
    if (demo) {
      els.grantUserId.value = '';
      showNotice(
        'Demo: ' + els.grantKind.options[els.grantKind.selectedIndex].text
          + ' access granted to ' + targetUserId + '.',
        'success'
      );
      return;
    }

    els.grantSubmit.disabled = true;
    try {
      const result = await api('/v1/web/access/grant', {
        device_id: device.device_id,
        user_id: targetUserId,
        grant_kind: els.grantKind.value
      });
      const label = result.grant_kind === 'temporary'
        ? '30-day'
        : (result.grant_kind === 'once' ? 'one-use' : 'permanent');
      els.grantUserId.value = '';
      showNotice(
        label.charAt(0).toUpperCase() + label.slice(1)
          + ' access granted to Discord user ' + targetUserId + '.',
        'success'
      );
      await loadManagerAccess();
    } catch (error) {
      showNotice(error.message || 'Could not grant access.', 'error');
    } finally {
      els.grantSubmit.disabled = false;
    }
  });

  els.cursorStartStatistics.addEventListener('click', () => setManualCursorStart('statistics'));
  els.cursorStartOptions.addEventListener('click', () => setManualCursorStart('options'));

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
      const result = await api('/v1/web/commands/queue', {
        device_id: device.device_id,
        action: commandAction('launch_game'),
        target_map: ''
      });
      const assist = result.video_assist || {};
      showNotice(
        assist.mode === 'automatic'
          ? 'Video verified ' + String(assist.cursor || '').replace('_', ' ') + '; the correct launch macro was queued.'
          : 'Launch command queued using the selected manual cursor position.',
        'busy'
      );
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
    const action = correctionMode ? 'correct_current_map' : commandAction('change_map');
    setButtonBusy(true);
    try {
      const result = await api('/v1/web/commands/queue', {
        device_id: device.device_id,
        action,
        target_map: selectedMap
      });
      showNotice(
        !correctionMode
          ? ((result.video_assist || {}).mode === 'automatic'
            ? 'Video verified ' + String(result.video_assist.cursor || '').replace('_', ' ') + '; the correct map macro was queued for ' + mapLabelFor(result.target_map) + '.'
            : 'Map command queued using the selected manual cursor position for ' + mapLabelFor(result.target_map) + '.')
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

  els.manualRequest.addEventListener('click', async () => {
    if (!device) return;
    if (demo) {
      showNotice('Demo: manual control approved for 10 minutes.', 'success');
      return;
    }
    els.manualRequest.disabled = true;
    try {
      const result = await api('/v1/web/manual/request', {device_id: device.device_id});
      showNotice(
        result.status === 'active'
          ? 'Manual control is already active.'
          : 'Manual-control request sent to the dongle owner.',
        result.status === 'active' ? 'success' : 'busy'
      );
      await loadManualState();
    } catch (error) {
      showNotice(error.message || 'Could not request manual control.', 'error');
    } finally {
      els.manualRequest.disabled = false;
    }
  });

  els.manualRevoke.addEventListener('click', async () => {
    const session = manualSessions.find((item) => item.can_revoke) || liveManualSession();
    if (!session) return;
    if (demo) {
      manualSessions = [];
      renderManualState();
      showNotice('Demo: manual-control session ended.', 'success');
      return;
    }
    try {
      await api('/v1/web/manual/revoke', {session_id: session.session_id});
      showNotice('Manual-control session ended immediately.', 'success');
      await loadManualState();
    } catch (error) {
      showNotice(error.message || 'Could not end the manual-control session.', 'error');
    }
  });

  els.remotePad.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-manual-button]');
    if (!button || !device || manualTapLocked || !activeManualSession()) return;
    const control = button.dataset.manualButton;
    if (demo) {
      showNotice('Demo: ' + control.toUpperCase() + ' tapped.', 'success');
      return;
    }
    manualTapLocked = true;
    renderManualState();
    try {
      await api('/v1/web/manual/tap', {
        device_id: device.device_id,
        button: control
      });
      showNotice('Manual ' + control.toUpperCase() + ' tap queued.', 'busy');
      await loadDevice(device.device_id);
    } catch (error) {
      showNotice(error.message || 'Could not queue the manual button tap.', 'error');
    } finally {
      window.setTimeout(() => {
        manualTapLocked = false;
        renderManualState();
      }, 1000);
    }
  });

  els.startCamera.addEventListener('click', () => startBroadcast('camera'));
  els.startScreen.addEventListener('click', () => startBroadcast('screen'));
  els.stopBroadcast.addEventListener('click', stopBroadcast);

  els.scrollUp.addEventListener('click', () => {
    window.scrollBy({top: -Math.max(260, window.innerHeight * 0.72), behavior: 'smooth'});
  });
  els.scrollDown.addEventListener('click', () => {
    window.scrollBy({top: Math.max(260, window.innerHeight * 0.72), behavior: 'smooth'});
  });

  window.addEventListener('beforeunload', () => {
    stopBroadcast();
    releaseVideoObjectUrl();
  });

  takeSessionFromFragment();
  refresh();
  pollTimer = window.setInterval(() => {
    if ((token || demo) && document.visibilityState === 'visible') refresh(true);
  }, 4000);
})();
