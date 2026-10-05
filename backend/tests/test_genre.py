from ablebackup.genre import guess_genre


def test_name_keyword_is_high_confidence():
    g = guess_genre("Boombap sadm", 91, [])
    assert g["genre"] == "Boom bap" and g["confidence"] >= 0.85


def test_word_boundary_avoids_false_substring():
    # "penthouse" must not match the "house" keyword
    g = guess_genre("PENTHOUSE BAD", 140, [])
    assert g["genre"] != "House"
    # "entrance" must not match "trance": it scores like a name with no genre word
    assert guess_genre("entrance", 138, []) == guess_genre("untitled", 138, [])


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


def test_overlapping_tempos_pick_the_closest_fit():
    # 124 BPM sits in both House and Phonk; House is the closer fit
    assert guess_genre("Glasshouse", 124, [])["genre"] == "House"
    assert guess_genre("untitled", 145, [])["genre"] == "Trap"   # the common genre first


def test_learns_from_your_corrections():
    learned = [(124, "Phonk"), (125, "Phonk")]
    assert guess_genre("untitled", 123, [], learned)["genre"] == "Phonk"
    assert guess_genre("untitled", 160, [], learned)["genre"] != "Phonk"   # not a similar tempo
    assert guess_genre("deep house", 123, [], learned)["genre"] == "House"  # a name word still wins


def test_learns_your_own_genres():
    learned = [(110, "Afrobeats")]
    assert guess_genre("untitled", 108, [], learned)["genre"] == "Afrobeats"
    assert guess_genre("afrobeats sketch", 60, [], learned)["genre"] == "Afrobeats"
