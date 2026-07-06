"""Anti-ping-pong tests: candidate selection policy + trajectory hysteresis."""
import main
from main import _select_crop_center, smooth_crop_trajectory

CROP_W = 600


def _run_selection(samples):
    """Feed a sequence of candidate lists through the sticky selector."""
    state, out = {}, []
    for cands in samples:
        cx = _select_crop_center(cands, CROP_W, state)
        out.append(cx)
    return out


# ── group mode ────────────────────────────────────────────────────────────────

def test_group_mode_holds_cluster_centroid():
    # 3 people clustered around x≈900 (fits in the crop) + high motion noise:
    # the emitted centre must stay at the cluster's weighted centroid.
    cluster = [(850.0, 40000, 5.0), (900.0, 60000, 30.0), (960.0, 50000, 2.0)]
    out = _run_selection([cluster] * 10)
    centroid = sum(c[0] * c[1] for c in cluster) / sum(c[1] for c in cluster)
    assert all(abs(x - centroid) < CROP_W * 0.05 for x in out)


def test_edge_straggler_is_trimmed():
    # Cluster at centre + one person at the far edge with HUGE motion. The old
    # logic chased the edge; the centroid must ignore them.
    frame = [(880.0, 50000, 3.0), (930.0, 55000, 4.0), (60.0, 30000, 80.0)]
    out = _run_selection([frame] * 6)
    assert all(800 < x < 1000 for x in out), f"edge straggler hijacked the crop: {out}"


# ── speaker mode (subjects too far apart to fit) ─────────────────────────────

def _two_speakers(active):
    """Two people 1200px apart; `active` (0/1) has the head motion."""
    a = (300.0, 50000, 40.0 if active == 0 else 2.0)
    b = (1500.0, 50000, 40.0 if active == 1 else 2.0)
    return [a, b]


def test_speaker_lock_survives_single_sample_flips():
    # Motion winner alternates EVERY sample (the classic ping-pong input).
    # The lock must hold: no challenger ever wins 3 consecutive samples.
    samples = [_two_speakers(i % 2) for i in range(20)]
    out = _run_selection(samples)
    jumps = sum(1 for i in range(1, len(out)) if abs(out[i] - out[i - 1]) > CROP_W * 0.3)
    assert jumps == 0, f"ping-ponged {jumps} times: {out}"


def test_speaker_switch_after_sustained_change():
    # Speaker 0 talks for 6 samples, then speaker 1 for 6: exactly one switch.
    samples = [_two_speakers(0)] * 6 + [_two_speakers(1)] * 6
    out = _run_selection(samples)
    jumps = sum(1 for i in range(1, len(out)) if abs(out[i] - out[i - 1]) > CROP_W * 0.3)
    assert jumps == 1, f"expected exactly 1 switch, got {jumps}: {out}"
    assert abs(out[-1] - 1500.0) < 50, "lock did not move to the new speaker"


def test_empty_candidates_returns_none():
    assert _select_crop_center([], CROP_W, {}) is None


def test_cluster_spread_recorded_for_group_zoom():
    # The fill layout's auto zoom-out reads per-sample cluster spreads from the
    # selector state; solo speakers must record ~0 so they never widen.
    state = {}
    cluster = [(850.0, 40000, 5.0), (900.0, 60000, 30.0), (960.0, 50000, 2.0)]
    _select_crop_center(cluster, CROP_W, state)
    assert state["spreads"] == [110.0]
    solo_state = {}
    _select_crop_center([(500.0, 50000, 10.0)], CROP_W, solo_state)
    assert solo_state["spreads"] == [0.0]


# ── trajectory adaptive hysteresis ────────────────────────────────────────────

def _switch_count(traj):
    return sum(1 for i in range(1, len(traj)) if abs(traj[i][1] - traj[i - 1][1]) > 150)


def test_trajectory_bounds_alternating_detections():
    # Adversarial input: detections alternate between two positions every 0.5s
    # for 30s. The adaptive hold must keep camera switches rare.
    det = [(i * 0.5, 100 if i % 2 == 0 else 700) for i in range(60)]
    traj = smooth_crop_trajectory(det, 30.0, fallback_crop_x=100, crop_w=600, src_w=1920)
    assert _switch_count(traj) <= 4, f"too many switches: {_switch_count(traj)}"


def test_trajectory_normal_switch_unaffected():
    # A single clean speaker change must still switch exactly once.
    det = [(i * 0.5, 100) for i in range(10)] + [(5 + i * 0.5, 700) for i in range(10)]
    traj = smooth_crop_trajectory(det, 10.0, fallback_crop_x=100, crop_w=600, src_w=1920)
    assert _switch_count(traj) == 1
