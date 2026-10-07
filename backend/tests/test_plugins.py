import plistlib
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import plugins
from ablebackup.api.app import create_app


def _au(root: Path, file: str, full_name: str, kind: str = "aufx") -> Path:
    b = root / f"{file}.component" / "Contents"
    b.mkdir(parents=True)
    with (b / "Info.plist").open("wb") as fh:
        plistlib.dump({"AudioComponents": [{"name": full_name, "type": kind}]}, fh)
    return b.parent


def _vst3(root: Path, file: str, vendor: str | None = None, sub: str = "Fx") -> Path:
    b = root / f"{file}.vst3"
    (b / "Contents" / "Resources").mkdir(parents=True)
    if vendor:
        (b / "Contents" / "Resources" / "moduleinfo.json").write_text(
            '{"Factory Info": {"Vendor": "%s",}, "Classes": [{"Sub Categories": ["%s"],}],}' % (vendor, sub))
    return b


def test_finds_each_format_and_joins_the_same_plugin(tmp_path):
    vst3, comps, clap, vst2 = (tmp_path / n for n in ("VST3", "Components", "CLAP", "VST2"))
    for d in (vst3, comps, clap, vst2):
        d.mkdir()
    _vst3(vst3, "Serum", "Xfer Records", "Instrument|Synth")
    _au(comps, "Serum", "Xfer Records: Serum", "aumu")
    (clap / "Serum.clap").write_bytes(b"x")
    (vst2 / "Serum_x64.dll").write_bytes(b"x")
    _vst3(vst3 / "FabFilter", "FabFilter Pro-Q 3")       # no description: maker from its folder
    _au(comps, "Pro-Q 3", "FabFilter: Pro-Q 3")           # the AU's file name has no maker in it
    (vst3 / "readme.txt").write_text("not a plug-in")

    found = plugins.scan(folders=[vst3, comps, clap, vst2, tmp_path / "nope"])
    rows = {r["name"]: r for r in found["plugins"]}
    assert set(rows) == {"Serum", "Pro-Q 3"}
    assert rows["Serum"]["formats"] == ["VST3", "AU", "CLAP", "VST2"]
    assert rows["Serum"]["maker"] == "Xfer Records"
    assert rows["Serum"]["kind"] == "Instrument"
    assert rows["Pro-Q 3"]["formats"] == ["VST3", "AU"]
    assert rows["Pro-Q 3"]["maker"] == "FabFilter"
    assert rows["Pro-Q 3"]["kind"] == "Effect"
    # only folders that exist are listed (the missing standard one is left out)
    assert [f["count"] for f in found["folders"]] == [2, 2, 1, 1]


def test_does_not_look_inside_a_plugin_bundle(tmp_path):
    b = _vst3(tmp_path, "Vital")
    inner = b / "Contents" / "x86_64-win"
    inner.mkdir(parents=True)
    (inner / "Vital.vst3").write_bytes(b"x")  # Windows bundles hold a file of the same name
    found = plugins.scan(folders=[tmp_path])
    assert [r["name"] for r in found["plugins"]] == ["Vital"]
    assert len(found["plugins"][0]["places"]) == 1


def test_your_own_folders_are_listed_even_when_missing(tmp_path):
    mine = tmp_path / "Mine"
    mine.mkdir()
    (mine / "OTT.vst3").mkdir()
    found = plugins.scan([str(mine), str(tmp_path / "gone")], folders=[])
    assert [r["name"] for r in found["plugins"]] == ["OTT"]
    assert [(f["yours"], f["exists"]) for f in found["folders"]] == [(True, True), (True, False)]


def test_standard_folders_per_computer(tmp_path):
    win = plugins.standard_folders("Windows", {"CommonProgramFiles": r"C:\CF", "ProgramFiles": r"C:\PF"}, tmp_path)
    assert any(str(p).endswith("VST3") for p in win)
    mac = plugins.standard_folders("Darwin", {}, tmp_path)
    assert Path("/Library/Audio/Plug-Ins/Components") in mac
    assert tmp_path / "Library" / "Audio" / "Plug-Ins" / "VST3" in mac
    lin = plugins.standard_folders("Linux", {}, tmp_path)
    assert tmp_path / ".vst3" in lin and tmp_path / ".lv2" in lin


def test_used_in_matches_names_with_and_without_the_maker():
    rows = [{"id": plugins.key("Serum"), "name": "Serum", "maker": "Xfer Records"},
            {"id": plugins.key("FabFilter Pro-Q 3"), "name": "FabFilter Pro-Q 3", "maker": "FabFilter"},
            {"id": plugins.key("Diva"), "name": "Diva", "maker": "u-he"}]
    projects = [{"name": "Night Drive", "plugins": ["Serum (Xfer Records)", "Pro-Q 3"]},
                {"name": "Acid Test", "plugins": ["Serum", "Serum"]},
                {"name": "Empty", "plugins": []}]
    plugins.used_in(rows, projects)
    assert [r["used_in"] for r in rows] == [2, 1, 0]
    assert rows[0]["used_by"] == ["Acid Test", "Night Drive"]


def test_key_ignores_case_bits_and_maker():
    assert plugins.key("Serum (Xfer Records)") == plugins.key("serum") == plugins.key("Serum_x64")


def test_api_lists_and_keeps_the_last_look(tmp_path, monkeypatch):
    plug = tmp_path / "plug"
    plug.mkdir()
    (plug / "Vital.vst3").mkdir()
    monkeypatch.setattr(plugins, "standard_folders", lambda: [])
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    r = c.put("/api/plugins/folders", json={"folders": [str(plug), str(plug), " "]})
    assert r.status_code == 200
    assert [p["name"] for p in r.json()["plugins"]] == ["Vital"]
    (plug / "Diva.vst3").mkdir()
    assert [p["name"] for p in c.get("/api/plugins").json()["plugins"]] == ["Vital"]  # kept
    assert [p["name"] for p in c.get("/api/plugins?refresh=true").json()["plugins"]] == ["Diva", "Vital"]
    assert c.get("/api/plugins").json()["folders"][0]["path"] == str(plug)
