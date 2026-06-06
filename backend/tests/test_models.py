from pathlib import Path
from ablebackup.models import FileRef, ResolvedRef, ProjectScan


def test_fileref_defaults():
    ref = FileRef(name="kick.wav")
    assert ref.name == "kick.wav"
    assert ref.absolute_path is None
    assert ref.relative_path is None


def test_projectscan_missing_and_total_size(tmp_path):
    proj = ProjectScan(
        als_path=tmp_path / "song.als",
        name="song",
        project_dir=tmp_path,
        mtime=1.0,
        size=100,
    )
    present = ResolvedRef(name="a.wav", resolved_path=tmp_path / "a.wav",
                          exists=True, inside_project=True, size=50)
    absent = ResolvedRef(name="b.wav", resolved_path=None,
                         exists=False, inside_project=False, size=0)
    proj.refs = [present, absent]
    assert proj.missing == [absent]
    assert proj.total_size == 150  # 100 als + 50 present ref
