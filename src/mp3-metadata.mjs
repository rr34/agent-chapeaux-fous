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

export function inspectMp3(bytes) {
  const v2 = decodeId3v2(bytes);
  const v1 = decodeId3v1(bytes);
  const tags = Object.fromEntries(Object.entries({ ...v1, ...Object.fromEntries(
    Object.entries(v2).filter(([, value]) => value != null),
  ) }).filter(([, value]) => value != null));
  const duration = Number.parseInt(String(tags.duration ?? ""), 10);
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
    metadata.work = {
      type: "album",
      title: tags.album,
      version: null,
      creators,
      catalogue: null,
    };
    if (disc.number != null) {
      metadata.sequence1 = { type: "disc", number: disc.number, count: disc.count, title: null };
      metadata.sequence2 = {
        type: "track", number: track.number, count: track.count, title: tags.title ?? null,
      };
    } else {
      metadata.sequence1 = {
        type: "track", number: track.number, count: track.count, title: tags.title ?? null,
      };
    }
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
