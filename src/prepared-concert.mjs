import { randomUUID, timingSafeEqual } from "node:crypto";

function preparedVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw Object.assign(new Error("AI voice volume must be between 0 and 1"), { statusCode: 400 });
  }
  return volume;
}

function sameSecret(left, right) {
  const supplied = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(String(right ?? ""));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function publicConcert(concert) {
  return {
    concertId: concert.concertId,
    voiceVolume: concert.voiceVolume,
    failedNarrationCount: concert.failedNarrationCount,
    expiresAtMs: concert.expiresAtMs,
    items: concert.items.map((item, index) => ({
      kind: item.kind,
      queueIndex: item.queueIndex,
      streamUrl: `/api/music/prepared-concerts/${concert.concertId}/items/${index}/stream?token=${encodeURIComponent(concert.playbackToken)}`,
    })),
  };
}

export class PreparedConcertService {
  constructor({
    narration,
    maximumConcerts = 20,
    maximumItems = 200,
    narrationConcurrency = 2,
    ttlMs = 6 * 60 * 60 * 1_000,
    now = () => Date.now(),
    createId = randomUUID,
    createToken = randomUUID,
  }) {
    this.narration = narration;
    this.maximumConcerts = maximumConcerts;
    this.maximumItems = maximumItems;
    this.narrationConcurrency = narrationConcurrency;
    this.ttlMs = ttlMs;
    this.now = now;
    this.createId = createId;
    this.createToken = createToken;
    this.concerts = new Map();
  }

  removeConcert(concertId) {
    const concert = this.concerts.get(String(concertId));
    if (!concert) return false;
    for (const narrationId of concert.preparedNarrationIds) this.narration.remove(narrationId);
    this.concerts.delete(concert.concertId);
    return true;
  }

  prune() {
    const now = this.now();
    for (const [concertId, concert] of this.concerts) {
      if (concert.expiresAtMs <= now) this.removeConcert(concertId);
    }
    while (this.concerts.size > this.maximumConcerts) {
      const oldestId = this.concerts.keys().next().value;
      if (!oldestId) break;
      this.removeConcert(oldestId);
    }
  }

  async create({ voiceVolume, items }) {
    const volume = preparedVolume(voiceVolume);
    if (!Array.isArray(items) || items.length < 1 || items.length > this.maximumItems) {
      throw Object.assign(new Error(`A prepared concert must contain 1 to ${this.maximumItems} items`), { statusCode: 400 });
    }
    const normalized = items.map((item) => {
      const queueIndex = Number(item?.queueIndex);
      if (!Number.isSafeInteger(queueIndex) || queueIndex < 0) {
        throw Object.assign(new Error("Every prepared concert item needs a valid queue index"), { statusCode: 400 });
      }
      if (item?.kind === "music") {
        const fileId = Number(item.fileId);
        if (!Number.isSafeInteger(fileId) || fileId < 1) {
          throw Object.assign(new Error("Every prepared music item needs a valid file ID"), { statusCode: 400 });
        }
        return { kind: "music", queueIndex, fileId };
      }
      if (item?.kind === "narration") {
        return {
          kind: "narration",
          queueIndex,
          text: item.text,
          sourceNarrationId: item.sourceNarrationId == null ? null : String(item.sourceNarrationId),
        };
      }
      throw Object.assign(new Error("Prepared concert items must be music or narration"), { statusCode: 400 });
    });

    const prepared = new Array(normalized.length).fill(null);
    const narrationIndexes = normalized.flatMap((item, index) => item.kind === "narration" && volume > 0 ? [index] : []);
    let nextNarration = 0;
    let failedNarrationCount = 0;
    const workers = Array.from({ length: Math.min(this.narrationConcurrency, narrationIndexes.length) }, async () => {
      while (nextNarration < narrationIndexes.length) {
        const index = narrationIndexes[nextNarration];
        nextNarration += 1;
        const item = normalized[index];
        try {
          if (!item.sourceNarrationId || !this.narration.get(item.sourceNarrationId)) {
            failedNarrationCount += 1;
            continue;
          }
          const generated = await this.narration.createPrepared({
            text: item.text,
            volume,
            sourceNarrationId: item.sourceNarrationId,
            sourceOnly: true,
          });
          prepared[index] = { ...item, narrationId: generated.narrationId };
        } catch {
          failedNarrationCount += 1;
        }
      }
    });
    await Promise.all(workers);
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index].kind === "music") prepared[index] = normalized[index];
    }
    const playableItems = prepared.filter(Boolean);
    if (!playableItems.some((item) => item.kind === "music")) {
      for (const item of playableItems) if (item.narrationId) this.narration.remove(item.narrationId);
      throw Object.assign(new Error("A prepared concert must contain playable music"), { statusCode: 400 });
    }

    this.prune();
    const createdAtMs = this.now();
    const concert = {
      concertId: this.createId(),
      playbackToken: this.createToken(),
      voiceVolume: volume,
      failedNarrationCount,
      items: playableItems,
      preparedNarrationIds: playableItems.flatMap((item) => item.narrationId ? [item.narrationId] : []),
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    };
    this.concerts.set(concert.concertId, concert);
    this.prune();
    return publicConcert(concert);
  }

  get(concertId) {
    this.prune();
    return this.concerts.get(String(concertId)) ?? null;
  }

  playbackItem(concertId, index, token) {
    const concert = this.get(concertId);
    if (!concert || !sameSecret(token, concert.playbackToken)) return null;
    if (!Number.isSafeInteger(index) || index < 0 || index >= concert.items.length) return null;
    return concert.items[index];
  }

  discard(concertId) {
    this.prune();
    return this.removeConcert(concertId);
  }
}
