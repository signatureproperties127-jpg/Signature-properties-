"""Backend regression tests for RERA modal-persistence bug fix."""
import os, requests, pytest

BASE_URL = "https://e6961d98-7d3f-45b6-bd35-6e53a7314088.preview.emergentagent.com"

@pytest.fixture(scope="module")
def rera_prop():
    r = requests.get(f"{BASE_URL}/api/v2/inventory?limit=100", timeout=30)
    assert r.status_code == 200
    items = r.json()["data"]
    rera = [p for p in items if p.get("IsReraMaster")]
    assert rera, "No RERA rows in DB"
    return rera[0]

@pytest.fixture(scope="module")
def nonrera_prop():
    r = requests.get(f"{BASE_URL}/api/v2/inventory?limit=100", timeout=30)
    items = r.json()["data"]
    non = [p for p in items if not p.get("IsReraMaster")]
    assert non
    return non[0]

def test_get_rera_has_top_level_fields(rera_prop):
    pid = rera_prop["PropertyID"]
    r = requests.get(f"{BASE_URL}/api/v2/inventory/{pid}", timeout=30)
    assert r.status_code == 200
    p = r.json().get("data", r.json())
    for k in ["RERANumber", "RERARegistrationDate", "ProjectStatus", "Configurations", "TotalUnits", "AreaRange", "PossessionDate", "LandArea", "ImportedFrom", "NeedsReview"]:
        assert k in p, f"missing top-level {k}"

def test_patch_rera_fields_persist_top_level(rera_prop):
    pid = rera_prop["PropertyID"]
    new_status = "Completed" if rera_prop.get("ProjectStatus") != "Completed" else "Ongoing"
    payload = {
        "ProjectStatus": new_status,
        "TotalUnits": 999,
        "PossessionDate": "2030-12-31",
        "LandArea": 1234.5,
        "NeedsReview": not bool(rera_prop.get("NeedsReview")),
    }
    r = requests.patch(f"{BASE_URL}/api/v2/inventory/{pid}", json=payload, timeout=30)
    assert r.status_code in (200, 204), f"patch failed: {r.status_code} {r.text}"

    g = requests.get(f"{BASE_URL}/api/v2/inventory/{pid}", timeout=30).json()
    p = g.get("data", g)
    # Top-level, NOT nested inside Fields.*
    assert p.get("ProjectStatus") == new_status
    assert p.get("TotalUnits") == 999
    assert p.get("PossessionDate") == "2030-12-31"
    assert abs(float(p.get("LandArea")) - 1234.5) < 0.01
    assert p.get("NeedsReview") == payload["NeedsReview"]
    # Not dumped into Fields
    fields = p.get("Fields") or {}
    for k in ["ProjectStatus", "TotalUnits", "PossessionDate", "LandArea", "NeedsReview"]:
        assert k not in fields, f"{k} leaked into Fields.*"

def test_nonrera_untouched(nonrera_prop):
    pid = nonrera_prop["PropertyID"]
    r = requests.get(f"{BASE_URL}/api/v2/inventory/{pid}", timeout=30).json()
    p = r.get("data", r)
    assert not p.get("IsReraMaster")
