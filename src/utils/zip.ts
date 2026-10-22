// Minimal ZIP writer.
//
// Store-only (no deflate): the payload is audio, which is already compressed,
// so compressing again costs CPU and saves nothing. Written by hand rather
// than pulling in a zip dependency for one feature.
//
// Entries are assembled as Blob parts, so the browser can spill large archives
// to disk instead of holding everything in JS memory.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP stores timestamps as MS-DOS date/time words. */
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** Strip characters that break archives or paths on extraction. */
export function safeEntryName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180)
    .trim();
}

export type ZipEntry = { name: string; data: Blob };

/**
 * Build a ZIP from the given entries.
 *
 * Names are de-duplicated by appending a counter, since a DJ library can
 * easily hold two files with the same name from different folders.
 */
export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(new Date());

  let offset = 0;
  const used = new Set<string>();

  for (const entry of entries) {
    let name = safeEntryName(entry.name) || "track";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem} (${n})${ext}`)) n += 1;
      name = `${stem} (${n})${ext}`;
    }
    used.add(name);

    const nameBytes = encoder.encode(name);
    const bytes = new Uint8Array(await entry.data.arrayBuffer());
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored, no compression
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    parts.push(local.buffer, nameBytes, bytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);

    const dirBytes = new Uint8Array(46 + nameBytes.length);
    dirBytes.set(new Uint8Array(dir.buffer), 0);
    dirBytes.set(nameBytes, 46);
    central.push(dirBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/** Hand a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
