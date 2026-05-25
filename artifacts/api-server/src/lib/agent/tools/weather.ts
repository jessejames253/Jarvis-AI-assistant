/**
 * agent/tools/weather.ts — Free weather via wttr.in (no API key required)
 */

export interface WeatherResult {
  location: string;
  condition: string;
  tempC: number;
  tempF: number;
  humidity: number;
  windKph: number;
  feelsLikeC: number;
  feelsLikeF: number;
}

export async function getWeather(location: string): Promise<WeatherResult> {
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Jarvis/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Weather API returned ${res.status}`);

  const data = (await res.json()) as {
    nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
    current_condition?: Array<{
      weatherDesc?: Array<{ value?: string }>;
      temp_C?: string;
      temp_F?: string;
      humidity?: string;
      windspeedKmph?: string;
      FeelsLikeC?: string;
      FeelsLikeF?: string;
    }>;
  };

  const c = data.current_condition?.[0];
  const area = data.nearest_area?.[0];
  const city = area?.areaName?.[0]?.value ?? location;
  const country = area?.country?.[0]?.value ?? "";

  return {
    location: country ? `${city}, ${country}` : city,
    condition: c?.weatherDesc?.[0]?.value ?? "Unknown",
    tempC: Number(c?.temp_C ?? 0),
    tempF: Number(c?.temp_F ?? 0),
    humidity: Number(c?.humidity ?? 0),
    windKph: Number(c?.windspeedKmph ?? 0),
    feelsLikeC: Number(c?.FeelsLikeC ?? 0),
    feelsLikeF: Number(c?.FeelsLikeF ?? 0),
  };
}
