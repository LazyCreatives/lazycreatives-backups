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
    assert guess_genre("deep house", 123, [], learned)["genre"] == "Deep house"  # a name word still wins


def test_learns_your_own_genres():
    learned = [(110, "Gqom")]
    assert guess_genre("untitled", 108, [], learned)["genre"] == "Gqom"
    assert guess_genre("gqom sketch", 60, [], learned)["genre"] == "Gqom"


def test_the_longer_genre_word_wins():
    # "deep house" is Deep house, not House as well; same for tech house and melodic techno
    assert guess_genre("deep house roller", 122, [])["genre"] == "Deep house"
    assert guess_genre("tech house tool", 124, [])["genre"] == "Tech house"
    assert guess_genre("melodic techno idea", 124, [])["genre"] == "Melodic techno"
    assert guess_genre("warehouse jam", 130, [])["genre"] == "Techno"


def test_newer_genres_come_from_names_and_samples():
    assert guess_genre("amapiano groove", 112, [])["genre"] == "Amapiano"
    assert guess_genre("untitled", 112, ["log_drum_C.wav", "shaker.wav"])["genre"] == "Amapiano"
    assert guess_genre("RnB vibes", 70, [])["genre"] == "R&B"
    assert guess_genre("afrobeats sketch", 104, [])["genre"] == "Afrobeats"
    assert guess_genre("Reggaeton 2", 95, [])["genre"] == "Reggaeton"


def test_tempo_alone_never_picks_a_newer_genre():
    # a project with no genre words gets the same guess it always did
    from ablebackup.genre import _NAMED_ONLY
    newer = {g for g, *_ in _NAMED_ONLY}
    for bpm in range(40, 200):
        g = guess_genre("untitled", bpm, [])
        assert g["genre"] not in newer
        assert not newer & set(g["alternatives"])


def test_rap_and_experimental_names():
    assert guess_genre("jerk beat 3", 150, [])["genre"] == "Jerk"
    assert guess_genre("uk drill type", 142, [])["genre"] == "UK drill"
    assert guess_genre("rage idea", 155, [])["genre"] == "Rage"
    assert guess_genre("plugg 2", 150, [])["genre"] == "Plugg"
    assert guess_genre("IDM sketch", 97, [])["genre"] == "IDM"
    assert guess_genre("experimental thing", None, [])["genre"] == "Experimental"


def test_dnb_sub_genres():
    assert guess_genre("jump up banger", 174, [])["genre"] == "Jump up"
    assert guess_genre("liquid 4", 174, [])["genre"] == "Liquid DnB"
    assert guess_genre("neuro roller", 174, [])["genre"] in ("Neurofunk", "Rollers")
    assert guess_genre("minimal dnb idea", 172, [])["genre"] == "Minimal DnB"
    assert guess_genre("untitled", 174, ["reese_bass.wav"])["genre"] == "DnB"
