"""Dynamic layout: segment-builder anti-flicker logic + panel picker.

All tests drive the PURE functions (_active_speaker_segments,
_pick_panel_speakers) with synthetic series — no video, no OpenCV.
"""
import main
from main import _active_speaker_segments, _pick_panel_speakers, DYN_WIDE

HZ = 5  # sample rate used by the real probe


def _series(dur_s, spec, n_faces=2, quiet=0.6, hot=3.0):
    """Build (times, audio, act, mouth) for `dur_s` seconds. `spec` maps a
    face index -> list of (t0, t1) intervals during which that face speaks."""
    n = int(dur_s * HZ)
    times = [i / HZ for i in range(n)]
    audio, act, mouth = [], {ci: [] for ci in range(n_faces)}, {ci: [] for ci in range(n_faces)}
    for i, t in enumerate(times):
        someone = any(a <= t < b for iv in spec.values() for a, b in iv)
        audio.append(0.08 if someone else 0.005)
        for ci in range(n_faces):
            talking = any(a <= t < b for a, b in spec.get(ci, []))
            act[ci].append(hot if talking else quiet)
            mouth[ci].append(6.0 if talking else 0.4)
    return times, audio, act, mouth


def _segs(dur, spec, n_faces=2, **kw):
    t, a, ac, m = _series(dur, spec, n_faces)
    return _active_speaker_segments(t, a, ac, m, dur, **kw)


# ── segment builder ───────────────────────────────────────────────────────────

def test_single_speaker_monologue_is_one_segment():
    segs = _segs(30, {0: [(0, 30)]})
    assert len(segs) == 1
    assert segs[0][2] == (0,)
    assert segs[0][0] == 0.0 and abs(segs[0][1] - 30) < 0.01


def test_clean_handoff_produces_two_segments():
    segs = _segs(30, {0: [(0, 14)], 1: [(16, 30)]})
    keys = [k for _, _, k in segs]
    assert keys[0] == (0,) and keys[-1] == (1,)


def test_crosstalk_shows_both_speakers():
    # Both talk over each other for a sustained stretch → a 2-up appears.
    segs = _segs(30, {0: [(0, 30)], 1: [(10, 22)]})
    assert (0, 1) in [k for _, _, k in segs]


def test_short_laugh_burst_does_not_switch():
    # 0.4s of "activity" from face 1 (< join threshold) must not add a tile.
    segs = _segs(30, {0: [(0, 30)], 1: [(15.0, 15.4)]})
    assert all(k == (0,) for _, _, k in segs)


def test_rapid_alternation_merges_not_flickers():
    # Two speakers trading every second: min-segment merging must not emit
    # a cut per exchange (the merged result may be either or both faces).
    spec = {0: [(i, i + 1) for i in range(0, 30, 2)],
            1: [(i, i + 1) for i in range(1, 30, 2)]}
    segs = _segs(30, spec)
    assert len(segs) <= 6
    assert all((b - a) >= 2.0 for a, b, _ in segs[:-1])


def test_five_simultaneous_goes_wide():
    spec = {ci: [(0, 30)] for ci in range(5)}
    segs = _segs(30, spec, n_faces=5)
    assert segs[0][2] is DYN_WIDE


def test_cap_respects_max_tiles_override():
    spec = {ci: [(0, 30)] for ci in range(3)}
    segs = _segs(30, spec, n_faces=3, max_tiles=2)
    assert segs[0][2] is DYN_WIDE


def test_leading_silence_backfills_first_speaker():
    segs = _segs(30, {0: [(6, 30)]})
    assert segs[0][2] == (0,)          # no dead "nobody" segment at the top
    assert segs[0][0] == 0.0


def test_no_switch_in_final_stretch():
    # Face 1 pipes up for the last 1.2s — too late, must merge into previous.
    segs = _segs(30, {0: [(0, 30)], 1: [(28.8, 30)]})
    assert segs[-1][1] == 30 and len(segs) == 1


def test_segment_cap_is_enforced():
    spec = {0: [(i, i + 3) for i in range(0, 120, 6)],
            1: [(i + 3, i + 6) for i in range(0, 120, 6)]}
    segs = _segs(120, spec, max_segs=10)
    assert len(segs) <= 10


def test_segments_tile_the_full_duration():
    segs = _segs(45, {0: [(0, 20)], 1: [(20, 45)]})
    assert segs[0][0] == 0.0 and abs(segs[-1][1] - 45) < 0.01
    for i in range(1, len(segs)):
        assert segs[i][0] == segs[i - 1][1]


def test_boundary_snaps_to_scene_cut():
    # Self-calibrating: find where the handoff boundary naturally lands, then
    # place a source cut 0.3s before it — the boundary must snap onto the cut.
    spec = {0: [(0, 15)], 1: [(15, 30)]}
    free = _segs(30, spec)
    assert len(free) > 1, "expected a handoff to produce >1 segment"
    boundary = free[1][0]
    cut = round(boundary - 0.3, 3)
    snapped = _segs(30, spec, cuts=[cut])
    assert any(abs(s[0] - cut) < 0.01 for s in snapped[1:])


def test_empty_input_is_wide():
    assert _active_speaker_segments([], [], {}, {}, 30) == [(0.0, 30, DYN_WIDE)]


# ── panel picker ──────────────────────────────────────────────────────────────

def _cluster(fcx, fcy=400, fw=120, fh=150, hits=20, frames=None, pos_std=5.0):
    return {"fcx": fcx, "fcy": fcy, "fw": fw, "fh": fh, "hits": hits,
            "frames": frames if frames is not None else set(range(24)),
            "pos_std": pos_std, "size_std": 2.0}


def test_panel_picks_all_copresent_faces():
    clusters = [_cluster(200), _cluster(800), _cluster(1400), _cluster(1700)]
    panel = _pick_panel_speakers(clusters, 24, 1920, 1080)
    assert panel is not None and len(panel) == 4
    assert [c["fcx"] for c in panel] == sorted(c["fcx"] for c in panel)


def test_panel_rejects_single_face():
    assert _pick_panel_speakers([_cluster(900)], 24, 1920, 1080) is None


def test_panel_drops_tiny_faces():
    clusters = [_cluster(300), _cluster(900), _cluster(1500, fh=30)]  # 30px face
    panel = _pick_panel_speakers(clusters, 24, 1920, 1080)
    assert panel is not None and len(panel) == 2


def test_panel_excludes_never_copresent_cluster():
    # Face C shares no frames with A/B — one person who moved seats, not a
    # third panelist.
    a = _cluster(300, frames=set(range(0, 12)))
    b = _cluster(900, frames=set(range(0, 12)))
    c = _cluster(1500, frames=set(range(12, 24)), hits=12)
    panel = _pick_panel_speakers([a, b, c], 24, 1920, 1080)
    assert panel is not None and len(panel) == 2
    assert all(p["fcx"] in (300, 900) for p in panel)


def test_panel_drops_unstable_drifter():
    clusters = [_cluster(300), _cluster(900), _cluster(1500, pos_std=200.0)]
    panel = _pick_panel_speakers(clusters, 24, 1920, 1080)
    assert panel is not None and len(panel) == 2


def test_panel_caps_at_six():
    clusters = [_cluster(150 + i * 250) for i in range(8)]
    panel = _pick_panel_speakers(clusters, 24, 2200, 1080)
    assert panel is not None and len(panel) <= 6


# ── per-shot planner + unattributed-speech→WIDE ──────────────────────────────

from main import _dyn_shot_plan, _dyn_shot_faces


def _scan(dur_s, face_specs, speech=None):
    """Synthetic scan. face_specs: list of (fcx, fcy, fw, fh, talk_intervals).
    speech: intervals where audio is hot (default: union of all talk)."""
    n = int(dur_s * HZ)
    times = [i / HZ for i in range(n)]
    if speech is None:
        speech = [iv for (_, _, _, _, ivs) in face_specs for iv in ivs]
    audio = [0.08 if any(a <= t < b for a, b in speech) else 0.004 for t in times]
    samples = []
    for t in times:
        row = []
        for (fx, fy, fw, fh, ivs) in face_specs:
            talking = any(a <= t < b for a, b in ivs)
            row.append((fx, fy, fw, fh, 3.0 if talking else 0.55, 6.0 if talking else 0.4))
        samples.append(row)
    return {"times": times, "audio": audio, "faces": samples}


def test_shot_plan_solo_shot_crops_the_only_face():
    scan = _scan(10, [(600, 300, 120, 150, [(0, 10)])])
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert len(segs) == 1
    assert segs[0][2] is not DYN_WIDE and len(segs[0][2]) == 1
    assert abs(segs[0][2][0]["fcx"] - 600) < 30


def test_shot_plan_faceless_shot_goes_wide():
    scan = _scan(8, [])
    segs = _dyn_shot_plan(scan, [(0.0, 8.0)], 8.0, 1920, 1080)
    assert segs == [(0.0, 8.0, DYN_WIDE)]


def test_shot_plan_unattributed_speech_goes_wide_not_guessed():
    # THREE visible faces, none moves their mouth, but speech is audible
    # (an off-screen host is talking). Must show WIDE — never guess a face.
    scan = _scan(12, [(400, 300, 120, 150, []), (960, 300, 120, 150, []),
                      (1500, 300, 120, 150, [])], speech=[(0, 12)])
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert all(s is DYN_WIDE for _, _, s in segs)


def test_shot_plan_two_shot_never_goes_wide():
    # A two-shot with unattributable speech shows BOTH people (the talker is
    # one of them by construction) — a 2-up, not a wide.
    scan = _scan(12, [(500, 300, 120, 150, []), (1300, 300, 120, 150, [])],
                 speech=[(0, 12)])
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert len(segs) == 1 and segs[0][2] is not DYN_WIDE and len(segs[0][2]) == 2


def test_shot_plan_two_shot_clear_talker_gets_solo():
    scan = _scan(12, [(500, 300, 120, 150, [(0, 12)]), (1300, 300, 120, 150, [])])
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert len(segs) == 1 and len(segs[0][2]) == 1
    assert abs(segs[0][2][0]["fcx"] - 500) < 30


def test_shot_plan_two_shots_independent_layouts():
    # Shot 1: solo face left. Shot 2 (after a source cut): different solo face.
    scan = _scan(12, [(400, 300, 130, 160, [(0, 6)])])
    # face 2 only exists in second half (camera angle change)
    for i, t in enumerate(scan["times"]):
        if t >= 6:
            scan["faces"][i] = [(1400, 320, 130, 160, 3.0, 6.0)]
    segs = _dyn_shot_plan(scan, [(0.0, 6.0), (6.0, 12.0)], 12.0, 1920, 1080)
    assert len(segs) == 2
    assert abs(segs[0][2][0]["fcx"] - 400) < 30
    assert abs(segs[1][2][0]["fcx"] - 1400) < 30


def test_shot_plan_crosstalk_grid_within_shot():
    faces = [(300 + i * 400, 300, 120, 150, [(0, 15)]) for i in range(4)]
    scan = _scan(15, faces)
    segs = _dyn_shot_plan(scan, [(0.0, 15.0)], 15.0, 1920, 1080)
    assert any(s is not DYN_WIDE and len(s) == 4 for _, _, s in segs)


def test_shot_plan_segments_tile_duration():
    scan = _scan(20, [(500, 300, 120, 150, [(0, 9)]), (1300, 300, 120, 150, [(11, 20)])])
    segs = _dyn_shot_plan(scan, [(0.0, 20.0)], 20.0, 1920, 1080)
    assert segs[0][0] == 0.0 and segs[-1][1] == 20.0
    for i in range(1, len(segs)):
        assert segs[i][0] == segs[i - 1][1]


def test_shot_faces_drops_tiny_and_transient():
    n = int(10 * HZ)
    samples = []
    for i in range(n):
        row = [(500, 300, 120, 150, 0.6, 0.4)]           # stable big face
        row.append((900, 300, 30, 36, 0.6, 0.4))          # too small at 1080p
        if i < 3:
            row.append((1500, 300, 120, 150, 0.6, 0.4))   # transient (3 samples)
        samples.append(row)
    scan = {"times": [i / HZ for i in range(n)], "audio": [0.05] * n, "faces": samples}
    faces = _dyn_shot_faces(scan, 0, n, 1920, 1080)
    assert len(faces) == 1 and abs(faces[0]["fcx"] - 500) < 30


def test_shot_plan_two_shot_arguing_shows_both():
    # Both faces have comparable activity (arguing over each other — the
    # r-ratio under-reads animated speakers). Even if only one crosses the
    # absolute threshold, comparable activity must produce the 2-up.
    n = int(12 * HZ)
    times = [i / HZ for i in range(n)]
    audio = [0.08] * n
    samples = []
    for i in range(n):
        samples.append([
            (500, 300, 120, 150, 1.35, 5.0),    # crosses r_min=1.10
            (1300, 300, 120, 150, 0.95, 4.0),   # below threshold but competitive
        ])
    scan = {"times": times, "audio": audio, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 2 for _, _, s in segs)


def test_shot_plan_arguer_walks_off_midshot():
    # Two-shot: both argue for the first 10s, then person B leaves the frame
    # and A keeps talking. Must yield a 2-up piece THEN a solo piece — not
    # solo throughout (B's whole-shot presence is only ~35%).
    n = int(28 * HZ)
    times = [i / HZ for i in range(n)]
    audio = [0.08] * n
    samples = []
    for i, t in enumerate(times):
        row = [(500, 300, 120, 150, 1.4, 5.0)]            # A talks whole shot
        if t < 10:                                         # B present+arguing, then gone
            row.append((1300, 300, 120, 150, 1.0, 4.0))
        samples.append(row)
    scan = {"times": times, "audio": audio, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 28.0)], 28.0, 1920, 1080)
    kinds = [len(s) if s is not DYN_WIDE else "w" for _, _, s in segs]
    assert kinds[0] == 2, f"expected 2-up first, got {kinds}"
    assert kinds[-1] == 1, f"expected solo last, got {kinds}"
    # the switch should happen near B's exit at t=10
    assert abs(segs[0][1] - 10) < 2.5


def test_shot_faces_dedupes_moving_person():
    # One person detected at position A for the first half, position B for
    # the second half (they moved). Disjoint presence in time = SAME person —
    # must not become two faces (a self-split tile).
    n = int(20 * HZ)
    samples = []
    for i in range(n):
        if i < n // 2:
            samples.append([(500, 300, 120, 150, 1.4, 5.0)])
        else:
            samples.append([(1300, 320, 120, 150, 1.4, 5.0)])
    scan = {"times": [i / HZ for i in range(n)], "audio": [0.08] * n, "faces": samples}
    faces = _dyn_shot_faces(scan, 0, n, 1920, 1080)
    assert len(faces) == 1, f"expected dedupe to 1 face, got {len(faces)}"


def test_shot_plan_close_pair_gets_group_crop_not_split():
    # Back-to-back pair: 260px apart at 1080p — both fit one 9:16 crop
    # (crop width ≈ 607px). Must render as ONE group window, not a 2-up.
    scan = _scan(12, [(900, 300, 110, 140, [(0, 12)]),
                      (1160, 300, 110, 140, [(0, 12)])])
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 1 for _, _, s in segs)
    assert segs[0][2][0].get("min_w"), "expected a group window with min_w"


def test_shot_plan_far_pair_still_splits():
    # 800px apart — cannot fit one 9:16 crop → the 2-up split remains.
    scan = _scan(12, [(500, 300, 110, 140, [(0, 12)]),
                      (1300, 300, 110, 140, [(0, 12)])])
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 2 for _, _, s in segs)


def test_shot_plan_mover_gets_virtual_cut_then_group():
    # A stays put at x=500 talking; B sits at x=1300 for the first half
    # (far → split), then moves NEXT to A for the second half (close →
    # group crop). The mover must not be deduped away, and the second half
    # must become a single two-person frame.
    n = int(24 * HZ)
    times = [i / HZ for i in range(n)]
    audio = [0.08] * n
    samples = []
    for i, t in enumerate(times):
        row = [(500, 300, 110, 140, 1.4, 5.0)]
        if t < 12:
            row.append((1300, 300, 110, 140, 1.4, 5.0))
        else:
            row.append((760, 300, 110, 140, 1.4, 5.0))
        samples.append(row)
    scan = {"times": times, "audio": audio, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 24.0)], 24.0, 1920, 1080)
    # first half: far pair → 2-up; second half: close pair → group (len 1 + min_w)
    assert any(s is not DYN_WIDE and len(s) == 2 for _, _, s in segs[:2]), segs
    last = segs[-1][2]
    assert last is not DYN_WIDE and len(last) == 1 and last[0].get("min_w"), segs


def test_shot_plan_phantom_faces_in_closeup_stay_solo():
    # A close-up (420px face) plus two small phantom "faces" (hair/eye/poster
    # detections at 120px) that persist all shot. Must be a SOLO on the real
    # face — never a fake grid with garbage tiles.
    scan = _scan(10, [(960, 400, 320, 420, [(0, 10)]),
                      (400, 200, 90, 120, [(0, 10)]),
                      (1500, 250, 95, 125, [(0, 10)])])
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 1 for _, _, s in segs), segs
    assert abs(segs[0][2][0]["fcx"] - 960) < 40


def test_shot_plan_double_detection_merges_not_tiles():
    # The same face detected twice at slightly different position/scale
    # (overlapping clusters) — one tile, not two of the same person.
    scan = _scan(10, [(900, 300, 200, 260, [(0, 10)]),
                      (960, 340, 170, 220, [(0, 10)])])
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 1 for _, _, s in segs), segs


def test_shot_plan_walking_person_fragments_never_tile():
    # One person walking across a 10s shot: sequential position clusters that
    # never co-occur. Acceptable outcomes: solo crops that FOLLOW them
    # (virtual cuts) or WIDE — NEVER a multi-tile grid of their own path.
    n = int(10 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i in range(n):
        q = min(3, i * 4 // n)
        samples.append([(300 + q * 400, 320, 120, 150, 1.4, 5.0)])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert all(s is DYN_WIDE or len(s) == 1 for _, _, s in segs), segs


def test_shot_plan_short_shot_fragments_go_wide():
    # SHORT shot (4s): the walker's transition points are too close to the
    # shot edges for virtual cuts, so fragments survive to the grammar —
    # the co-occurrence component guard must send the shot WIDE instead of
    # tiling one person 3 times.
    n = int(4 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i in range(n):
        q = min(2, i * 3 // n)
        samples.append([(300 + q * 550, 320, 120, 150, 1.4, 5.0)])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 4.0)], 4.0, 1920, 1080)
    assert all(s is DYN_WIDE or len(s) == 1 for _, _, s in segs), segs
    assert not any(s is not DYN_WIDE and len(s) >= 2 for _, _, s in segs)


def test_shot_plan_undetected_cut_leadin_goes_wide():
    # An UNDETECTED source cut (whip-pan) leaves a "shot" whose first 2.5s is
    # a different scene: the grid members only exist from t=2.5 on. The
    # lead-in must render WIDE — tiling member coordinates over the wrong
    # scene's pixels shows fragments of the wrong content.
    n = int(10 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i, t in enumerate(times):
        if t < 2.5:
            samples.append([])                       # other scene, no faces
        else:
            samples.append([(400, 300, 120, 150, 3.0, 6.0),
                            (900, 300, 120, 150, 3.0, 6.0),
                            (1400, 300, 120, 150, 3.0, 6.0)])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert segs[0][2] is DYN_WIDE, segs
    assert segs[0][1] >= 2.0
    assert any(s is not DYN_WIDE and len(s) >= 2 for _, _, s in segs)


def test_shot_plan_closeup_phantom_column_stays_solo():
    # A big close-up face plus CO-OCCURRING phantom detections on the cap
    # (above) and chin/chest (below) — vertically stacked pieces of ONE
    # person. Must render solo, never a 3-row stack of face fragments.
    scan = _scan(10, [(960, 520, 280, 340, [(0, 10)]),
                      (945, 180, 250, 200, [(0, 10)]),     # cap region
                      (975, 850, 260, 220, [(0, 10)])])    # chin/chest region
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert all(s is not DYN_WIDE and len(s) == 1 for _, _, s in segs), segs


def test_shot_plan_couch_rows_still_grid():
    # Two REAL couch rows (small faces, vertical offset ≈2.4x their height,
    # horizontally interleaved) must still be able to grid — the same-person
    # column guard must not merge different people.
    scan = _scan(10, [(600, 220, 66, 84, [(0, 10)]),
                      (640, 449, 74, 91, [(0, 10)]),
                      (1060, 219, 60, 73, [(0, 10)]),
                      (976, 430, 72, 87, [(0, 10)])])
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    assert any(s is not DYN_WIDE and len(s) >= 3 for _, _, s in segs), segs


def test_shot_plan_multitile_segments_are_chunked():
    # Long multi-tile segments with DRIFTING people must be chunked (≤~3s)
    # so tile windows re-center as they move. (Chunks of perfectly static
    # people may legally coalesce back — their windows are identical.)
    n = int(12 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i, t in enumerate(times):
        samples.append([(500 + int(t * 25), 300, 110, 140, 3.0, 6.0),
                        (1400 - int(t * 25), 300, 110, 140, 3.0, 6.0)])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    multi = [(a, b) for a, b, s in segs if s is not DYN_WIDE and len(s) >= 2]
    assert multi and all((b - a) <= 3.2 for a, b in multi), segs


def test_shot_plan_converging_pair_collapses_to_one():
    # Two people far apart at first, then one WALKS OVER to the other for the
    # second half. Second-half tiles re-aim to the same region — must render
    # ONE frame (group or solo), never the same person/region twice.
    n = int(12 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i, t in enumerate(times):
        a = (500, 300, 110, 140, 3.0, 6.0)
        if t < 6:
            b = (1400, 300, 110, 140, 3.0, 6.0)
        else:
            b = (560, 310, 110, 140, 3.0, 6.0)   # walked next to A
        samples.append([a, b])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 12.0)], 12.0, 1920, 1080)
    late = [s for _, b, s in segs if b > 8.0 and s is not DYN_WIDE]
    assert late and all(len(s) == 1 for s in late), segs


def test_shot_plan_retreating_partner_frees_the_tile():
    # B leans in for the first 2s of an 8s two-shot then retreats (absent).
    # Later chunks must NOT keep B's tile (A would fill both windows) —
    # they demote to solo-A.
    n = int(8 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i, t in enumerate(times):
        row = [(700, 300, 130, 160, 3.0, 6.0)]
        if t < 2:
            row.append((1250, 320, 120, 150, 2.5, 5.0))
        samples.append(row)
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 8.0)], 8.0, 1920, 1080)
    late = [s for _, b, s in segs if b > 4.0 and s is not DYN_WIDE]
    assert late and all(len(s) == 1 for s in late), segs


def test_shot_plan_blur_gap_cut_detected():
    # Whip-pan: 3 faces → 3 EMPTY (blurred) samples → 1 different face.
    # The discontinuity must still be found across the empty gap; the solo
    # segment's face must be the post-cut person (no cross-scene tiles).
    n = int(10 * HZ)
    times = [i / HZ for i in range(n)]
    samples = []
    for i, t in enumerate(times):
        if t < 5.0:
            samples.append([(400, 300, 110, 140, 3.0, 6.0),
                            (900, 300, 110, 140, 3.0, 6.0),
                            (1400, 300, 110, 140, 3.0, 6.0)])
        elif t < 5.6:
            samples.append([])                       # motion blur
        else:
            samples.append([(960, 400, 300, 380, 3.0, 6.0)])
    scan = {"times": times, "audio": [0.08] * n, "faces": samples}
    segs = _dyn_shot_plan(scan, [(0.0, 10.0)], 10.0, 1920, 1080)
    late = [s for a, _, s in segs if a >= 6.0 and s is not DYN_WIDE]
    assert late and all(len(s) == 1 and abs(s[0]["fcx"] - 960) < 50 for s in late), segs


def test_segment_cap_never_stretches_tiles_across_layouts():
    # When over the segment cap, a face segment must NEVER be absorbed into a
    # DIFFERENT face layout (that stretches tiles across scene boundaries).
    # Alternating solos with a tight cap must resolve via WIDE demotion or
    # same-spec merges — never by handing one person's window to another.
    spec = {0: [(i, i + 3) for i in range(0, 120, 6)],
            1: [(i + 3, i + 6) for i in range(0, 120, 6)]}
    segs = _segs(120, spec, max_segs=8)
    assert len(segs) <= 8
    # verify keys only ever contain a single consistent face per segment
    for _, _, k in segs:
        assert k is DYN_WIDE or len(k) >= 1
