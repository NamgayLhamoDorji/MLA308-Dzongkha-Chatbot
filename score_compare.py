"""Score a compare CSV without a human judge and count which translator wins.

  python score_compare.py compare_sentences.csv
  python score_compare.py compare.csv

Two automatic scores (chrF, 0 to 100, higher is better) are added for each translator:
  back_score : how close the round trip (translated, then translated back) is to your original
               sentence. It shows whether the meaning survived. It does not judge fluency.
  ref_score  : how close the output is to the text you typed in the "dzonext" column, if you filled
               it in. This uses DzoNext only as a reference to check against, not inside the chatbot.
The file <name>_scored.csv is written with an "auto_best" column, and the win counts are printed.
"""
import csv
import sys
from collections import Counter


def chrf(hyp, ref, n=6, beta=2.0):
    h, r = "".join(hyp.split()), "".join(ref.split())
    if not h or not r or hyp.startswith("(error") or ref.startswith("(error"):
        return 0.0
    ps, rs = [], []
    for k in range(1, n + 1):
        hc, rc = Counter(h[i:i + k] for i in range(len(h) - k + 1)), Counter(r[i:i + k] for i in range(len(r) - k + 1))
        if not hc or not rc:
            continue
        m = sum((hc & rc).values())
        ps.append(m / sum(hc.values()))
        rs.append(m / sum(rc.values()))
    if not ps:
        return 0.0
    p, rc_ = sum(ps) / len(ps), sum(rs) / len(rs)
    return 0.0 if p + rc_ == 0 else 100 * (1 + beta ** 2) * p * rc_ / (beta ** 2 * p + rc_)


def score(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    names = [c[5:] for c in rows[0] if c.startswith("back_")]
    wins, ref_wins, extra = Counter(), Counter(), []
    for row in rows:
        back = {n: chrf(row["back_" + n], row["source"]) for n in names}
        ref = {n: chrf(row[n], row["dzonext"]) for n in names} if row.get("dzonext", "").strip() else {}
        for n in names:
            row["back_score_" + n] = round(back[n], 1)
            row["ref_score_" + n] = round(ref[n], 1) if ref else ""
        best = max(names, key=lambda n: (back[n] + (ref[n] if ref else 0)))
        row["auto_best"] = best
        wins[best] += 1
        if ref:
            ref_wins[max(names, key=lambda n: ref[n])] += 1
    out = path.rsplit(".", 1)[0] + "_scored.csv"
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    avg = {n: sum(float(r["back_score_" + n]) for r in rows) / len(rows) for n in names}
    return out, wins, ref_wins, avg, len(rows)


if __name__ == "__main__":
    out, wins, ref_wins, avg, n = score(sys.argv[1])
    print(f"{n} sentences. Wrote {out}")
    print("Average back_score:", {k: round(v, 1) for k, v in avg.items()})
    print("Wins (round trip + dzonext if filled in):", dict(wins))
    if ref_wins:
        print("Wins against the dzonext column only:", dict(ref_wins))