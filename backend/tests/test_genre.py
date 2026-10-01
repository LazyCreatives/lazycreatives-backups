from ablebackup.genre import guess_genre


def test_name_keyword_is_high_confidence():
    g = guess_genre("Boombap sadm", 91, [])
    assert g["genre"] == "Boom bap" and g["confidence"] >= 0.85


def test_word_boundary_avoids_false_substring():
    # "penthouse" must not match the "house" keyword
    g = guess_genre("PENTHOUSE BAD", 140, [])
    assert g["genre"] != "House"
    # "entrance" must not match "trance"
    assert guess_genre("entrance", 138, [])["genre"] != "Trance"


def test_bpm_only_is_low_confidence_with_alternatives():
    g = guess_genre("untitled idea", 174, [])
    assert g["bpm"] == 174
    assert g["confidence"] < 0.5
    assert g["alternatives"]  # offers other candidates when unsure


def test_no_signal_returns_untagged():
    g = guess_genre("", None, [])
    assert g["genre"] is None and g["confidence"] == 0.0


def test_sample_keyword_is_medium_confidence():
    g = guess_genre("untitled", 174, ["amen_break_174.wav", "reese_bass.wav"])
    assert g["genre"] == "DnB"
    assert 0.5 <= g["confidence"] < 0.9
