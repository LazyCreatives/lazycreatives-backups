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


def test_missing_lists_plugins_not_on_this_computer():
    have = [{"id": plugins.key("Pro-Q 3"), "name": "Pro-Q 3", "maker": "FabFilter"},
            {"id": plugins.key("Serum"), "name": "Serum", "maker": "Xfer Records"}]
    projects = [
        {"name": "Night", "daw": "ableton", "plugins": ["FabFilter Pro-Q 3", "Diva", "Serum (Xfer Records)"]},
        {"name": "Day", "daw": "flstudio", "plugins": ["Fruity Limiter", "Sytrus", "Diva", "Kickstart 2"]},
        {"name": "Dusk", "daw": "reaper", "plugins": ["ReaEQ (Cockos)", "JS: 1175 Compressor", "Valhalla Room"]},
    ]
    rows = plugins.missing(have, projects)
    assert [(r["name"], r["used_in"], r["used_by"]) for r in rows] == [
        ("Diva", 2, ["Day", "Night"]), ("Kickstart 2", 1, ["Day"]), ("Valhalla Room", 1, ["Dusk"])]


def _bundle_with_code(root: Path, file: str, sub: str, text: bytes) -> Path:
    """A plug-in bundle whose code file has ``text`` in it (no description file)."""
    b = root / file
    (b / "Contents" / sub).mkdir(parents=True)
    (b / "Contents" / sub / Path(file).stem).write_bytes(b"\0junk\0Fx\0" + text + b"\0more\0")
    return b


def test_type_comes_from_the_text_inside_vst3_and_clap_files(tmp_path):
    no_daws = {"paths": {}, "names": {}}
    _bundle_with_code(tmp_path, "Diva.vst3", "MacOS", b"Instrument|Synth")
    _bundle_with_code(tmp_path, "Valhalla Room.vst3", "x86_64-win", b"Fx|Reverb")
    _bundle_with_code(tmp_path, "Plain.vst3", "x86_64-linux", b"nothing")  # only "Fx", no "Instrument": an effect
    _bundle_with_code(tmp_path, "Pigments.clap", "MacOS", b"instrument\0synthesizer")
    (tmp_path / "Surge XT Effects.clap").write_bytes(b"\0audio-effect\0delay\0")   # Windows / Linux: one file
    (tmp_path / "Mystery.clap").write_bytes(b"\0nothing here\0")
    found = plugins.scan(folders=[tmp_path], daws=no_daws)
    kinds = {r["name"]: r["kind"] for r in found["plugins"]}
    assert kinds == {"Diva": "Instrument", "Valhalla Room": "Effect", "Plain": "Effect",
                     "Pigments": "Instrument", "Surge XT Effects": "Effect", "Mystery": ""}
    # the next look doesn't read files that haven't changed
    seen = []
    real = plugins.kind_from_file
    try:
        plugins.kind_from_file = lambda f, fmt: seen.append(f) or real(f, fmt)
        again = plugins.scan(folders=[tmp_path], daws=no_daws, kind_cache=found["kind_cache"])
    finally:
        plugins.kind_from_file = real
    assert seen == [] and {r["name"]: r["kind"] for r in again["plugins"]} == kinds


def test_a_plugins_own_description_beats_the_text_in_its_file(tmp_path):
    vst3, comps = tmp_path / "VST3", tmp_path / "Components"
    comps.mkdir()
    _bundle_with_code(vst3, "Vocoder.vst3", "MacOS", b"Instrument|Synth")
    _au(comps, "Vocoder", "Maker: Vocoder", "aufx")
    found = plugins.scan(folders=[vst3, comps], daws={"paths": {}, "names": {}})
    assert [(r["name"], r["kind"]) for r in found["plugins"]] == [("Vocoder", "Effect")]


def test_audio_unit_types_and_bundles_holding_more_than_one(tmp_path):
    b = tmp_path / "Kontakt.component" / "Contents"
    b.mkdir(parents=True)
    with (b / "Info.plist").open("wb") as fh:
        plistlib.dump({"AudioComponents": [{"name": "NI: Kontakt", "type": "????"},
                                           {"name": "NI: Kontakt", "type": "aumu"}]}, fh)
    _au(tmp_path, "Arp", "Maker: Arp", "aumi")
    _au(tmp_path, "Tone", "Maker: Tone", "augn")
    found = plugins.scan(folders=[tmp_path], daws={"paths": {}, "names": {}})
    assert {r["name"]: r["kind"] for r in found["plugins"]} == {"Kontakt": "Instrument", "Arp": "Effect", "Tone": "Instrument"}


def test_what_fl_studio_and_reaper_say(tmp_path):
    home = tmp_path / "home"
    db = home / "Documents" / "Image-Line" / "FL Studio" / "Presets" / "Plugin database" / "Installed"
    (db / "Generators" / "VST").mkdir(parents=True)
    (db / "Effects" / "VST3").mkdir(parents=True)
    (db / "Generators" / "VST" / "Sylenth1.nfo").write_text("ps_file_filename_0=C:\\VST\\Sylenth1.dll\n")
    (db / "Effects" / "VST3" / "OTT.fst").write_bytes(b"x")
    rp = home / "Library" / "Application Support" / "REAPER"
    rp.mkdir(parents=True)
    (rp / "reaper-vstplugins_arm64.ini").write_text(
        "[vstcache]\nSerum.vst3=00,{AB},Serum (Xfer Records)!!!VSTi\nFabFilter_Pro-Q_3.vst3=00,{CD},Pro-Q 3 (FabFilter)\n"
        "WaveShell1-VST3.vst3=00,{EF},<SHELL>\n")
    (rp / "reaper-auplugins_arm64.ini").write_text("[auplugins]\nArturia: Pigments=<inst>\nValhalla DSP: Supermassive=<!inst>\n")
    lists = plugins.daw_lists("Darwin", {}, home)
    assert lists["names"]["sylenth1"] == "Instrument" and lists["names"]["ott"] == "Effect"
    assert lists["paths"][__import__("os").path.normcase("C:\\VST\\Sylenth1.dll")] == "Instrument"
    assert lists["names"]["serum"] == "Instrument" and lists["names"]["fabfilterproq3"] == "Effect"
    assert lists["names"]["proq3"] == "Effect" and "waveshell1vst3" not in lists["names"]
    assert lists["names"]["pigments"] == "Instrument" and lists["names"]["supermassive"] == "Effect"

    plug = tmp_path / "plug"
    plug.mkdir()
    for n in ("Serum.vst", "Sylenth1.dll", "OTT.dll"):
        (plug / n).write_bytes(b"x")
    found = plugins.scan(folders=[plug], daws=lists)
    assert {r["name"]: r["kind"] for r in found["plugins"]} == {"Serum": "Instrument", "Sylenth1": "Instrument", "OTT": "Effect"}


def test_a_look_kept_from_an_older_version_is_looked_at_again(tmp_path, monkeypatch):
    plug = tmp_path / "plug"
    _bundle_with_code(plug, "Diva.vst3", "MacOS", b"Instrument|Synth")
    monkeypatch.setattr(plugins, "standard_folders", lambda: [plug])
    monkeypatch.setattr(plugins, "daw_lists", lambda: {"paths": {}, "names": {}})
    app = create_app(token="", db_path=tmp_path / "c.db")
    app.state.catalog.set_setting("plugin_scan", {"plugins": [{"id": "diva", "name": "Diva", "maker": "", "kind": "",
                                                               "formats": ["VST3"], "places": []}],
                                                  "folders": [], "scanned_at": 1, "complete": True})
    body = TestClient(app).get("/api/plugins").json()
    assert [(p["name"], p["kind"]) for p in body["plugins"]] == [("Diva", "Instrument")]
    assert "kind_cache" not in body


def test_format_folders_are_not_makers(tmp_path):
    for folder in ("AU", "AAX", "VST3 Plugins"):
        (tmp_path / folder).mkdir()
        (tmp_path / folder / f"Thing{folder[:2]}.vst3").mkdir()
    found = plugins.scan(folders=[tmp_path], daws={"paths": {}, "names": {}})
    assert [r["maker"] for r in found["plugins"]] == ["", "", ""]


def test_api_counts_uses_again_only_when_something_changed(tmp_path, monkeypatch):
    """Which projects use each plug-in is kept between visits, and worked out again
    once a project's plug-ins change."""
    plug = tmp_path / "plug"
    (plug / "Vital.vst3").mkdir(parents=True)
    monkeypatch.setattr(plugins, "standard_folders", lambda: [])
    app = create_app(token="", db_path=tmp_path / "c.db")
    c = TestClient(app)
    c.put("/api/plugins/folders", json={"folders": [str(plug)]})
    cat = app.state.catalog
    cat.upsert_discovered([{"project_id": "p1", "name": "Night", "path": str(tmp_path / "Night.als"),
                            "dir": str(tmp_path), "daw": "ableton", "owner": "me", "size": 1, "mtime": 1.0,
                            "missing_count": 0, "plugins": '["Vital"]'}], "t")
    calls = []
    real = plugins.used_in
    monkeypatch.setattr(plugins, "used_in", lambda rows, projects: (calls.append(1), real(rows, projects))[1])
    first = c.get("/api/plugins").json()
    assert first["plugins"][0]["used_in"] == 1
    assert c.get("/api/plugins").json() == first and len(calls) == 1  # kept
    cat.upsert_discovered([{"project_id": "p1", "name": "Night", "path": str(tmp_path / "Night.als"),
                            "dir": str(tmp_path), "daw": "ableton", "owner": "me", "size": 1, "mtime": 2.0,
                            "missing_count": 0, "plugins": '["Diva"]'}], "t")
    assert c.get("/api/plugins").json()["plugins"][0]["used_in"] == 0 and len(calls) == 2
