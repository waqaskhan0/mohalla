/**
 * CONTENT INSPECTION (SEC-013 · MEDIA-FR-005 · EDGE-014 · ADR-013 step 4).
 *
 * The requirement is unusually blunt, and worth restating because it is the
 * whole reason this file exists:
 *
 *   > file type is determined by **inspecting content**, never by trusting the
 *   > extension or the client-declared MIME type
 *
 * EDGE-014 makes it concrete: a ZIP renamed `document.pdf` must be refused. So
 * nothing here ever reads a filename or a `Content-Type` header. The only input
 * is bytes.
 *
 * TWO SEPARATE JOBS, deliberately not merged.
 *
 *   `detectFileType` answers "what IS this?" — a positive identification from
 *   magic bytes. Anything unrecognised is `null`, and `null` is a rejection.
 *
 *   `findExecutableSignature` answers "is this something that runs?" — an
 *   explicit deny-list checked SEPARATELY, because allow-listing alone has a
 *   subtle hole: a polyglot file can be a valid JPEG *and* a valid archive, and
 *   an allow-list that stops at the first match would wave it through.
 *
 * The allow-list is the primary control and the deny-list is defence in depth.
 * Both must pass.
 */

export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** What the platform accepts, by requirement (SRS §12). */
export const ACCEPTED_IMAGE_TYPES: readonly DetectedType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0): boolean => {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
};

const asciiAt = (bytes: Uint8Array, offset: number, text: string): boolean =>
  startsWith(
    bytes,
    [...text].map((ch) => ch.charCodeAt(0)),
    offset,
  );

/**
 * Identify a file from its leading bytes.
 *
 * @returns the type, or `null` for anything not positively identified. `null`
 * is a rejection, never a "probably fine" — an allow-list is the only shape
 * that fails safe when a format nobody anticipated arrives.
 */
export function detectFileType(bytes: Uint8Array): DetectedType | null {
  // JPEG: FF D8 FF. The third byte varies by marker, so only three are fixed.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: the 8-byte signature, which deliberately includes CRLF and EOF bytes
  // so a corrupted text-mode transfer is detectable.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP: a RIFF container whose form type is 'WEBP' at offset 8. Checking
  // only 'RIFF' would also match WAV and AVI.
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp';

  // PDF: '%PDF-'. The spec permits leading junk, but accepting it would mean
  // accepting a file that is something else FIRST and a PDF second - exactly
  // the polyglot case. Required at offset 0.
  if (asciiAt(bytes, 0, '%PDF-')) return 'application/pdf';

  return null;
}

export type ExecutableSignature =
  | 'DOS_OR_WINDOWS_EXECUTABLE'
  | 'ELF_EXECUTABLE'
  | 'MACH_O_EXECUTABLE'
  | 'JAVA_CLASS'
  | 'ARCHIVE'
  | 'SCRIPT_SHEBANG'
  | 'ANDROID_DEX'
  | 'WASM_MODULE';

/**
 * Look for anything that executes, independently of what the file claims to be.
 *
 * Checked as WELL as the allow-list, not instead of it. A polyglot file can
 * satisfy two format signatures at once; an allow-list that returns on its
 * first match would accept it, and a deny-list alone would miss every format
 * nobody thought to list. Requiring both to pass closes each other's gap.
 *
 * @returns the signature found, or `null` when nothing executable was seen.
 */
export function findExecutableSignature(bytes: Uint8Array): ExecutableSignature | null {
  // MZ - DOS/Windows PE.
  if (startsWith(bytes, [0x4d, 0x5a])) return 'DOS_OR_WINDOWS_EXECUTABLE';

  // 0x7F 'ELF'.
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'ELF_EXECUTABLE';

  // Mach-O, all four byte orders and the fat/universal header. CAFEBABE is
  // shared with Java class files, which the next check separates.
  for (const sig of [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
  ]) {
    if (startsWith(bytes, sig)) return 'MACH_O_EXECUTABLE';
  }
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return 'JAVA_CLASS';

  // dex - Android bytecode.
  if (asciiAt(bytes, 0, 'dex\n')) return 'ANDROID_DEX';

  // WebAssembly: 00 'asm'.
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return 'WASM_MODULE';

  // ZIP and friends. Refused as a category rather than inspected, because a
  // ZIP can contain anything and this platform has no feature that needs one.
  // This is what catches EDGE-014's ZIP-renamed-to-.pdf, and it catches it on
  // the CONTENT even though the name was never read.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]) ||
    startsWith(bytes, [0x1f, 0x8b]) || // gzip
    asciiAt(bytes, 0, 'Rar!') ||
    startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a]) || // xz
    startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) // 7z
  ) {
    return 'ARCHIVE';
  }

  // '#!' - a script with an interpreter line.
  if (startsWith(bytes, [0x23, 0x21])) return 'SCRIPT_SHEBANG';

  return null;
}

export type InspectionResult =
  | { ok: true; type: DetectedType; width?: number; height?: number }
  | { ok: false; reason: InspectionRejection };

export type InspectionRejection =
  | 'EMPTY_FILE'
  | 'UNRECOGNISED_TYPE'
  | 'EXECUTABLE_CONTENT'
  | 'TYPE_NOT_ALLOWED'
  | 'IMAGE_DIMENSIONS_UNREADABLE'
  | 'PDF_MALFORMED'
  | 'PDF_ACTIVE_CONTENT';

export interface InspectionOptions {
  /**
   * Whether PDF is accepted at all.
   *
   * ADR-013 gates PDF behind Technical Lead approval of the inspection
   * capability, and says plainly: "If no practical safe mechanism fits V1, CUT
   * PDF ATTACHMENT FROM V1 … SEC-013 is not weakened to preserve a Should
   * feature." So this DEFAULTS TO FALSE. Enabling it is a recorded decision,
   * not a default someone inherits.
   */
  allowPdf?: boolean;
}

/**
 * Inspect a file and decide whether it may be stored.
 *
 * Order matters: the executable check runs BEFORE the type is trusted, so a
 * file that is both a valid image and an executable is refused rather than
 * accepted on the strength of its image half.
 */
export function inspect(bytes: Uint8Array, options: InspectionOptions = {}): InspectionResult {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY_FILE' };

  const executable = findExecutableSignature(bytes);
  if (executable !== null) return { ok: false, reason: 'EXECUTABLE_CONTENT' };

  const type = detectFileType(bytes);
  if (type === null) return { ok: false, reason: 'UNRECOGNISED_TYPE' };

  if (type === 'application/pdf') {
    if (options.allowPdf !== true) return { ok: false, reason: 'TYPE_NOT_ALLOWED' };
    const pdf = inspectPdf(bytes);
    return pdf === null ? { ok: true, type } : { ok: false, reason: pdf };
  }

  const dimensions = readImageDimensions(bytes, type);
  if (dimensions === null) {
    // A file that identifies as an image but whose header cannot be parsed is
    // malformed. Storing it would mean serving something no decoder agrees
    // about, which is where image-parser vulnerabilities live.
    return { ok: false, reason: 'IMAGE_DIMENSIONS_UNREADABLE' };
  }

  return { ok: true, type, width: dimensions.width, height: dimensions.height };
}

/**
 * PDF structural validation and active-content rejection (ADR-013 §1–3).
 *
 * NOT A FULL PARSER, and this is stated plainly rather than implied: it checks
 * that the file is structurally plausible and refuses documents containing
 * detectable active content. ADR-013's production gate exists precisely because
 * "a file is not safe merely because it begins with a valid PDF signature", and
 * clearing that gate is a Technical Lead decision about a chosen sanitisation
 * capability — not something this function can claim to satisfy on its own.
 *
 * @returns `null` when nothing objectionable was found, or the rejection.
 */
export function inspectPdf(bytes: Uint8Array): InspectionRejection | null {
  // A well-formed PDF ends with %%EOF, possibly followed by whitespace. Its
  // absence means truncated or malformed, and ADR-013 §2 says a parser failure
  // is a rejection, never a pass-through.
  const tailStart = Math.max(0, bytes.length - 2048);
  const tail = latin1(bytes.subarray(tailStart));
  if (!tail.includes('%%EOF')) return 'PDF_MALFORMED';

  // The cross-reference structure must be present in some form: classic
  // `xref` + `trailer`, or a cross-reference stream (`/Type /XRef`).
  const whole = latin1(bytes);
  const hasClassicXref = /\bxref\b/.test(whole) && /\btrailer\b/.test(whole);
  const hasXrefStream = /\/Type\s*\/XRef\b/.test(whole);
  if (!hasClassicXref && !hasXrefStream) return 'PDF_MALFORMED';

  // Active content. Matched on the PDF name tokens, which are what a reader
  // actually acts on.
  //
  // NOTE ON THE LIMIT OF THIS: names can be written with #-escapes (`/J#61vaScript`)
  // and objects can be inside compressed streams, so a determined attacker can
  // hide from a scan like this one. That is exactly why ADR-013 requires a
  // real sanitisation capability before PDF ships, and why `allowPdf` defaults
  // to false. This raises the floor; it is not the gate.
  const active = [
    /\/JavaScript\b/,
    /\/JS\b/,
    /\/Launch\b/,
    /\/EmbeddedFile\b/,
    /\/OpenAction\b/,
    /\/AA\b/, // additional-actions dictionary
    /\/RichMedia\b/,
    /\/Movie\b/,
    /\/Sound\b/,
    /\/GoToR\b/, // remote go-to: fetches another document
    /\/SubmitForm\b/,
    /\/ImportData\b/,
  ];
  for (const pattern of active) {
    if (pattern.test(whole)) return 'PDF_ACTIVE_CONTENT';
  }

  // An escaped name is a deliberate attempt to hide one of the above. Any
  // `#xx` escape inside a name is treated as hostile rather than decoded,
  // because no legitimate producer needs one here.
  if (/\/[A-Za-z]*#[0-9A-Fa-f]{2}/.test(whole)) return 'PDF_ACTIVE_CONTENT';

  return null;
}

/**
 * Read an image's real dimensions from its header.
 *
 * Server-side, because the values declared at slot request are advisory
 * (ADR-013: "The worker re-measures the actual object and rejects on
 * mismatch"). A client that lies about dimensions is either broken or probing.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  type: DetectedType,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (type === 'image/png') {
    // IHDR is always the first chunk: width and height are big-endian at 16/20.
    if (bytes.length < 24) return null;
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  if (type === 'image/webp') {
    // Three sub-formats, each storing dimensions differently.
    if (asciiAt(bytes, 12, 'VP8X') && bytes.length >= 30) {
      const w = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
      const h = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
      return { width: w, height: h };
    }
    if (asciiAt(bytes, 12, 'VP8L') && bytes.length >= 25) {
      const b = view.getUint32(21, true);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (asciiAt(bytes, 12, 'VP8 ') && bytes.length >= 30) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    return null;
  }

  if (type === 'image/jpeg') return readJpegDimensions(bytes);
  return null;
}

/**
 * Walk JPEG segments to the frame header.
 *
 * JPEG has no fixed dimension offset — the size lives in an SOFn marker whose
 * position depends on how many other segments precede it. The walk is bounded
 * by the buffer and refuses to advance on a malformed length, so a crafted file
 * cannot spin here.
 */
function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2; // past SOI
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1; // resync over fill bytes rather than trusting the stream
      continue;
    }
    const marker = bytes[i + 1] ?? 0;

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // SOS - entropy-coded data begins; no frame header will follow.
    if (marker === 0xda) return null;

    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2) return null; // malformed: would not advance

    // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      if (i + 9 >= bytes.length) return null;
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    i += 2 + length;
  }
  return null;
}

/** Bytes as latin-1, so every byte maps to one character and offsets are stable. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}
