"""Structural relationships between phecodes.

We have summary statistics only, so empirical case overlap between two
phenotypes cannot be computed. These structural tiers stand in for it.

    T1  ancestor-descendant  one code is a truncation of the other
    T2  sibling / same family  same integer root, not T1
    T3  exclusion-range overlap  REQUIRES the phecode definitions file
    T4  shared ICD codes  the two phecodes share >=1 ICD in the mapping

T3 is not computable from the inputs we have: the supplied map
(Phecode_map_v1_2_icd9_icd10cm.csv) is the ICD->phecode mapping and carries
no `phecode_exclude_range` column. That lives in the separate phecode
*definitions* file. Rather than silently scoring T3 as False, which would
understate relatedness, `t3` is None whenever the definitions file is absent
and every consumer has to decide what to do about it.

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
        """True if any *computable* tier fires. With T3 unavailable this is a
        lower bound on relatedness, not the full L3 definition."""
        return bool(self.t1 or self.t2 or self.t4)

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

    def _in_exclude_range(self, code: str, other: str) -> bool:
        """Is `other` inside `code`'s exclusion range? Ranges look like
        "585-585.99" or a comma-separated list of such."""
        spec = (self.exclude_ranges or {}).get(code, "")
        if not spec:
            return False
        try:
            value = float(other)
        except ValueError:
            return False
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

    def shared_icds(self, a: str, b: str) -> set[tuple[str, str]]:
        return self.phecode_to_icds.get(a, set()) & self.phecode_to_icds.get(b, set())

    def classify(self, a: str, b: str) -> Relation:
        t1 = is_t1(a, b)
        t2 = is_t2(a, b)
        shared = self.shared_icds(a, b) if a != b else set()
        if self.t3_available:
            t3: Optional[bool] = self._in_exclude_range(a, b) or self._in_exclude_range(b, a)
        else:
            t3 = None
        return Relation(a, b, t1, t2, t3, bool(shared), len(shared))
