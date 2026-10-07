"""The shared stem checker: one part of a song, or the whole song?

This file is kept the same in Uploader (backend/tests/test_stems.py), so both apps
are held to the same answers.
"""
from pathlib import Path

from ablebackup.stems import is_stem, stem_folder_name


def test_a_stems_folder_makes_everything_in_it_a_stem():
    assert is_stem(Path("/x/Stems/Anything.wav"), root=Path("/x"))
    assert is_stem(Path("/x/Night Drive/Multitracks/Take.wav"), root=Path("/x"))
    assert is_stem(Path("/x/Night Drive Stems/Kick.wav"), root=Path("/x"))
    assert not is_stem(Path("/x/Exports/Night Drive.wav"), root=Path("/x"))


def test_the_part_a_daw_names_itself():
    assert is_stem(Path("/x/Night Drive 3-Bass.wav"))        # Ableton
    assert is_stem(Path("/x/Night Drive_Insert 3.wav"))       # FL Studio
    assert not is_stem(Path("/x/Garage 2-Step.wav"))          # a song, not track 2
    assert not is_stem(Path("/x/Night Drive 9-Master.wav"))   # the whole song


def test_a_part_added_to_the_song_name():
    assert is_stem(Path("/x/Night Drive Kick.wav"), project="Night Drive")
    assert is_stem(Path("/x/Night Drive (Stems) Vocals.wav"), project="Night Drive")
    assert is_stem(Path("/x/Night Drive - Vocals.wav"))
    assert is_stem(Path("/x/Night Drive (Bass).wav"))
    assert is_stem(Path("/x/Night Drive_Kick.wav"))
    assert is_stem(Path("/x/Kick.wav"))
    assert is_stem(Path("/x/02 Vocals.wav"))


def test_songs_that_only_look_like_stems():
    assert not is_stem(Path("/x/Night Drive.wav"), project="Night Drive")
    assert not is_stem(Path("/x/Bass.wav"), project="Bass")          # a song called Bass
    assert not is_stem(Path("/x/Bass Odyssey.wav"), project="Bass Odyssey")
    assert not is_stem(Path("/x/Deep Bass.wav"))
    assert not is_stem(Path("/x/Sub Focus.wav"))
    assert not is_stem(Path("/x/Feel_The_Bass.wav"))                 # one title, no spaces
    assert not is_stem(Path("/x/Artist - Night Drive.wav"))
    # a version of the whole song, even with a part word in it
    assert not is_stem(Path("/x/Night Drive Bass Edit.wav"), project="Night Drive")
    assert not is_stem(Path("/x/Night Drive Instrumental.wav"), project="Night Drive")
    assert not is_stem(Path("/x/Night Drive - Club Mix.wav"))
    assert not is_stem(Path("/x/Night Drive (VIP).wav"))
    assert not is_stem(Path("/x/Night Drive_Master.wav"))


def test_the_song_name_a_stems_folder_carries():
    assert stem_folder_name(Path("/x/Night Drive Stems/Kick.wav"), Path("/x")) == "Night Drive"
    assert stem_folder_name(Path("/x/Night Drive/Stems/Kick.wav"), Path("/x")) == "Night Drive"
    assert stem_folder_name(Path("/x/Exports/Night Drive.wav"), Path("/x")) is None
