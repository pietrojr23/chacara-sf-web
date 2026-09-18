require('dotenv').config();

const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const accessKey = String(process.env.TUYA_ACCESS_KEY || '').trim();
const secretKey = String(process.env.TUYA_SECRET_KEY || '').trim();
const deviceId = String(process.env.TUYA_DEVICE_ID || '').trim();
const preferredBaseUrl = String(process.env.TUYA_BASE_URL || '').trim().replace(/\/+$/, '');

const defaults = [
  'https://openapi.tuyaus.com',
  'https://openapi-ueaz.tuyaus.com',
  'https://openapi.tuyaeu.com',
  'https://openapi.tuyain.com',
  'https://openapi.tuyacn.com',
];

const mergeBaseUrls = () => {
  const list = [preferredBaseUrl, ...defaults].filter(Boolean).map((item) => item.replace(/\/+$/, ''));
  return list.filter((item, index) => list.indexOf(item) === index);
};

if (!accessKey || !secretKey || !deviceId) {
  console.error('ERRO: configure TUYA_ACCESS_KEY, TUYA_SECRET_KEY e TUYA_DEVICE_ID no .env');
  process.exit(1);
}

const baseUrls = mergeBaseUrls();

const run = async () => {
  let success = false;

  for (const baseUrl of baseUrls) {
    const tuya = new TuyaContext({
      baseUrl,
      accessKey,
      secretKey,
    });

    try {
      const response = await tuya.request({
        method: 'GET',
        path: `/v1.0/iot-03/devices/${deviceId}/functions`,
      });

      const code = response?.code != null ? String(response.code) : '-';
      const msg = response?.msg || 'ok';
      const ok = response?.success === true;

      if (ok) {
        console.log(`OK   ${baseUrl}  -> success=true`);
        success = true;
        break;
      }

      console.log(`FAIL ${baseUrl}  -> code=${code} msg="${msg}"`);
    } catch (error) {
      console.log(`FAIL ${baseUrl}  -> exception="${String(error?.message || error)}"`);
    }
  }

  if (!success) {
    process.exit(2);
  }
};

void run();
