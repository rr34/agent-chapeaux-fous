import { emptyMusicMetadata } from "./music-metadata.mjs";

function synchsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function uint32(bytes, offset) {
  return bytes.readUInt32BE(offset);
}

function trimmed(value) {
  return String(value ?? "").replaceAll("\u0000", "").trim() || null;
}

function decodeText(bytes) {
  if (!bytes.length) return null;
  const encoding = bytes[0];
  const contents = bytes.subarray(1);
  try {
    if (encoding === 0) return trimmed(new TextDecoder("windows-1252").decode(contents));
    if (encoding === 1) {
      if (contents[0] === 0xfe && contents[1] === 0xff) {
        return trimmed(new TextDecoder("utf-16be").decode(contents.subarray(2)));
      }
      if (contents[0] === 0xff && contents[1] === 0xfe) {
        return trimmed(new TextDecoder("utf-16le").decode(contents.subarray(2)));
      }
      return trimmed(new TextDecoder("utf-16le").decode(contents));
    }
    if (encoding === 2) return trimmed(new TextDecoder("utf-16be").decode(contents));
    return trimmed(new TextDecoder("utf-8").decode(contents));
  } catch {
    return null;
  }
}

function decodeId3v1(bytes) {
  if (bytes.length < 128 || bytes.subarray(bytes.length - 128, bytes.length - 125).toString("ascii") !== "TAG") return {};
  const tag = bytes.subarray(bytes.length - 128);
  const field = (start, length) => trimmed(new TextDecoder("windows-1252").decode(tag.subarray(start, start + length)));
  const trackByte = tag[126];
  return {
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    date: field(93, 4),
    track: tag[125] === 0 && trackByte > 0 ? String(trackByte) : null,
  };
}

function decodeId3v2(bytes) {
  if (bytes.length < 10 || bytes.subarray(0, 3).toString("ascii") !== "ID3") return {};
  const major = bytes[3];
  if (![3, 4].includes(major)) return {};
  const tagEnd = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  const values = {};
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = bytes.subarray(offset, offset + 4).toString("ascii");
    if (!/^[A-Z0-9]{4}$/u.test(id)) break;
    const size = major === 4 ? synchsafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!Number.isSafeInteger(size) || size <= 0 || offset + 10 + size > tagEnd) break;
    const contents = bytes.subarray(offset + 10, offset + 10 + size);
    if (id.startsWith("T") && id !== "TXXX") values[id] = decodeText(contents);
    offset += 10 + size;
  }
  return {
    title: values.TIT2,
    grouping: values.TIT1,
    album: values.TALB,
    artist: values.TPE1,
    albumArtist: values.TPE2,
    composer: values.TCOM,
    lyricist: values.TEXT,
    track: values.TRCK,
    disc: values.TPOS,
    genre: values.TCON,
    date: values.TDRC || values.TYER,
    duration: values.TLEN,
  };
}

function numbered(value) {
  const match = /^\s*(\d+)(?:\s*\/\s*(\d+))?/u.exec(String(value ?? ""));
  if (!match) return { number: null, count: null };
  return { number: Number(match[1]), count: match[2] ? Number(match[2]) : null };
}

function date(value) {
  const match = /\b(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/u.exec(String(value ?? ""));
  if (!match) return null;
  return [match[1], match[2], match[3]].filter(Boolean).join("-");
}

function unique(values) {
  const selected = values.map(trimmed).filter(Boolean);
  return selected.length ? [...new Set(selected)] : null;
}

const mpeg1Bitrates = {
  1: [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const mpeg2Bitrates = {
  1: [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

function mpegFrame(bytes, offset, end) {
  if (offset + 4 > end) return null;
  const header = bytes.readUInt32BE(offset);
  if ((header >>> 21) !== 0x7ff) return null;
  const versionBits = (header >>> 19) & 0x3;
  const layerBits = (header >>> 17) & 0x3;
  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const bitrateTable = version === 1 ? mpeg1Bitrates[layer] : mpeg2Bitrates[layer];
  const bitrate = bitrateTable?.[bitrateIndex - 1] * 1_000;
  const baseSampleRate = [44_100, 48_000, 32_000][sampleRateIndex];
  const sampleRate = version === 1 ? baseSampleRate : version === 2 ? baseSampleRate / 2 : baseSampleRate / 4;
  if (!bitrate || !sampleRate) return null;
  const padding = (header >>> 9) & 0x1;
  const frameLength = layer === 1
    ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
    : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * bitrate) / sampleRate) + padding;
  if (frameLength < 4 || offset + frameLength > end) return null;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1_152;
  return { frameLength, samples, sampleRate, signature: `${version}:${layer}:${sampleRate}` };
}

export function mp3DurationMs(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) return null;
  let start = 0;
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" && bytes.length >= 10) {
    start = Math.min(bytes.length, 10 + synchsafe(bytes, 6) + ((bytes[5] & 0x10) ? 10 : 0));
  }
  const end = bytes.length >= 128 && bytes.subarray(bytes.length - 128, bytes.length - 125).toString("ascii") === "TAG"
    ? bytes.length - 128
    : bytes.length;
  let offset = start;
  let signature = null;
  let seconds = 0;
  let frameCount = 0;
  while (offset + 4 <= end) {
    const frame = mpegFrame(bytes, offset, end);
    if (!frame || (signature && frame.signature !== signature)) {
      offset += 1;
      continue;
    }
    if (!signature) {
      const next = mpegFrame(bytes, offset + frame.frameLength, end);
      if (!next || next.signature !== frame.signature) {
        offset += 1;
        continue;
      }
      signature = frame.signature;
    }
    seconds += frame.samples / frame.sampleRate;
    frameCount += 1;
    offset += frame.frameLength;
  }
  return frameCount ? Math.round(seconds * 1_000) : null;
}

export function inspectMp3(bytes) {
  const v2 = decodeId3v2(bytes);
  const v1 = decodeId3v1(bytes);
  const tags = Object.fromEntries(Object.entries({ ...v1, ...Object.fromEntries(
    Object.entries(v2).filter(([, value]) => value != null),
  ) }).filter(([, value]) => value != null));
  const duration = mp3DurationMs(bytes);
  return { tags, durationMs: Number.isSafeInteger(duration) && duration >= 0 ? duration : null };
}

export function musicMetadataFromMp3Tags(tags = {}) {
  const metadata = emptyMusicMetadata();
  const track = numbered(tags.track);
  const disc = numbered(tags.disc);
  const creators = unique([
    tags.composer && `${tags.composer} — composer`,
    tags.lyricist && `${tags.lyricist} — lyricist`,
  ]);
  if (tags.album) {
    metadata.release = {
      type: "album",
      title: tags.album,
      version: null,
      discNumber: disc.number,
      discCount: disc.count,
      side: null,
      trackNumber: track.number,
      trackCount: track.count,
    };
    metadata.work = {
      type: null,
      title: tags.grouping ?? null,
      version: null,
      creators,
      catalogue: null,
    };
  } else {
    metadata.work = {
      type: tags.title ? "song" : null,
      title: tags.title ?? tags.grouping ?? null,
      version: null,
      creators,
      catalogue: null,
    };
  }
  metadata.performers = unique([tags.artist, tags.albumArtist]);
  metadata.genres = unique([tags.genre]);
  metadata.performanceDate = date(tags.date);
  return metadata;
}

export function mp3BytesMatch(bytes) {
  if (bytes.length < 4) return false;
  let offset = 0;
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" && bytes.length >= 10) {
    offset = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  }
  const end = Math.min(bytes.length - 1, offset + 8192);
  for (let index = offset; index < end; index += 1) {
    if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}
