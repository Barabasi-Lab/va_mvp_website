#!/usr/bin/env python3
"""Endpoint latency and transferred bytes, baseline against feature (3.3).

Baseline is `main` with the pre-annotation store; the feature branch with
the rebuilt store is the other port. Bytes are what the server actually
sends: the request asks for gzip and the response is measured before any
decoding. An earlier Node version of this measured the decompressed body
and reported it as gzipped, overstating the cost about threefold.

    python3 scripts/bench_gene_endpoints.py [--runs 10]
"""
import argparse
import gzip
import json
import os
import statistics
import time
import urllib.request

CASES = [
    ("page2 ESRD AFR", "/api/page2/rows?node=905&ancestry=afr&pvalue=1e-4"),
    ("page2 Obesity META", "/api/page2/rows?node=264&ancestry=meta&pvalue=1e-4"),
    ("page2 Asthma META", "/api/page2/rows?node=708&ancestry=meta&pvalue=1e-4"),
    ("page3 ESRD-588 AFR", "/api/page3/rows?left=905&right=913&ancestry=afr&pvalue=1e-4"),
    ("page3 Hyperlip-lipoid EUR", "/api/page3/rows?left=739&right=741&ancestry=eur&pvalue=1e-4"),
]
BASELINE, FEATURE = "http://localhost:3001", "http://localhost:3000"


def fetch(base, path):
    req = urllib.request.Request(base + path, headers={"Accept-Encoding": "gzip"})
    t = time.perf_counter()
    with urllib.request.urlopen(req) as r:
        body = r.read()                      # still compressed; urllib does not decode
        enc = r.headers.get("Content-Encoding", "identity")
    return (time.perf_counter() - t) * 1000, len(body), enc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=10)
    args = ap.parse_args()
    out, rows = {}, []
    for name, path in CASES:
        rec = {}
        for label, base in (("baseline", BASELINE), ("feature", FEATURE)):
            ms, size, enc = [], None, None
            for _ in range(args.runs):
                t, n, e = fetch(base, path)
                ms.append(t)
                size, enc = n, e
            ms.sort()
            rec[label] = {"median_ms": round(statistics.median(ms), 1),
                          "p90_ms": round(ms[min(len(ms) - 1, int(0.9 * (len(ms) - 1) + 0.5))], 1),
                          "transferred_bytes": size, "content_encoding": enc}
        b, f = rec["baseline"], rec["feature"]
        rec["latency_delta_pct"] = round(100 * (f["median_ms"] - b["median_ms"]) / b["median_ms"], 1)
        rec["payload_delta_pct"] = round(
            100 * (f["transferred_bytes"] - b["transferred_bytes"]) / b["transferred_bytes"], 1)
        out[name] = rec
        rows.append((name, b, f, rec))
        print(f"{name:26} lat {b['median_ms']:>6.0f} -> {f['median_ms']:>6.0f} ms "
              f"({rec['latency_delta_pct']:+6.1f}%)   "
              f"{b['transferred_bytes']/1024:>7.0f} -> {f['transferred_bytes']/1024:>7.0f} kB "
              f"({rec['payload_delta_pct']:+5.1f}%)  [{f['content_encoding']}]")
    lat = [r[3]["latency_delta_pct"] for r in rows]
    pay = [r[3]["payload_delta_pct"] for r in rows]
    print(f"\nlatency delta  range {min(lat):+.1f}% to {max(lat):+.1f}%   "
          f"(guideline: within 10% - {'MET' if max(abs(x) for x in lat) <= 10 else 'MISSED'})")
    print(f"payload delta  range {min(pay):+.1f}% to {max(pay):+.1f}%   "
          f"(guideline: under 5% - {'MET' if max(pay) < 5 else 'MISSED'})")
    dest = os.path.join("analysis", "examples", "results", "gene_labels_endpoints.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=1)
    print("wrote " + dest)


if __name__ == "__main__":
    main()
