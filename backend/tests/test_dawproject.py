import zipfile

import pytest

_PROJECT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
  <Arrangement>
    <Clip>
      <Audio><File path="/Users/me/Splice/kick.wav" external="true"/></Audio>
    </Clip>
    <Clip>
      <Audio><File path="samples/embedded.wav"/></Audio>   <!-- inside the zip -> skip -->
    </Clip>
    <Clip>
      <Audio><File path="/Users/me/Splice/kick.wav" external="true"/></Audio>  <!-- dup -->
    </Clip>
  </Arrangement>
</Project>
"""


def _make_dawproject(path, *, with_embedded=True):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("project.xml", _PROJECT_XML)
        z.writestr("metadata.xml", "<MetaData/>")
        if with_embedded:
            z.writestr("samples/embedded.wav", b"audio-bytes")


def test_reads_external_paths_skips_embedded_and_dups(tmp_path):
    from ablebackup.daws.dawproject import read_sample_paths
    dp = tmp_path / "song.dawproject"
    _make_dawproject(dp)
    assert read_sample_paths(dp) == ["/Users/me/Splice/kick.wav"]


def test_adapter_and_scan_dispatch(tmp_path):
    from ablebackup.daws.dawproject import DawprojectAdapter
    from ablebackup.scanner import scan_one
    dp = tmp_path / "song.dawproject"
    _make_dawproject(dp)

    refs = DawprojectAdapter().parse_project(dp)
    assert len(refs) == 1 and refs[0].absolute_path == "/Users/me/Splice/kick.wav"

    scan = scan_one(dp)
    assert scan.daw_id == "dawproject"
    assert scan.name == "song"


def test_bad_zip_raises(tmp_path):
    from ablebackup.daws.dawproject import DawprojectAdapter
    bad = tmp_path / "broken.dawproject"
    bad.write_bytes(b"not a zip")
    with pytest.raises(ValueError):
        DawprojectAdapter().parse_project(bad)
