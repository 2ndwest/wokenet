import { describe, expect, it } from "vitest";
import { buildZip, safeEntryName } from "../src/utils/zip";

/** Read a little-endian uint32 out of a buffer. */
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

describe("safeEntryName", () => {
  it("strips characters that break paths on extraction", () => {
    expect(safeEntryName("a/b:c*d?.mp3")).toBe("a_b_c_d_.mp3");
    expect(safeEntryName("../../etc/passwd")).toBe("_.._etc_passwd");
  });
});

describe("buildZip", () => {
  it("produces a well-formed archive", async () => {
    const zip = await buildZip([
      { name: "one.txt", data: new Blob(["hello"]) },
      { name: "two.txt", data: new Blob(["world"]) },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());

    // Local file header signature at the start.
    expect(u32(bytes, 0)).toBe(0x04034b50);
    // End-of-central-directory signature in the last 22 bytes.
    expect(u32(bytes, bytes.length - 22)).toBe(0x06054b50);
    // Two entries recorded.
    expect(bytes[bytes.length - 14] | (bytes[bytes.length - 13] << 8)).toBe(2);
  });

  it("computes CRC32 correctly", async () => {
    // The standard CRC32 check value for "123456789" is 0xCBF43926.
    const zip = await buildZip([{ name: "x", data: new Blob(["123456789"]) }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(u32(bytes, 14)).toBe(0xcbf43926);
  });

  it("de-duplicates repeated filenames", async () => {
    const zip = await buildZip([
      { name: "same.mp3", data: new Blob(["a"]) },
      { name: "same.mp3", data: new Blob(["b"]) },
      { name: "same.mp3", data: new Blob(["c"]) },
    ]);
    const text = new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()));
    expect(text).toContain("same.mp3");
    expect(text).toContain("same (2).mp3");
    expect(text).toContain("same (3).mp3");
  });

  it("handles an empty archive", async () => {
    const zip = await buildZip([]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(bytes.length).toBe(22);
    expect(u32(bytes, 0)).toBe(0x06054b50);
  });
});
