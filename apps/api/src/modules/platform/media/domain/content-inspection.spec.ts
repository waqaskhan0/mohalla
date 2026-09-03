import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_IMAGE_TYPES,
  detectFileType,
  findExecutableSignature,
  inspect,
  inspectPdf,
  readImageDimensions,
} from './content-inspection.js';

/**
 * SEC-013 says type is determined by inspecting content, "never by trusting the
 * extension or the client-declared MIME type", and requires executable content
 * to be rejected from EVERY upload path. EDGE-014 is the concrete case: a ZIP
 * renamed `document.pdf` must be refused.
 *
 * These tests are written adversarially, because this is the one file in the
 * system that an attacker interacts with directly by choosing bytes.
 */

// ---- byte fixtures ---------------------------------------------------------
const bytes = (...v: number[]) => new Uint8Array(v);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A minimal but genuinely parseable PNG header with real dimensions. */
function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(24);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out.set(ascii('IHDR'), 12);
  new DataView(out.buffer).setUint32(16, width, false);
  new DataView(out.buffer).setUint32(20, height, false);
  return out;
}

/** A JPEG with an APP0 segment before the SOF0, so the walk has work to do. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = bytes(0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0);
  const sof0 = bytes(
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    ...[1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
  return concat(bytes(0xff, 0xd8), app0, sof0, bytes(0xff, 0xd9));
}

/** A lossy (VP8) WebP with dimensions in the frame header. */
function webp(width: number, height: number): Uint8Array {
  const out = new Uint8Array(32);
  out.set(ascii('RIFF'), 0);
  out.set(ascii('WEBP'), 8);
  out.set(ascii('VP8 '), 12);
  const view = new DataView(out.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return out;
}

/** A structurally plausible PDF with no active content. */
function pdf(body = ''): Uint8Array {
  return ascii(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${body}\nxref\n0 1\ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n`,
  );
}

describe('detectFileType — identification from bytes alone', () => {
  it('identifies the three accepted image formats', () => {
    expect(detectFileType(jpeg(10, 10))).toBe('image/jpeg');
    expect(detectFileType(png(10, 10))).toBe('image/png');
    expect(detectFileType(webp(10, 10))).toBe('image/webp');
  });

  it('identifies a PDF', () => {
    expect(detectFileType(pdf())).toBe('application/pdf');
  });

  it('RETURNS NULL FOR ANYTHING IT CANNOT POSITIVELY IDENTIFY', () => {
    // null is a rejection, never a "probably fine". An allow-list is the only
    // shape that fails safe when an unanticipated format arrives.
    expect(detectFileType(ascii('just some text'))).toBeNull();
    expect(detectFileType(bytes(0, 0, 0, 0))).toBeNull();
    expect(detectFileType(new Uint8Array(0))).toBeNull();
  });

  it('does not mistake other RIFF containers for WebP', () => {
    // 'RIFF' alone also starts WAV and AVI; the form type at offset 8 is what
    // distinguishes them.
    const wav = concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVE'));
    const avi = concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('AVI '));
    expect(detectFileType(wav)).toBeNull();
    expect(detectFileType(avi)).toBeNull();
  });

  it('REQUIRES THE PDF SIGNATURE AT OFFSET 0', () => {
    // The PDF spec tolerates leading junk. Accepting it would mean accepting a
    // file that is something ELSE first and a PDF second - the polyglot case.
    const leading = concat(ascii('GARBAGE'), pdf());
    expect(detectFileType(leading)).toBeNull();
  });

  it('lists exactly the accepted image types', () => {
    expect([...ACCEPTED_IMAGE_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('findExecutableSignature — the deny-list (SEC-013)', () => {
  it.each([
    ['Windows PE', bytes(0x4d, 0x5a, 0x90, 0x00), 'DOS_OR_WINDOWS_EXECUTABLE'],
    ['ELF', bytes(0x7f, 0x45, 0x4c, 0x46), 'ELF_EXECUTABLE'],
    ['Mach-O', bytes(0xfe, 0xed, 0xfa, 0xcf), 'MACH_O_EXECUTABLE'],
    ['Java class', bytes(0xca, 0xfe, 0xba, 0xbe), 'JAVA_CLASS'],
    ['Android dex', ascii('dex\n035\0'), 'ANDROID_DEX'],
    ['WebAssembly', bytes(0x00, 0x61, 0x73, 0x6d), 'WASM_MODULE'],
    ['ZIP', bytes(0x50, 0x4b, 0x03, 0x04), 'ARCHIVE'],
    ['gzip', bytes(0x1f, 0x8b, 0x08), 'ARCHIVE'],
    ['RAR', ascii('Rar!\x1a\x07'), 'ARCHIVE'],
    ['7z', bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c), 'ARCHIVE'],
    ['xz', bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00), 'ARCHIVE'],
    ['shell script', ascii('#!/bin/sh\necho hi'), 'SCRIPT_SHEBANG'],
  ])('rejects %s', (_label, input, expected) => {
    expect(findExecutableSignature(input)).toBe(expected);
  });

  it('passes a genuine image', () => {
    expect(findExecutableSignature(png(1, 1))).toBeNull();
    expect(findExecutableSignature(jpeg(1, 1))).toBeNull();
  });
});

describe('inspect — the gate every upload passes through', () => {
  it('accepts a real image and reports its dimensions', () => {
    const r = inspect(png(1600, 900));
    expect(r).toEqual({ ok: true, type: 'image/png', width: 1600, height: 900 });
  });

  it('REFUSES A ZIP RENAMED document.pdf (EDGE-014)', () => {
    // The name was never read. This is caught on the bytes.
    const zip = concat(bytes(0x50, 0x4b, 0x03, 0x04), ascii('PK stuff'));
    expect(inspect(zip, { allowPdf: true })).toEqual({
      ok: false,
      reason: 'EXECUTABLE_CONTENT',
    });
  });

  it('REFUSES A POLYGLOT that is a valid image AND an archive', () => {
    // This is why the deny-list is checked as WELL as the allow-list. An
    // allow-list returning on its first match would wave this through.
    const polyglot = concat(bytes(0x50, 0x4b, 0x03, 0x04), png(10, 10));
    expect(inspect(polyglot).ok).toBe(false);
  });

  it('refuses an empty file', () => {
    expect(inspect(new Uint8Array(0))).toEqual({ ok: false, reason: 'EMPTY_FILE' });
  });

  it('refuses an unrecognised type', () => {
    expect(inspect(ascii('hello, I am a text file'))).toEqual({
      ok: false,
      reason: 'UNRECOGNISED_TYPE',
    });
  });

  it('refuses an image whose header cannot be parsed', () => {
    // Claims PNG but is truncated before IHDR. Serving something no decoder
    // agrees about is where image-parser vulnerabilities live.
    const truncated = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
    expect(inspect(truncated)).toEqual({ ok: false, reason: 'IMAGE_DIMENSIONS_UNREADABLE' });
  });

  it('DEFAULTS TO REFUSING PDF (ADR-013 production gate)', () => {
    // ADR-013: "If no practical safe mechanism fits V1, CUT PDF ATTACHMENT
    // FROM V1 ... SEC-013 is not weakened to preserve a Should feature."
    // Enabling PDF is a recorded Technical Lead decision, not a default.
    expect(inspect(pdf())).toEqual({ ok: false, reason: 'TYPE_NOT_ALLOWED' });
  });

  it('accepts a clean PDF only when explicitly enabled', () => {
    expect(inspect(pdf(), { allowPdf: true })).toEqual({ ok: true, type: 'application/pdf' });
  });
});

describe('inspectPdf — structure and active content (ADR-013 §1–3)', () => {
  it('accepts a structurally plausible document', () => {
    expect(inspectPdf(pdf())).toBeNull();
  });

  it('REJECTS A TRUNCATED FILE — a parser failure is never a pass-through', () => {
    expect(inspectPdf(ascii('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n'))).toBe('PDF_MALFORMED');
  });

  it('rejects a file with no cross-reference structure', () => {
    expect(inspectPdf(ascii('%PDF-1.7\nnothing useful\n%%EOF\n'))).toBe('PDF_MALFORMED');
  });

  it('accepts a cross-reference STREAM as well as a classic xref', () => {
    const modern = ascii('%PDF-1.7\n5 0 obj\n<< /Type /XRef >>\nstream\nendstream\n%%EOF\n');
    expect(inspectPdf(modern)).toBeNull();
  });

  it.each([
    ['JavaScript', '<< /S /JavaScript /JS (app.alert\\(1\\)) >>'],
    ['a launch action', '<< /S /Launch /F (calc.exe) >>'],
    ['an embedded file', '<< /Type /EmbeddedFile >>'],
    ['an open action', '<< /OpenAction 2 0 R >>'],
    ['additional actions', '<< /AA << >> >>'],
    ['rich media', '<< /Subtype /RichMedia >>'],
    ['a remote go-to', '<< /S /GoToR /F (http://elsewhere) >>'],
    ['a form submission', '<< /S /SubmitForm >>'],
    ['embedded sound', '<< /Type /Sound >>'],
  ])('REJECTS %s', (_label, payload) => {
    expect(inspectPdf(pdf(payload))).toBe('PDF_ACTIVE_CONTENT');
  });

  it('REJECTS A NAME WITH HEX ESCAPES, rather than decoding it', () => {
    // `/J#61vaScript` is /JavaScript to a reader. Any #-escape inside a name
    // is treated as hostile, because no legitimate producer needs one here.
    expect(inspectPdf(pdf('<< /S /J#61vaScript >>'))).toBe('PDF_ACTIVE_CONTENT');
    expect(inspectPdf(pdf('<< /#4Aavascript 1 >>'))).toBe('PDF_ACTIVE_CONTENT');
  });
});

describe('readImageDimensions — measured, never declared (SEC-012)', () => {
  it('reads PNG dimensions', () => {
    expect(readImageDimensions(png(1600, 1200), 'image/png')).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it('reads JPEG dimensions past an intervening segment', () => {
    // JPEG has no fixed offset - the size lives in an SOFn marker whose
    // position depends on what precedes it.
    expect(readImageDimensions(jpeg(800, 600), 'image/jpeg')).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('reads lossy WebP dimensions', () => {
    expect(readImageDimensions(webp(640, 480), 'image/webp')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('returns null rather than guessing when the header is unusable', () => {
    expect(readImageDimensions(bytes(0x89, 0x50, 0x4e, 0x47), 'image/png')).toBeNull();
    expect(readImageDimensions(bytes(0xff, 0xd8, 0xff), 'image/jpeg')).toBeNull();
  });

  it('DOES NOT SPIN ON A MALFORMED JPEG SEGMENT LENGTH', () => {
    // A zero-length segment would not advance the walk. Bounded by the buffer
    // and by refusing to advance, so a crafted file cannot hang the worker.
    const hostile = concat(bytes(0xff, 0xd8), bytes(0xff, 0xe0, 0x00, 0x00), new Uint8Array(64));
    const start = Date.now();
    expect(readImageDimensions(hostile, 'image/jpeg')).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('survives a fuzz sweep without throwing', () => {
    // Any input that reaches here is attacker-chosen. An exception would
    // become a 500 and, worse, could leave a quarantine object unresolved.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    };
    for (let i = 0; i < 400; i += 1) {
      const len = 1 + (rand() % 64);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j += 1) buf[j] = rand();
      expect(() => inspect(buf, { allowPdf: true })).not.toThrow();
    }
  });
});
