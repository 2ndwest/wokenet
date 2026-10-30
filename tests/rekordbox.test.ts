import { describe, expect, test } from "vitest";
import { buildRekordboxXml } from "../src/utils/rekordbox";

const locations = (xml: string) => [...xml.matchAll(/Location="([^"]*)"/g)].map((m) => m[1]);

describe("buildRekordboxXml", () => {
  test("points tracks at the folder it's given", () => {
    const xml = buildRekordboxXml([{ title: "A", filename: "a b.mp3" }], [], "/Users/nico/Music/wokenet/");
    expect(locations(xml)).toEqual(["file://localhost/Users/nico/Music/wokenet/a%20b.mp3"]);
  });

  test("turns a Windows folder into a file URL", () => {
    const xml = buildRekordboxXml([{ title: "A", filename: "a.mp3" }], [], "C:/Users/dj/Music");
    expect(locations(xml)).toEqual(["file://localhost/C:/Users/dj/Music/a.mp3"]);
  });

  test("never writes a bare & or # into a Location", () => {
    // A raw & isn't valid XML; rekordbox stops reading the file at the first one.
    const xml = buildRekordboxXml([{ title: "On & On", filename: "On & On #1.mp3" }], [], "/m");
    expect(locations(xml)).toEqual(["file://localhost/m/On%20%26%20On%20%231.mp3"]);
    expect(xml).toContain('Name="On &amp; On"');
  });

  test("writes playlists by TrackID, dropping empty ones", () => {
    const xml = buildRekordboxXml(
      [
        { title: "A", filename: "a.mp3" },
        { title: "B", filename: "b.mp3" },
      ],
      [
        { name: "Gigs & stuff", entries: [1, 0] },
        { name: "nothing here", entries: [] },
      ],
    );
    expect(xml).toContain(
      '<NODE Type="1" Name="Gigs &amp; stuff" KeyType="0" Entries="2">\n' +
        '        <TRACK Key="2"/>\n' +
        '        <TRACK Key="1"/>\n' +
        "      </NODE>",
    );
    expect(xml).toContain('<NODE Type="0" Name="ROOT" Count="1">');
    expect(xml).not.toContain("nothing here");
  });

  test("puts flattened folder names back into folders", () => {
    const xml = buildRekordboxXml(
      [{ title: "A", filename: "a.mp3" }],
      [
        { name: "Gigs / Halloween", entries: [0] },
        { name: "Gigs / NYE", entries: [0] },
        { name: "loose", entries: [0] },
      ],
    );
    const tree = xml.slice(xml.indexOf("<PLAYLISTS>"));
    expect(tree.replace(/\n\s*<TRACK Key="1"\/>/g, "").replace(/\s+/g, " ")).toBe(
      '<PLAYLISTS> <NODE Type="0" Name="ROOT" Count="2"> ' +
        '<NODE Type="0" Name="Gigs" Count="2"> ' +
        '<NODE Type="1" Name="Halloween" KeyType="0" Entries="1"> </NODE> ' +
        '<NODE Type="1" Name="NYE" KeyType="0" Entries="1"> </NODE> ' +
        "</NODE> " +
        '<NODE Type="1" Name="loose" KeyType="0" Entries="1"> </NODE> ' +
        "</NODE> </PLAYLISTS> </DJ_PLAYLISTS> ",
    );
  });

  test("leaves PLAYLISTS out when there are none", () => {
    const xml = buildRekordboxXml([{ title: "A", filename: "a.mp3" }]);
    expect(xml).not.toContain("<PLAYLISTS>");
  });
});
