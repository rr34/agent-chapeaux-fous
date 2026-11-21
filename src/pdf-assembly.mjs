import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const maximumPdfPagePoints = 14_400;
const appendixPage = Object.freeze({ width: 612, height: 792, margin: 48 });

function inputError(message, statusCode = 400, code = "PDF_ASSEMBLY_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

function naturalParts(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en-US").split(/(\d+)/u).map((part) => (
    /^\d+$/u.test(part) ? { number: BigInt(part), text: part } : { number: null, text: part }
  ));
}

function compareNatural(left, right) {
  const leftParts = naturalParts(left);
  const rightParts = naturalParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (!leftParts[index]) return -1;
    if (!rightParts[index]) return 1;
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart.number !== null && rightPart.number !== null) {
      if (leftPart.number < rightPart.number) return -1;
      if (leftPart.number > rightPart.number) return 1;
      if (leftPart.text.length !== rightPart.text.length) return leftPart.text.length - rightPart.text.length;
      continue;
    }
    const compared = leftPart.text.localeCompare(rightPart.text, "en-US");
    if (compared) return compared;
  }
  return String(left).localeCompare(String(right), "en-US");
}

export function orderPdfSources(sources, order) {
  if (order === "provided") return [...sources];
  if (order === "filename") {
    return [...sources].sort((left, right) => (
      compareNatural(left.filename, right.filename) || left.fileId - right.fileId
    ));
  }
  if (order === "created_at") {
    return [...sources].sort((left, right) => (
      String(left.createdAtUtc ?? "").localeCompare(String(right.createdAtUtc ?? ""))
      || left.fileId - right.fileId
    ));
  }
  throw inputError("order must be provided, filename, or created_at");
}

function pdfMetadata(document, { title, subject }) {
  document.setTitle(title);
  document.setSubject(subject);
  document.setAuthor("Time v3 Agent");
  document.setCreator("Time v3 Agent");
  document.setProducer("Time v3 Agent PDF assembly");
  document.setCreationDate(new Date(0));
  document.setModificationDate(new Date(0));
}

export async function mergePdfBytes(sources, { title, maximumPages = 500 } = {}) {
  const output = await PDFDocument.create();
  pdfMetadata(output, { title, subject: `Combined from ${sources.length} source PDF files.` });
  let pageCount = 0;
  for (const source of sources) {
    let document;
    try {
      document = await PDFDocument.load(source.bytes);
    } catch (error) {
      throw inputError(
        `File ${source.fileId} (${source.filename}) is not a readable, unencrypted PDF.`,
        409,
        "SOURCE_PDF_INVALID",
      );
    }
    const sourcePages = document.getPageCount();
    if (sourcePages < 1) {
      throw inputError(`File ${source.fileId} (${source.filename}) has no pages.`, 409, "SOURCE_PDF_EMPTY");
    }
    pageCount += sourcePages;
    if (pageCount > maximumPages) {
      throw inputError(`Combined PDFs exceed the ${maximumPages}-page safety limit.`, 413, "PDF_PAGE_LIMIT");
    }
    const pages = await output.copyPages(document, document.getPageIndices());
    for (const page of pages) output.addPage(page);
  }
  return { bytes: Buffer.from(await output.save()), pageCount };
}

function jpegOrientation(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const start = offset + 2;
    if (marker === 0xe1 && length >= 14 && bytes.subarray(start, start + 6).toString("ascii") === "Exif\0\0") {
      const tiff = start + 6;
      const littleEndian = bytes.subarray(tiff, tiff + 2).toString("ascii") === "II";
      const read16 = (position) => littleEndian ? bytes.readUInt16LE(position) : bytes.readUInt16BE(position);
      const read32 = (position) => littleEndian ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position);
      if ((!littleEndian && bytes.subarray(tiff, tiff + 2).toString("ascii") !== "MM") || read16(tiff + 2) !== 42) return 1;
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const entries = read16(ifd);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) === 1) {
          const orientation = read16(entry + 8);
          return orientation >= 1 && orientation <= 8 ? orientation : 1;
        }
      }
      return 1;
    }
    offset += length;
  }
  return 1;
}

function rotationForOrientation(orientation) {
  if ([6, 7].includes(orientation)) return 90;
  if (orientation === 3 || orientation === 4) return 180;
  if ([5, 8].includes(orientation)) return 270;
  return 0;
}

function wrapText(text, font, size, maximumWidth) {
  const words = String(text).split(/\s+/u);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maximumWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function addSourceAppendix(document, sources, font, bold) {
  let page = null;
  let y = 0;
  const addPage = () => {
    page = document.addPage([appendixPage.width, appendixPage.height]);
    y = appendixPage.height - appendixPage.margin;
    page.drawText("Source images", { x: appendixPage.margin, y, size: 18, font: bold, color: rgb(0.18, 0.22, 0.16) });
    y -= 26;
    page.drawText("This PDF is derived from the following durable image files.", {
      x: appendixPage.margin, y, size: 9, font, color: rgb(0.35, 0.38, 0.33),
    });
    y -= 24;
  };
  addPage();
  for (const source of sources) {
    const heading = `Page ${source.pageNumber}: ${source.filename}`;
    const headingLines = wrapText(heading, bold, 9, appendixPage.width - appendixPage.margin * 2);
    const needed = headingLines.length * 12 + 32;
    if (y - needed < appendixPage.margin) addPage();
    for (const line of headingLines) {
      page.drawText(line, { x: appendixPage.margin, y, size: 9, font: bold });
      y -= 12;
    }
    page.drawText(`${source.width} × ${source.height} px · SHA-256 ${source.sha256}`, {
      x: appendixPage.margin, y, size: 6.8, font, color: rgb(0.35, 0.38, 0.33),
    });
    y -= 20;
  }
}

export async function imagesToPdfBytes(sources, { title } = {}) {
  const output = await PDFDocument.create();
  pdfMetadata(output, { title, subject: `Derived from ${sources.length} source image files.` });
  const rendered = [];
  for (const [index, source] of sources.entries()) {
    let image;
    try {
      image = source.mimeType === "image/jpeg"
        ? await output.embedJpg(source.bytes)
        : await output.embedPng(source.bytes);
    } catch (error) {
      throw inputError(
        `File ${source.fileId} (${source.filename}) is not a readable ${source.mimeType} image.`,
        409,
        "SOURCE_IMAGE_INVALID",
      );
    }
    const scale = Math.min(1, maximumPdfPagePoints / image.width, maximumPdfPagePoints / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = output.addPage([width, height]);
    const orientation = source.mimeType === "image/jpeg" ? jpegOrientation(source.bytes) : 1;
    const mirrored = [2, 4, 5, 7].includes(orientation);
    page.drawImage(image, { x: mirrored ? width : 0, y: 0, width: mirrored ? -width : width, height });
    const rotation = rotationForOrientation(orientation);
    if (rotation) page.setRotation(degrees(rotation));
    rendered.push({
      ...source,
      bytes: undefined,
      width: image.width,
      height: image.height,
      pageNumber: index + 1,
      rotation,
    });
  }
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  addSourceAppendix(output, rendered, font, bold);
  return {
    bytes: Buffer.from(await output.save()),
    pageCount: output.getPageCount(),
    imagePageCount: rendered.length,
  };
}
