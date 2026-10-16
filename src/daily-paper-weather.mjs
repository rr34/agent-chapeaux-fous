const FORECAST_DAYS = 16;
const WEATHER_HOURS = new Set([5, 8, 11, 14, 17, 20, 23]);
const WEATHER_REQUEST_TIMEOUT_MS = 4_000;
const LOCATION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const FORECAST_CACHE_MS = 30 * 60 * 1000;

const US_STATES = new Map(Object.entries({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
}));

function normalizedWords(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dateValue(localDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDate ?? ""));
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function localDateForInstant(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function locationTextFromFacts(facts) {
  return facts.find(({ factType }) => factType === "default_location")?.text?.trim() || null;
}

function temperatureUnitFromFacts(facts) {
  const text = facts.find(({ factType }) => factType === "temperature_unit")?.text || "";
  return /celsius|centigrade|°c\b/iu.test(text) ? "celsius" : "fahrenheit";
}

function stateFromPart(part) {
  const normalized = normalizedWords(part).replace(/\b\d{5}(?: \d{4})?\b/g, "").trim();
  for (const [abbreviation, name] of US_STATES) {
    if (normalized === abbreviation.toLowerCase() || normalized === name.toLowerCase()) {
      return { abbreviation, name };
    }
  }
  return null;
}

export function parseDefaultWeatherLocation(value) {
  const literal = String(value ?? "").trim()
    .replace(/^(?:my\s+)?default\s+location\s+is\s+/iu, "")
    .replace(/[.]$/u, "")
    .trim();
  if (!literal) return null;
  const parts = literal.split(",").map((part) => part.trim()).filter(Boolean);
  const stateIndex = parts.findLastIndex((part) => stateFromPart(part));
  const state = stateIndex >= 0 ? stateFromPart(parts[stateIndex]) : null;
  const countryIsUs = /\b(?:united states|usa|u s a|us)\b/iu.test(literal) || Boolean(state);
  if (state && stateIndex > 0) {
    const city = parts[stateIndex - 1].replace(/^ste\.?\s+\w+$/iu, "").trim();
    if (city) return { query: city, city, state: state.name, countryCode: "US", literal };
  }
  if (parts.length >= 2) {
    const country = parts.at(-1);
    const city = parts.at(-2);
    return {
      query: city,
      city,
      state: null,
      countryCode: countryIsUs || /united states|usa/iu.test(country) ? "US" : null,
      literal,
    };
  }
  return { query: literal, city: literal, state: null, countryCode: countryIsUs ? "US" : null, literal };
}

function locationScore(candidate, requested) {
  let score = 0;
  if (normalizedWords(candidate.name) === normalizedWords(requested.city)) score += 8;
  if (requested.state && normalizedWords(candidate.admin1) === normalizedWords(requested.state)) score += 6;
  if (requested.countryCode && String(candidate.country_code).toUpperCase() === requested.countryCode) score += 4;
  return score;
}

async function jsonFetch(fetchFn, url, label) {
  const response = await fetchFn(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(WEATHER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned invalid JSON`);
  }
  return value;
}

export class DailyPaperWeatherService {
  constructor({ profileFacts, fetchFn = globalThis.fetch, now = () => new Date() }) {
    this.profileFacts = profileFacts;
    this.fetchFn = fetchFn;
    this.now = now;
    this.locations = new Map();
    this.forecasts = new Map();
  }

  activeFacts() {
    return this.profileFacts?.list({
      status: "active",
      factTypes: ["default_location", "temperature_unit"],
      limit: null,
    }).facts ?? [];
  }

  async resolveLocation(requested) {
    const cached = this.locations.get(requested.literal);
    if (cached && this.now().getTime() - cached.cachedAtMs < LOCATION_CACHE_MS) return cached.value;
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", requested.query);
    url.searchParams.set("count", "10");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    if (requested.countryCode) url.searchParams.set("countryCode", requested.countryCode);
    const response = await jsonFetch(this.fetchFn, url, "Open-Meteo geocoding");
    const candidates = Array.isArray(response.results) ? response.results : [];
    const location = [...candidates]
      .sort((left, right) => locationScore(right, requested) - locationScore(left, requested))[0];
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error(`Open-Meteo could not resolve ${requested.literal}`);
    }
    const value = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      displayName: [location.name, location.admin1, location.country].filter(Boolean).join(", "),
    };
    this.locations.set(requested.literal, { cachedAtMs: this.now().getTime(), value });
    return value;
  }

  async read({ date, timeZone }) {
    const facts = this.activeFacts();
    const requested = parseDefaultWeatherLocation(locationTextFromFacts(facts));
    if (!requested) return null;
    const today = localDateForInstant(this.now(), timeZone);
    const dayDistance = (dateValue(date) - dateValue(today)) / 86_400_000;
    if (!Number.isInteger(dayDistance) || dayDistance < 0 || dayDistance >= FORECAST_DAYS) return null;
    const temperatureUnit = temperatureUnitFromFacts(facts);
    const location = await this.resolveLocation(requested);
    const cacheKey = [location.latitude, location.longitude, date, timeZone, temperatureUnit].join("|");
    const cached = this.forecasts.get(cacheKey);
    if (cached && this.now().getTime() - cached.cachedAtMs < FORECAST_CACHE_MS) return cached.value;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
    url.searchParams.set("temperature_unit", temperatureUnit);
    url.searchParams.set("timezone", timeZone);
    url.searchParams.set("start_date", date);
    url.searchParams.set("end_date", date);
    const response = await jsonFetch(this.fetchFn, url, "Open-Meteo forecast");
    const times = Array.isArray(response.hourly?.time) ? response.hourly.time : [];
    const temperatures = response.hourly?.temperature_2m ?? [];
    const probabilities = response.hourly?.precipitation_probability ?? [];
    const codes = response.hourly?.weather_code ?? [];
    const points = times.flatMap((time, index) => {
      const hour = Number(String(time).slice(11, 13));
      if (!WEATHER_HOURS.has(hour)) return [];
      const temperature = Number(temperatures[index]);
      const precipitationProbability = Number(probabilities[index]);
      const weatherCode = Number(codes[index]);
      if (![temperature, precipitationProbability, weatherCode].every(Number.isFinite)) return [];
      return [{ time, hour, temperature, precipitationProbability, weatherCode }];
    });
    if (!points.length) throw new Error("Open-Meteo returned no usable forecast points");
    const value = {
      status: "available",
      provider: "Open-Meteo.com",
      attributionUrl: "https://open-meteo.com/",
      fetchedAtUtc: this.now().toISOString(),
      location: location.displayName,
      temperatureUnit,
      points,
    };
    this.forecasts.set(cacheKey, { cachedAtMs: this.now().getTime(), value });
    return value;
  }
}
