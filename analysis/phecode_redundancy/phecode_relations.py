"""Structural relationships between phecodes.

We have summary statistics only, so empirical case overlap between two
phenotypes cannot be computed. These structural tiers stand in for it.

    T1  ancestor-descendant  one code is a truncation of the other
    T2  sibling / same family  same integer root, not T1
    T3  exclusion-range overlap  REQUIRES the phecode definitions file
    T4  shared ICD codes  the two phecodes share >=1 ICD in the mapping

T3 needs `phecode_exclude_range` from the phecode *definitions* file, which
is separate from the ICD->phecode map. When that file is not supplied, `t3`
is None rather than False - an absent tier must not read as an absent
relationship - and every consumer has to decide what to do about it. The
same applies per-pair: eight network phecodes have no row in the definitions
file, and T3 for a pair involving one of them is None, not False.

A warning about T3's granularity. The exclusion ranges are block-wide, not
code-wide: 585.32, 585.3, 587 and 588 all carry "580-590.99", so T3 fires
for any two codes in the same phecode block. It is much coarser than T1 or
T2 and will remove clinically distinct pairs. That is a property of the
phecode system, not of this code, but it means T3 results have to be read
as "same block", not "same illness".

Phecodes are handled as strings throughout: "585.30" and "585.3" are
different codes, and float conversion would merge them.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from dataclasses import dataclass, asdict
from typing import Optional

# Phe_585_32 -> "585.32";  Phe_585 -> "585"
_CODE_RE = re.compile(r"^Phe_(\d+)(?:_(\d+))?$")


def to_phecode(dataset_code: str) -> Optional[str]:
    """Dataset phenotype code -> phecode string, or None if not a phecode.

    Five network phenotypes (DoApnea, DoAsth, HVGlauc, SkMsGout, SkMsOP) are
    not phecodes and cannot be classified.
    """
    m = _CODE_RE.match(dataset_code)
    if not m:
        return None
    integer, decimal = m.group(1), m.group(2)
    return f"{integer}.{decimal}" if decimal else integer


def split(phecode: str) -> tuple[str, str]:
    """"585.32" -> ("585", "32");  "585" -> ("585", "")."""
    if "." in phecode:
        root, dec = phecode.split(".", 1)
        return root, dec
    return phecode, ""


def is_t1(a: str, b: str) -> bool:
    """Ancestor-descendant: same root, one decimal part prefixes the other.

    Compared on the parsed decimal rather than the raw string so that "585"
    vs "5851" cannot be mistaken for a hierarchy.
    """
    if a == b:
        return False
    ra, da = split(a)
    rb, db = split(b)
    if ra != rb:
        return False
    return da.startswith(db) or db.startswith(da)


def is_t2(a: str, b: str) -> bool:
    """Same integer root, but not ancestor-descendant."""
    if a == b:
        return False
    return split(a)[0] == split(b)[0] and not is_t1(a, b)


@dataclass(frozen=True)
class Relation:
    phecode_a: str
    phecode_b: str
    t1: bool
    t2: bool
    t3: Optional[bool]      # None => not computable, definitions file absent
    t4: bool
    shared_icd_count: int

    @property
    def any_structural(self) -> bool:
        """True if any *computable* tier fires. When t3 is None this is a
        lower bound on relatedness rather than the full L3 definition."""
        return bool(self.t1 or self.t2 or self.t3 or self.t4)

    def as_row(self) -> dict:
        d = asdict(self)
        d["t3"] = "" if self.t3 is None else bool(self.t3)
        d["any_structural_computable"] = self.any_structural
        return d


class PhecodeRelations:
    """Classifier over a loaded ICD->phecode map."""

    def __init__(self, icd_map_path: str, definitions_path: Optional[str] = None):
        self.icd_map_path = icd_map_path
        self.phecode_to_icds: dict[str, set[tuple[str, str]]] = defaultdict(set)
        self.phecode_string: dict[str, str] = {}
        self.phecode_category: dict[str, str] = {}

        with open(icd_map_path, newline="") as fh:
            for row in csv.DictReader(fh):
                code = row["Phecode"].strip()
                if not code:
                    continue
                self.phecode_to_icds[code].add((row["Flag"].strip(), row["ICD"].strip()))
                self.phecode_string.setdefault(code, row["PhecodeString"].strip())
                self.phecode_category.setdefault(code, row["PhecodeCategory"].strip())

        # The map assigns each ICD to its most specific phecode - verified: no
        # ICD appears under both a child and its parent - so a shared ICD is a
        # genuine overlap and not a roll-up artefact.
        self.exclude_ranges: Optional[dict[str, str]] = None
        if definitions_path:
            self.exclude_ranges = self._load_exclude_ranges(definitions_path)

    @staticmethod
    def _load_exclude_ranges(path: str) -> dict[str, str]:
        ranges = {}
        with open(path, newline="") as fh:
            for row in csv.DictReader(fh):
                code = (row.get("phecode") or row.get("Phecode") or "").strip()
                rng = (row.get("phecode_exclude_range") or "").strip()
                if code:
                    ranges[code] = rng
        return ranges

    @property
    def t3_available(self) -> bool:
        return self.exclude_ranges is not None

    def _in_exclude_range(self, code: str, other: str) -> Optional[bool]:
        """Is `other` inside `code`'s exclusion range?

        Ranges in Map 1.2 are all "lo-hi", sometimes comma-separated
        ("140-149.99, 210-210.99"). Endpoints are inclusive.

        Returns None when `code` has no row in the definitions file at all -
        that is "we do not know", not "no exclusions". Eight network phecodes
        (the unlabelled 1010.* / 1089 / 1090 codes) are in that position, and
        22 more have a row whose range is empty, which is a real "no
        exclusions" and returns False.

        Comparison is numeric here, unlike everywhere else in this module.
        Containment in a numeric interval is what the column means, and the
        string/float distinction that matters for the hierarchy ("585.30" vs
        "585.3") cannot change which interval a code falls in.
        """
        if self.exclude_ranges is None or code not in self.exclude_ranges:
            return None
        spec = self.exclude_ranges[code]
        if not spec:
            return False
        try:
            value = float(other)
        except ValueError:
            return None
        for part in spec.split(","):
            part = part.strip()
            if not part:
                continue
            lo, _, hi = part.partition("-")
            try:
                if float(lo) <= value <= float(hi or lo):
                    return True
            except ValueError:
                continue
        return False

    def is_t3(self, a: str, b: str) -> Optional[bool]:
        """Exclusion-range overlap, either direction.

        None when the definitions file is absent, or when neither code's row
        is present and so nothing can be concluded. A code's own range
        contains itself, so identity is excluded first - the same guard T1,
        T2 and T4 use.
        """
        if not self.t3_available or a == b:
            return None if not self.t3_available else False
        ab = self._in_exclude_range(a, b)
        ba = self._in_exclude_range(b, a)
        if ab or ba:
            return True
        if ab is None and ba is None:
            return None
        return False

    def shared_icds(self, a: str, b: str) -> set[tuple[str, str]]:
        return self.phecode_to_icds.get(a, set()) & self.phecode_to_icds.get(b, set())

    def classify(self, a: str, b: str) -> Relation:
        t1 = is_t1(a, b)
        t2 = is_t2(a, b)
        shared = self.shared_icds(a, b) if a != b else set()
        t3 = self.is_t3(a, b)
        return Relation(a, b, t1, t2, t3, bool(shared), len(shared))
