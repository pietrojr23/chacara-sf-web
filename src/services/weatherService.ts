import axios from 'axios';
import { WeatherDay } from '../types/models';

interface ForecastResponse {
  list: Array<{
    dt_txt: string;
    weather: Array<{ description: string; icon: string }>;
    main: { temp_min: number; temp_max: number };
  }>;
}

interface OpenMeteoForecastResponse {
  daily?: {
    time?: string[];
    weather_code?: number[];
    weathercode?: number[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
  };
}

const API_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

const isValidOpenWeatherKey = (value: string | undefined) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return false;
  }

  const invalidSamples = ['...', 'SUA_CHAVE', 'YOUR_KEY', 'YOUR_API_KEY'];
  return !invalidSamples.some((sample) => normalized.toUpperCase().includes(sample));
};

const mapOpenMeteoCode = (code: number) => {
  const value = Number.isFinite(code) ? Math.trunc(code) : 0;
  if (value === 0) return { description: 'Céu limpo', icon: '01d' };
  if ([1, 2, 3].includes(value)) return { description: 'Parcialmente nublado', icon: '03d' };
  if ([45, 48].includes(value)) return { description: 'Neblina', icon: '50d' };
  if ([51, 53, 55, 56, 57].includes(value)) return { description: 'Garoa', icon: '09d' };
  if ([61, 63, 65, 66, 67].includes(value)) return { description: 'Chuva', icon: '10d' };
  if ([71, 73, 75, 77, 85, 86].includes(value)) return { description: 'Neve', icon: '13d' };
  if ([80, 81, 82].includes(value)) return { description: 'Pancadas de chuva', icon: '09d' };
  if ([95, 96, 99].includes(value)) return { description: 'Tempestade', icon: '11d' };
  return { description: 'Tempo variável', icon: '03d' };
};

const getOpenWeatherForecast = async (lat: number, lon: number, apiKey: string): Promise<WeatherDay[]> => {
  const response = await axios.get<ForecastResponse>(API_URL, {
    params: {
      lat,
      lon,
      appid: apiKey,
      units: 'metric',
      lang: 'pt_br',
    },
    timeout: 8000,
  });

  const grouped = new Map<string, WeatherDay>();

  for (const item of response.data.list) {
    const date = item.dt_txt.split(' ')[0];

    if (!grouped.has(date)) {
      grouped.set(date, {
        date,
        tempMin: item.main.temp_min,
        tempMax: item.main.temp_max,
        description: item.weather[0]?.description ?? 'Sem previsão',
        icon: item.weather[0]?.icon ?? '01d',
      });
      continue;
    }

    const current = grouped.get(date)!;
    current.tempMin = Math.min(current.tempMin, item.main.temp_min);
    current.tempMax = Math.max(current.tempMax, item.main.temp_max);
  }

  return Array.from(grouped.values()).slice(0, 3);
};

const getOpenMeteoForecast = async (lat: number, lon: number): Promise<WeatherDay[]> => {
  const response = await axios.get<OpenMeteoForecastResponse>(OPEN_METEO_URL, {
    params: {
      latitude: lat,
      longitude: lon,
      timezone: 'auto',
      forecast_days: 3,
      daily: 'weather_code,temperature_2m_min,temperature_2m_max',
    },
    timeout: 8000,
  });

  const times = response.data.daily?.time ?? [];
  const min = response.data.daily?.temperature_2m_min ?? [];
  const max = response.data.daily?.temperature_2m_max ?? [];
  const code = response.data.daily?.weather_code ?? response.data.daily?.weathercode ?? [];

  const size = Math.min(times.length, min.length, max.length, code.length);
  const days: WeatherDay[] = [];

  for (let index = 0; index < size; index += 1) {
    const mapped = mapOpenMeteoCode(code[index] ?? 0);
    days.push({
      date: times[index],
      tempMin: Number(min[index] ?? 0),
      tempMax: Number(max[index] ?? 0),
      description: mapped.description,
      icon: mapped.icon,
    });
  }

  return days.slice(0, 3);
};

export const getWeatherForecast = async (lat: number, lon: number): Promise<WeatherDay[]> => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return [];
  }

  const apiKey = String(process.env.EXPO_PUBLIC_OPENWEATHER_KEY ?? '').trim();
  if (isValidOpenWeatherKey(apiKey)) {
    try {
      return await getOpenWeatherForecast(lat, lon, apiKey);
    } catch {
      // fallback sem chave
    }
  }

  return getOpenMeteoForecast(lat, lon);
};
