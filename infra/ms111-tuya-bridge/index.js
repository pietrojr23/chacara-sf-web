require('dotenv').config();

const express = require('express');
const path = require('path');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 8787);
const BRIDGE_API_KEY = String(process.env.BRIDGE_API_KEY || '').trim();

const TUYA_BASE_URL = String(process.env.TUYA_BASE_URL || '').trim();
const TUYA_BASE_URLS_EXTRA = String(process.env.TUYA_BASE_URLS || '').trim();
const TUYA_ACCESS_KEY = String(process.env.TUYA_ACCESS_KEY || '').trim();
const TUYA_SECRET_KEY = String(process.env.TUYA_SECRET_KEY || '').trim();
const TUYA_DEVICE_ID = String(process.env.TUYA_DEVICE_ID || '').trim();

const SINGLE_BUTTON_MODE = String(process.env.SINGLE_BUTTON_MODE || 'true').trim().toLowerCase() !== 'false';
const PULSE_MS = Number(process.env.PULSE_MS || 700);

const OPEN_COMMAND_CODE = String(process.env.OPEN_COMMAND_CODE || 'switch_1').trim();
const CLOSE_COMMAND_CODE = String(process.env.CLOSE_COMMAND_CODE || OPEN_COMMAND_CODE).trim();

const parseValue = (raw, fallback) => {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;

  if (text.toLowerCase() === 'true') return true;
  if (text.toLowerCase() === 'false') return false;

  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && String(asNumber) === text) {
    return asNumber;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const OPEN_ON_VALUE = parseValue(process.env.OPEN_ON_VALUE, true);
const OPEN_OFF_VALUE = parseValue(process.env.OPEN_OFF_VALUE, false);
const CLOSE_ON_VALUE = parseValue(process.env.CLOSE_ON_VALUE, true);
const CLOSE_OFF_VALUE = parseValue(process.env.CLOSE_OFF_VALUE, false);
const HEADLIGHTS_COMMAND_CODE = String(process.env.HEADLIGHTS_COMMAND_CODE || OPEN_COMMAND_CODE).trim();
const HEADLIGHTS_ON_VALUE = parseValue(process.env.HEADLIGHTS_ON_VALUE, true);
const HEADLIGHTS_OFF_VALUE = parseValue(process.env.HEADLIGHTS_OFF_VALUE, false);

const DEFAULT_TUYA_BASE_URLS = [
  'https://openapi.tuyaus.com',
  'https://openapi-ueaz.tuyaus.com',
  'https://openapi.tuyaeu.com',
  'https://openapi.tuyain.com',
  'https://openapi.tuyacn.com',
];

const normalizeBaseUrl = (baseUrl) => String(baseUrl || '').trim().replace(/\/+$/, '');

const buildBaseUrlList = () => {
  const preferred = normalizeBaseUrl(TUYA_BASE_URL);
  const extra = TUYA_BASE_URLS_EXTRA
    .split(',')
    .map((item) => normalizeBaseUrl(item))
    .filter(Boolean);

  const fallback = DEFAULT_TUYA_BASE_URLS.map((item) => normalizeBaseUrl(item)).filter(Boolean);
  const merged = [preferred, ...extra, ...fallback].filter(Boolean);

  return merged.filter((item, index, array) => array.indexOf(item) === index);
};

const TUYA_BASE_URLS = buildBaseUrlList();

if (!TUYA_ACCESS_KEY || !TUYA_SECRET_KEY || !TUYA_DEVICE_ID || TUYA_BASE_URLS.length === 0) {
  console.warn('[bridge] Variáveis Tuya incompletas. Configure o .env antes de usar.');
}

const tuyaClients = TUYA_BASE_URLS.map((baseUrl) => ({
  baseUrl,
  client: new TuyaContext({
    baseUrl,
    accessKey: TUYA_ACCESS_KEY,
    secretKey: TUYA_SECRET_KEY,
  }),
}));

let lastSuccessfulBaseUrl = null;
const lastHeadlightsStateByDevice = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAuthorized = (req) => {
  if (!BRIDGE_API_KEY) return true;
  const queryKey = String(req.query.k || '').trim();
  const headerKey = String(req.get('x-api-key') || '').trim();
  return queryKey === BRIDGE_API_KEY || headerKey === BRIDGE_API_KEY;
};

const requireAuth = (req, res, next) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
};

const resolveDeviceId = (deviceIdOverride) => String(deviceIdOverride || TUYA_DEVICE_ID || '').trim();

const ensureTuyaConfig = (deviceIdOverride) => {
  const resolvedDeviceId = resolveDeviceId(deviceIdOverride);
  if (!TUYA_ACCESS_KEY || !TUYA_SECRET_KEY || !resolvedDeviceId || tuyaClients.length === 0) {
    throw new Error('tuya_config_missing');
  }
};

const isTuyaSuccess = (response) => Boolean(response && response.success === true);

const orderClients = () => {
  if (!lastSuccessfulBaseUrl) return tuyaClients;

  const prioritized = tuyaClients.find((item) => item.baseUrl === lastSuccessfulBaseUrl);
  if (!prioritized) return tuyaClients;

  return [prioritized, ...tuyaClients.filter((item) => item.baseUrl !== lastSuccessfulBaseUrl)];
};

const requestTuyaWithFallback = async ({ method, path, body }) => {
  const attempts = [];
  const clients = orderClients();

  for (const { baseUrl, client } of clients) {
    try {
      const response = await client.request({ method, path, body });
      if (isTuyaSuccess(response)) {
        lastSuccessfulBaseUrl = baseUrl;
        return { response, baseUrl, attempts };
      }

      attempts.push({
        baseUrl,
        code: response?.code ?? null,
        msg: response?.msg ?? null,
        success: Boolean(response?.success),
      });
    } catch (error) {
      attempts.push({
        baseUrl,
        error: String(error?.message || error),
      });
    }
  }

  const compositeError = new Error('tuya_request_failed');
  compositeError.attempts = attempts;
  throw compositeError;
};

const summarizeAttempts = (attempts = []) =>
  attempts
    .map((attempt) => {
      if (attempt.error) {
        return `${attempt.baseUrl} => ${attempt.error}`;
      }

      const code = attempt.code != null ? String(attempt.code) : 'unknown';
      const msg = attempt.msg || 'sem mensagem';
      return `${attempt.baseUrl} => ${code}: ${msg}`;
    })
    .join(' | ');

const buildErrorPayload = (error) => {
  const message = String(error?.message || error);
  const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
  const attemptsSummary = summarizeAttempts(attempts);
  const attemptsLower = attemptsSummary.toLowerCase();

  if (message === 'tuya_config_missing') {
    return {
      status: 500,
      payload: {
        ok: false,
        error: 'tuya_config_missing',
        message: 'Configuração Tuya incompleta no bridge (.env).',
      },
    };
  }

  if (message === 'tuya_request_failed') {
    const suspended = attemptsLower.includes('28841107') || attemptsLower.includes('data center is suspended');
    const crossRegion = attemptsLower.includes('cross-region access is not allowed');

    if (suspended) {
      return {
        status: 503,
        payload: {
          ok: false,
          error: 'tuya_data_center_suspended',
          message:
            'Projeto Tuya sem permissão ativa (data center suspenso). Ative o Data Center/APIs no Tuya IoT Platform.',
          attempts,
        },
      };
    }

    if (crossRegion) {
      return {
        status: 503,
        payload: {
          ok: false,
          error: 'tuya_cross_region_denied',
          message: 'A chave está em outra região Tuya. Ajuste o data center no projeto Tuya.',
          attempts,
        },
      };
    }

    return {
      status: 503,
      payload: {
        ok: false,
        error: 'tuya_request_failed',
        message: 'Falha ao executar requisição no Tuya Cloud.',
        attempts,
      },
    };
  }

  return {
    status: 500,
    payload: {
      ok: false,
      error: message || 'bridge_error',
    },
  };
};

const sendDeviceCommand = async (code, value, deviceIdOverride) => {
  const resolvedDeviceId = resolveDeviceId(deviceIdOverride);
  const { response, baseUrl } = await requestTuyaWithFallback({
    method: 'POST',
    path: `/v1.0/iot-03/devices/${resolvedDeviceId}/commands`,
    body: {
      commands: [{ code, value }],
    },
  });

  return { response, baseUrl };
};

const readDeviceStatusValue = async (deviceIdOverride, code) => {
  const resolvedDeviceId = resolveDeviceId(deviceIdOverride);
  const { response, baseUrl } = await requestTuyaWithFallback({
    method: 'GET',
    path: `/v1.0/iot-03/devices/${resolvedDeviceId}/status`,
  });

  const statusItems = Array.isArray(response?.result) ? response.result : [];
  const matched = statusItems.find((item) => String(item?.code || '').trim() === code);

  return {
    value: matched?.value,
    baseUrl,
  };
};

const coerceToBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'on', 'ligado', 'aberto'].includes(normalized)) return true;
  if (['false', '0', 'off', 'desligado', 'fechado'].includes(normalized)) return false;
  return fallback;
};

const pulseCommand = async ({ code, onValue, offValue, pulseMs, deviceId }) => {
  const first = await sendDeviceCommand(code, onValue, deviceId);
  const baseUrlsUsed = [first.baseUrl];

  if (Number.isFinite(pulseMs) && pulseMs > 0) {
    await sleep(pulseMs);
    const second = await sendDeviceCommand(code, offValue, deviceId);
    baseUrlsUsed.push(second.baseUrl);
  }

  return {
    baseUrlsUsed: baseUrlsUsed.filter((item, index, array) => array.indexOf(item) === index),
  };
};

const runOpenAction = async ({ deviceId } = {}) => {
  const resolvedDeviceId = resolveDeviceId(deviceId);
  ensureTuyaConfig(resolvedDeviceId);
  const commandResult = await pulseCommand({
    code: OPEN_COMMAND_CODE,
    onValue: OPEN_ON_VALUE,
    offValue: OPEN_OFF_VALUE,
    pulseMs: PULSE_MS,
    deviceId: resolvedDeviceId,
  });
  return {
    ok: true,
    action: 'open',
    deviceId: resolvedDeviceId,
    mode: SINGLE_BUTTON_MODE ? 'single_button' : 'separate',
    tuyaBaseUrls: commandResult.baseUrlsUsed,
  };
};

const runCloseAction = async ({ deviceId } = {}) => {
  const resolvedDeviceId = resolveDeviceId(deviceId);
  ensureTuyaConfig(resolvedDeviceId);

  if (SINGLE_BUTTON_MODE) {
    const commandResult = await pulseCommand({
      code: OPEN_COMMAND_CODE,
      onValue: OPEN_ON_VALUE,
      offValue: OPEN_OFF_VALUE,
      pulseMs: PULSE_MS,
      deviceId: resolvedDeviceId,
    });
    return {
      ok: true,
      action: 'close',
      deviceId: resolvedDeviceId,
      mode: 'single_button',
      tuyaBaseUrls: commandResult.baseUrlsUsed,
    };
  }

  const commandResult = await pulseCommand({
    code: CLOSE_COMMAND_CODE,
    onValue: CLOSE_ON_VALUE,
    offValue: CLOSE_OFF_VALUE,
    pulseMs: PULSE_MS,
    deviceId: resolvedDeviceId,
  });
  return {
    ok: true,
    action: 'close',
    deviceId: resolvedDeviceId,
    mode: 'separate',
    tuyaBaseUrls: commandResult.baseUrlsUsed,
  };
};

const runHeadlightsSetAction = async ({ deviceId, desiredOn }) => {
  const resolvedDeviceId = resolveDeviceId(deviceId);
  ensureTuyaConfig(resolvedDeviceId);
  const value = desiredOn ? HEADLIGHTS_ON_VALUE : HEADLIGHTS_OFF_VALUE;
  const commandResult = await sendDeviceCommand(HEADLIGHTS_COMMAND_CODE, value, resolvedDeviceId);
  lastHeadlightsStateByDevice.set(resolvedDeviceId, Boolean(desiredOn));

  return {
    ok: true,
    action: desiredOn ? 'headlights_on' : 'headlights_off',
    state: Boolean(desiredOn),
    deviceId: resolvedDeviceId,
    commandCode: HEADLIGHTS_COMMAND_CODE,
    mode: 'switch_state',
    tuyaBaseUrls: [commandResult.baseUrl],
  };
};

const runHeadlightsToggleAction = async ({ deviceId }) => {
  const resolvedDeviceId = resolveDeviceId(deviceId);
  ensureTuyaConfig(resolvedDeviceId);
  const cachedState = lastHeadlightsStateByDevice.get(resolvedDeviceId);
  let currentState = false;
  let statusBaseUrl = null;
  let stateSource = 'cache';

  if (typeof cachedState === 'boolean') {
    currentState = cachedState;
  } else {
    const statusResult = await readDeviceStatusValue(resolvedDeviceId, HEADLIGHTS_COMMAND_CODE);
    currentState = coerceToBoolean(statusResult.value, false);
    statusBaseUrl = statusResult.baseUrl;
    stateSource = 'tuya_status';
  }

  const nextState = !currentState;

  const commandResult = await sendDeviceCommand(
    HEADLIGHTS_COMMAND_CODE,
    nextState ? HEADLIGHTS_ON_VALUE : HEADLIGHTS_OFF_VALUE,
    resolvedDeviceId,
  );
  lastHeadlightsStateByDevice.set(resolvedDeviceId, nextState);

  return {
    ok: true,
    action: 'headlights_toggle',
    previousState: currentState,
    state: nextState,
    stateSource,
    deviceId: resolvedDeviceId,
    commandCode: HEADLIGHTS_COMMAND_CODE,
    mode: 'switch_state',
    tuyaBaseUrls: [statusBaseUrl, commandResult.baseUrl]
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index),
  };
};

const resolveRequestDeviceId = (req) =>
  String(
    req.body?.virtual_id ??
      req.body?.virtualId ??
      req.body?.device_id ??
      req.body?.deviceId ??
      '',
  ).trim();

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'ms111-tuya-bridge',
    singleButtonMode: SINGLE_BUTTON_MODE,
    pulseMs: PULSE_MS,
    tuyaBaseUrls: TUYA_BASE_URLS,
    lastSuccessfulBaseUrl,
  });
});

app.get('/control-panel', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control-panel.html'));
});

app.get('/tuya/device/functions', requireAuth, async (_req, res) => {
  try {
    ensureTuyaConfig();
    const { response, baseUrl } = await requestTuyaWithFallback({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${TUYA_DEVICE_ID}/functions`,
    });

    return res.json({ ok: true, response, tuyaBaseUrl: baseUrl });
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.get('/tuya/device/status', requireAuth, async (_req, res) => {
  try {
    ensureTuyaConfig();
    const { response, baseUrl } = await requestTuyaWithFallback({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${TUYA_DEVICE_ID}/status`,
    });

    return res.json({ ok: true, response, tuyaBaseUrl: baseUrl });
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/gate/open', requireAuth, async (req, res) => {
  try {
    const deviceId = resolveRequestDeviceId(req);
    return res.json(await runOpenAction({ deviceId }));
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/gate/close', requireAuth, async (req, res) => {
  try {
    const deviceId = resolveRequestDeviceId(req);
    return res.json(await runCloseAction({ deviceId }));
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/headlights/on', requireAuth, async (req, res) => {
  const deviceId = resolveRequestDeviceId(req);
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'missing_virtual_id' });
  }

  try {
    return res.json(await runHeadlightsSetAction({ deviceId, desiredOn: true }));
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/headlights/off', requireAuth, async (req, res) => {
  const deviceId = resolveRequestDeviceId(req);
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'missing_virtual_id' });
  }

  try {
    return res.json(await runHeadlightsSetAction({ deviceId, desiredOn: false }));
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/headlights/toggle', requireAuth, async (req, res) => {
  const deviceId = resolveRequestDeviceId(req);
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'missing_virtual_id' });
  }

  try {
    return res.json(await runHeadlightsToggleAction({ deviceId }));
  } catch (error) {
    const { status, payload } = buildErrorPayload(error);
    return res.status(status).json(payload);
  }
});

app.post('/gate', requireAuth, async (req, res) => {
  const body = req.body || {};
  const deviceId = resolveRequestDeviceId(req);
  const actionRaw = String(body.action || body.status || '').trim().toLowerCase();

  if (!actionRaw) {
    return res.status(400).json({ ok: false, error: 'missing_action' });
  }

  if (['aberto', 'open', 'abrir'].includes(actionRaw)) {
    try {
      return res.json(await runOpenAction({ deviceId }));
    } catch (error) {
      const { status, payload } = buildErrorPayload(error);
      return res.status(status).json(payload);
    }
  }

  if (['fechado', 'close', 'fechar'].includes(actionRaw)) {
    try {
      return res.json(await runCloseAction({ deviceId }));
    } catch (error) {
      const { status, payload } = buildErrorPayload(error);
      return res.status(status).json(payload);
    }
  }

  return res.status(400).json({ ok: false, error: 'invalid_action' });
});

app.listen(PORT, () => {
  console.log(`[bridge] MS-111 Tuya bridge online na porta ${PORT}`);
  console.log(`[bridge] Health: GET http://localhost:${PORT}/health`);
  console.log(`[bridge] Tuya base URLs: ${TUYA_BASE_URLS.join(', ')}`);
});
