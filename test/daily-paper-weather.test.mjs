import assert from "node:assert/strict";
import test from "node:test";
import {
  DailyPaperWeatherService,
  parseDefaultWeatherLocation,
} from "../src/daily-paper-weather.mjs";

test("daily paper weather extracts a city and state from the active address-style default", () => {
  assert.deepEqual(
    parseDefaultWeatherLocation("My default location is 36 Flax St, Ste 203, Delaware, Ohio 43015, United States."),
    {
      query: "Delaware",
      city: "Delaware",
      state: "Ohio",
      countryCode: "US",
      literal: "36 Flax St, Ste 203, Delaware, Ohio 43015, United States",
    },
  );
});

test("daily paper weather deterministically resolves and samples one forecast day", async () => {
  const requests = [];
  const fetchFn = async (url) => {
    requests.push(new URL(url));
    if (url.hostname === "geocoding-api.open-meteo.com") {
      return new Response(JSON.stringify({ results: [{
        name: "Delaware", admin1: "Ohio", country: "United States", country_code: "US",
        latitude: 40.29867, longitude: -83.06797,
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const times = Array.from({ length: 24 }, (_, hour) => `2026-10-16T${String(hour).padStart(2, "0")}:00`);
    return new Response(JSON.stringify({
      hourly: {
        time: times,
        temperature_2m: times.map((_, hour) => 50 + hour),
        precipitation_probability: times.map((_, hour) => hour),
        weather_code: times.map(() => 3),
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const profileFacts = { list: () => ({ facts: [
    { factType: "default_location", text: "Delaware, Ohio, United States" },
  ] }) };
  const service = new DailyPaperWeatherService({
    profileFacts,
    fetchFn,
    now: () => new Date("2026-10-16T12:00:00.000Z"),
  });

  const result = await service.read({ date: "2026-10-16", timeZone: "America/New_York" });
  assert.equal(result.status, "available");
  assert.equal(result.location, "Delaware, Ohio, United States");
  assert.equal(result.temperatureUnit, "celsius");
  assert.deepEqual(result.points.map(({ hour }) => hour), [5, 8, 11, 14, 17, 20, 23]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("name"), "Delaware");
  assert.equal(requests[0].searchParams.get("countryCode"), "US");
  assert.equal(requests[1].searchParams.get("start_date"), "2026-10-16");
  assert.equal(requests[1].searchParams.get("timezone"), "America/New_York");
  assert.equal(requests[1].searchParams.get("temperature_unit"), "celsius");
});

test("daily paper omits weather outside the bounded forecast window", async () => {
  let called = false;
  const service = new DailyPaperWeatherService({
    profileFacts: { list: () => ({ facts: [{ factType: "default_location", text: "Delaware, Ohio" }] }) },
    fetchFn: async () => { called = true; throw new Error("unexpected fetch"); },
    now: () => new Date("2026-10-16T12:00:00.000Z"),
  });
  assert.equal(await service.read({ date: "2026-11-10", timeZone: "America/New_York" }), null);
  assert.equal(called, false);
});
