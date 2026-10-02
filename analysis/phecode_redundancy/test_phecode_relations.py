"""Unit tests for the phecode relation classifier (A2).

Run: python3 -m pytest analysis/phecode_redundancy/test_phecode_relations.py -q
"""
import os
import pytest

from phecode_relations import PhecodeRelations, is_t1, is_t2, to_phecode, split

ICD_MAP = os.path.expanduser("~/Downloads/Phecode_map_v1_2_icd9_icd10cm.csv")
DEFINITIONS = os.path.expanduser("~/Downloads/phecode_definitions1.2.csv")


@pytest.fixture(scope="module")
def rel():
    """The classifier as the analysis runs it, definitions included."""
    return PhecodeRelations(ICD_MAP, DEFINITIONS)


@pytest.fixture(scope="module")
def rel_no_defs():
    """The same classifier with the definitions file withheld, to check that
    an unavailable tier stays unavailable rather than turning into False."""
    return PhecodeRelations(ICD_MAP)


# --- the cases named in the task -----------------------------------------

def test_585_vs_58532_is_t1():
    assert is_t1("585", "585.32") and not is_t2("585", "585.32")


def test_5853_vs_58532_is_t1():
    assert is_t1("585.3", "585.32") and not is_t2("585.3", "585.32")


def test_58531_vs_58532_is_t2():
    assert is_t2("585.31", "585.32") and not is_t1("585.31", "585.32")


def test_58532_vs_2801_is_neither():
    assert not is_t1("585.32", "280.1") and not is_t2("585.32", "280.1")


def test_t4_hand_verified(rel):
    """297.2 (suicide/self-inflicted injury) and 986 (toxic effect of carbon
    monoxide) share the T58.* carbon-monoxide ICD-10 codes. Different roots,
    so not T1 or T2 - a genuine shared-ICD overlap."""
    r = rel.classify("297.2", "986")
    assert r.t4 and r.shared_icd_count >= 20
    assert not r.t1 and not r.t2
    assert ("10", "T58.02") in rel.shared_icds("297.2", "986")


def test_t3_reports_unavailable_rather_than_false(rel_no_defs):
    """Without the definitions file T3 must come back as unknown. Scoring it
    False would silently understate relatedness."""
    assert rel_no_defs.t3_available is False
    assert rel_no_defs.classify("585.32", "585.1").t3 is None


def test_t3_hand_verified(rel):
    """585.32 (ESRD) and 587 (Kidney replaced by transplant).

    587 falls inside 585.32's exclusion range 580-590.99, and 585.32 falls
    inside 587's, which is the same range. Different integer roots, so
    neither T1 nor T2, and they share no ICD code, so not T4 either: T3 is
    the only tier that fires, which is what makes this a usable check.
    """
    assert rel.t3_available is True
    r = rel.classify("585.32", "587")
    assert r.t3 is True
    assert not r.t1 and not r.t2 and not r.t4
    assert rel.exclude_ranges["585.32"] == "580-590.99"


def test_t3_does_not_fire_across_blocks(rel):
    """585.32 (580-590.99) and 280.1 (280-285.99) are in different blocks."""
    assert rel.classify("585.32", "280.1").t3 is False


def test_t3_identity_is_not_a_relation(rel):
    """A phecode's own exclusion range contains the phecode itself, so this
    would be True without the identity guard that T1/T2/T4 already have."""
    assert rel._in_exclude_range("585.32", "585.32") is True
    assert rel.classify("585.32", "585.32").t3 is False


def test_t3_unknown_when_a_code_has_no_definitions_row(rel):
    """Eight network phecodes have no row in the definitions file. A pair of
    them is unknown, not unrelated."""
    assert rel.classify("1089", "1090").t3 is None


def test_t3_is_block_wide_not_code_wide(rel):
    """The exclusion ranges are coarse: every code in 580-590.99 carries the
    same range, so T3 fires for any two codes in the block. Recorded as a
    test because it is the property that makes T3 aggressive, and anything
    that silently narrowed it would change the analysis."""
    block = ["580", "585", "585.32", "587", "588"]
    for code in block:
        assert rel.exclude_ranges[code] == "580-590.99", code
    # and the ranges are not reciprocal: 590 carries 590-593.99, which does
    # not contain 580, but 580's range does contain 590. Either direction
    # counts, which is why is_t3 tests both.
    assert rel.exclude_ranges["590"] == "590-593.99"
    assert rel._in_exclude_range("590", "580") is False
    assert rel._in_exclude_range("580", "590") is True
    assert rel.classify("580", "590").t3 is True


# --- string handling ------------------------------------------------------

def test_decimal_strings_are_not_floats():
    """585.30 and 585.3 must stay distinct codes; float() would merge them.

    No phecode in Map 1.2 actually has a trailing-zero decimal, so this pair
    is hypothetical, but the classifier must not collapse them. Under the
    truncation rule 585.30 sits below 585.3, so T1 is the right answer - the
    point is that they are two codes, not one.
    """
    assert split("585.30") == ("585", "30")
    assert split("585.3") == ("585", "3")
    assert "585.30" != "585.3"
    assert float("585.30") == float("585.3")   # the trap we are avoiding
    assert is_t1("585.30", "585.3")            # distinct, and hierarchical
    assert not is_t2("585.30", "585.3")


def test_leading_zero_codes_preserved():
    assert to_phecode("Phe_008_52") == "008.52"
    assert to_phecode("Phe_008") == "008"
    assert is_t1("008", "008.52")


def test_non_phecode_codes_rejected():
    for code in ["DoApnea", "DoAsth", "HVGlauc", "SkMsGout", "SkMsOP", "A1C_Max_INT"]:
        assert to_phecode(code) is None


def test_root_lookalikes_are_not_hierarchical():
    """"585" must not be treated as an ancestor of "5851"."""
    assert not is_t1("585", "5851")
    assert not is_t2("585", "5851")


def test_identity_is_not_a_relation():
    assert not is_t1("585.32", "585.32")
    assert not is_t2("585.32", "585.32")


def test_symmetry(rel):
    for a, b in [("585", "585.32"), ("585.31", "585.32"), ("297.2", "986"),
                 ("585.32", "280.1"), ("585.32", "587"), ("1089", "1090")]:
        x, y = rel.classify(a, b), rel.classify(b, a)
        assert (x.t1, x.t2, x.t3, x.t4) == (y.t1, y.t2, y.t3, y.t4)
