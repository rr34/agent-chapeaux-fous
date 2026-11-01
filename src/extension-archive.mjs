import fs from "node:fs/promises";
import path from "node:path";

const maximumArchiveBytes = 5 * 1024 * 1024;
const maximumArchiveFiles = 100;
const utf8Flag = 0x0800;
const storedMethod = 0;
const dosTime = 0;
const dosDate = (44 << 9) | (1 << 5) | 1; // 2024-01-01, stable for reproducible downloads.

const crcTable = new Uint32Array(256);
for (let value = 0; value < crcTable.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  crcTable[value] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function extensionFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const filename = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("The extension package cannot contain symbolic links.");
    if (entry.isDirectory()) files.push(...await extensionFiles(root, filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

function localHeader({ name, body, checksum }) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(utf8Flag, 6);
  header.writeUInt16LE(storedMethod, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(body.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, body]);
}

function centralHeader({ name, body, checksum, offset }) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(utf8Flag, 8);
  header.writeUInt16LE(storedMethod, 10);
  header.writeUInt16LE(dosTime, 12);
  header.writeUInt16LE(dosDate, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(body.length, 20);
  header.writeUInt32LE(body.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

export async function createExtensionArchive({ extensionRoot, archiveRoot, virtualFiles = {} }) {
  const filenames = await extensionFiles(extensionRoot);
  if (!filenames.length || filenames.length > maximumArchiveFiles) {
    throw new Error(`The extension package must contain 1 through ${maximumArchiveFiles} files.`);
  }
  const entries = [];
  let totalBytes = 0;
  for (const filename of filenames) {
    const relative = path.relative(extensionRoot, filename).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || relative.includes("/../")) {
      throw new Error("The extension package contains an invalid path.");
    }
    const body = Object.hasOwn(virtualFiles, relative)
      ? Buffer.from(String(virtualFiles[relative]), "utf8")
      : await fs.readFile(filename);
    totalBytes += body.length;
    if (totalBytes > maximumArchiveBytes) throw new Error("The extension package exceeds 5 MiB.");
    entries.push({ name: `${archiveRoot}/${relative}`, body, checksum: crc32(body) });
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const local = localHeader(entry);
    localParts.push(local);
    centralParts.push(centralHeader({ ...entry, offset }));
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

export function createGoogleMessagesExtensionArchive(repositoryRoot, { serverUrl = "http://127.0.0.1:8787" } = {}) {
  const origin = new URL(serverUrl).origin;
  return createExtensionArchive({
    extensionRoot: path.join(repositoryRoot, "extensions", "google-messages-sync"),
    archiveRoot: "time-v3-google-messages-sync",
    virtualFiles: {
      "connection.json": `${JSON.stringify({ serverUrl: origin, accountKey: "default" }, null, 2)}\n`,
    },
  });
}
