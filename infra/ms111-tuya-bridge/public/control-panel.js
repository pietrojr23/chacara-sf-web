const STORAGE_KEY = 'chacara-control-panel-v1';
const DEFAULT_HEADLIGHT_VIRTUAL_ID = 'bf34982d74bfeccf87av8b';
const DEFAULT_HEADLIGHT_NAME = 'Farol Entrada Chacara';

const defaultLightsConfig = [
  { name: DEFAULT_HEADLIGHT_NAME, virtualId: DEFAULT_HEADLIGHT_VIRTUAL_ID },
];

const state = {
  settings: null,
  busyGate: false,
  busyLights: new Set(),
  lightStateById: {},
};

const elements = {
  connectionPill: document.getElementById('connection-pill'),
  apiBasePill: document.getElementById('api-base-pill'),
  gateTrigger: document.getElementById('gate-trigger'),
  gateFeedbackText: document.getElementById('gate-feedback-text'),
  lightsList: document.getElementById('lights-list'),
  lightsOnAll: document.getElementById('lights-on-all'),
  lightsOffAll: document.getElementById('lights-off-all'),
  console: document.getElementById('console'),
  openSettings: document.getElementById('open-settings'),
  closeSettings: document.getElementById('close-settings'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  apiBase: document.getElementById('api-base'),
  apiKey: document.getElementById('api-key'),
  gateDeviceId: document.getElementById('gate-device-id'),
  lightsConfig: document.getElementById('lights-config'),
};

const query = new URLSearchParams(window.location.search);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return window.location.origin;
  }
  return text.replace(/\/+$/, '');
}

function parseLightsConfig(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = lines
    .map((line) => {
      const [nameRaw, virtualIdRaw] = line.split('|');
      return {
        name: String(nameRaw ?? '').trim(),
        virtualId: String(virtualIdRaw ?? '').trim(),
      };
    })
    .filter((item) => item.name && item.virtualId);

  return items;
}

function migrateLightsConfig(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (
      item?.virtualId === DEFAULT_HEADLIGHT_VIRTUAL_ID &&
      String(item?.name ?? '').trim().toLowerCase() === 'farol principal'
    ) {
      return { ...item, name: DEFAULT_HEADLIGHT_NAME };
    }
    return item;
  });
}

function formatLightsConfig(items) {
  return items
    .map((item) => `${item.name}|${item.virtualId}`)
    .join('\n');
}

function hydrateSettings() {
  const stored = readStoredSettings();
  const apiBase = normalizeBaseUrl(query.get('apiBase') || stored?.apiBase || window.location.origin);
  const apiKey = String(query.get('k') || stored?.apiKey || '').trim();
  const gateDeviceId = String(query.get('gateDeviceId') || stored?.gateDeviceId || '').trim();
  const lights =
    Array.isArray(stored?.lights) && stored.lights.length
      ? migrateLightsConfig(stored.lights)
      : defaultLightsConfig;

  state.settings = {
    apiBase,
    apiKey,
    gateDeviceId,
    lights,
  };
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function appendConsole(message, tone = 'info') {
  const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const line = document.createElement('p');
  line.className = 'console-line';
  line.innerHTML = `<strong>[${timestamp}]</strong> ${escapeHtml(message)}`;
  if (tone === 'error') {
    line.style.color = '#ffd2c9';
  }
  elements.console.prepend(line);

  while (elements.console.children.length > 24) {
    elements.console.removeChild(elements.console.lastChild);
  }
}

function updateConnection(text, muted = false) {
  elements.connectionPill.textContent = text;
  elements.connectionPill.classList.toggle('muted', muted);
}

function setApiBasePill() {
  if (!elements.apiBasePill) {
    return;
  }

  try {
    const parsed = new URL(state.settings.apiBase);
    elements.apiBasePill.textContent = parsed.host;
  } catch {
    elements.apiBasePill.textContent = state.settings.apiBase || 'API';
  }
}

function fillSettingsForm() {
  elements.apiBase.value = state.settings.apiBase;
  elements.apiKey.value = state.settings.apiKey;
  elements.gateDeviceId.value = state.settings.gateDeviceId;
  elements.lightsConfig.value = formatLightsConfig(state.settings.lights);
}

function buildUrl(path) {
  const url = new URL(path, `${state.settings.apiBase}/`);
  if (state.settings.apiKey) {
    url.searchParams.set('k', state.settings.apiKey);
  }
  return url.toString();
}

async function postCommand(path, payload = {}) {
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data;
}

function setGateBusy(isBusy) {
  state.busyGate = isBusy;
  elements.gateTrigger.disabled = isBusy;
}

function setLightBusy(virtualId, isBusy) {
  if (isBusy) {
    state.busyLights.add(virtualId);
  } else {
    state.busyLights.delete(virtualId);
  }
  renderLights();
}

async function triggerGate() {
  if (state.busyGate) {
    return;
  }

  setGateBusy(true);
  updateConnection('Acionando portão...');

  try {
    const payload = state.settings.gateDeviceId ? { device_id: state.settings.gateDeviceId } : {};
    const result = await postCommand('/gate/open', payload);
    elements.gateFeedbackText.textContent = 'Pulso enviado ao portão.';
    appendConsole('Pulso enviado ao portão com sucesso.');
    updateConnection('Comando enviado');
    if (result?.ok === false) {
      throw new Error(result?.error || 'Falha desconhecida');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao acionar portão';
    elements.gateFeedbackText.textContent = `Falha: ${message}`;
    appendConsole(`Erro no portão: ${message}`, 'error');
    updateConnection('Falha no comando', true);
  } finally {
    setGateBusy(false);
  }
}

async function runHeadlightAction(light, action) {
  if (!light?.virtualId) {
    return;
  }

  setLightBusy(light.virtualId, true);
  updateConnection(action === 'on' ? `Acendendo ${light.name}...` : `Apagando ${light.name}...`);

  try {
    const result = await postCommand(action === 'on' ? '/headlights/on' : '/headlights/off', {
      virtual_id: light.virtualId,
    });

    if (typeof result?.state === 'boolean') {
      state.lightStateById[light.virtualId] = result.state;
    } else {
      state.lightStateById[light.virtualId] = action === 'on';
    }

    appendConsole(`${light.name}: ${action === 'on' ? 'aceso' : 'apagado'}.`);
    updateConnection('Comando enviado');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao acionar farol';
    appendConsole(`Erro em ${light.name}: ${message}`, 'error');
    updateConnection('Falha no comando', true);
  } finally {
    setLightBusy(light.virtualId, false);
  }
}

async function runAllLights(action) {
  const lights = state.settings.lights.filter((item) => item.virtualId);
  for (const light of lights) {
    // Sequencial para evitar pico de requests no bridge.
    // eslint-disable-next-line no-await-in-loop
    await runHeadlightAction(light, action);
  }
}

function getLightStateLabel(virtualId) {
  const stateValue = state.lightStateById[virtualId];
  if (stateValue === true) return { label: 'Ligado', className: 'state-chip state-on' };
  if (stateValue === false) return { label: 'Desligado', className: 'state-chip state-off' };
  return { label: 'Sem leitura', className: 'state-chip' };
}

function renderLights() {
  const items = state.settings.lights.filter((item) => item.name && item.virtualId);

  if (!items.length) {
    elements.lightsList.innerHTML = `
      <div class="light-card">
        <div class="light-topline">
          <div>
            <h3 class="light-title">Nenhum farol configurado</h3>
            <p class="light-meta">Abra “Configurar” e adicione linhas no formato Nome|virtual_id.</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  elements.lightsList.innerHTML = items
    .map((item) => {
      const chip = getLightStateLabel(item.virtualId);
      const busy = state.busyLights.has(item.virtualId);
      return `
        <section class="light-card">
          <div class="light-topline">
            <div>
              <h3 class="light-title">${escapeHtml(item.name)}</h3>
              <p class="light-meta">${escapeHtml(item.virtualId)}</p>
            </div>
            <span class="${chip.className}">${chip.label}</span>
          </div>
          <div class="light-actions">
            <button class="light-button on" data-action="on" data-virtual-id="${escapeHtml(item.virtualId)}" ${busy ? 'disabled' : ''}>
              Acender
            </button>
            <button class="light-button off" data-action="off" data-virtual-id="${escapeHtml(item.virtualId)}" ${busy ? 'disabled' : ''}>
              Apagar
            </button>
          </div>
        </section>
      `;
    })
    .join('');

  elements.lightsList.querySelectorAll('.light-button').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const target = event.currentTarget;
      const virtualId = target.getAttribute('data-virtual-id');
      const action = target.getAttribute('data-action');
      const light = state.settings.lights.find((item) => item.virtualId === virtualId);
      if (!light || (action !== 'on' && action !== 'off')) {
        return;
      }
      await runHeadlightAction(light, action);
    });
  });
}

function openSettings() {
  fillSettingsForm();
  elements.settingsDialog.showModal();
}

function closeSettings() {
  elements.settingsDialog.close();
}

function bindEvents() {
  elements.gateTrigger.addEventListener('click', () => triggerGate());
  elements.lightsOnAll.addEventListener('click', () => runAllLights('on'));
  elements.lightsOffAll.addEventListener('click', () => runAllLights('off'));
  elements.openSettings.addEventListener('click', openSettings);
  elements.closeSettings.addEventListener('click', closeSettings);

  elements.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const lights = parseLightsConfig(elements.lightsConfig.value);
    state.settings = {
      apiBase: normalizeBaseUrl(elements.apiBase.value),
      apiKey: String(elements.apiKey.value ?? '').trim(),
      gateDeviceId: String(elements.gateDeviceId.value ?? '').trim(),
      lights,
    };

    persistSettings();
    setApiBasePill();
    renderLights();
    closeSettings();
    appendConsole('Configuração salva.');
    updateConnection('Configuração atualizada');
  });
}

function bootstrap() {
  hydrateSettings();
  bindEvents();
  fillSettingsForm();
  setApiBasePill();
  renderLights();
  appendConsole('Painel pronto para uso.');
  updateConnection('Pronto');
}

bootstrap();
