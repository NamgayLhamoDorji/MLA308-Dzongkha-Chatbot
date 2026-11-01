"""Compare translators on your own test sentences and write a CSV file.

  python compare_translators.py sentences.txt          # English sentences  -> Dzongkha
  python compare_translators.py dz_sentences.txt --dz  # Dzongkha sentences -> English
  Add --kinley and/or --nllb13 to include those models. Copy your old compare_*.csv first: a new run overwrites it.

Open the CSV (compare_en2dz.csv or compare_dz2en.csv) in Excel. Type each sentence into https://nlp.cst.edu.bt/nmt/ (DzoNext),
paste the result in the dzonext column, then write the best one in "best".
The back_* columns translate the result back, so you can spot meaning that was lost.
"""
import csv
import os
import sys

from translate import google_backend, nllb_backend


def run(sentences, src, tgt, backends, out_path="compare.csv"):
    back = {"dz": "en", "en": "dz"}[tgt]
    rows = []
    for s in sentences:
        row = {"source": s}
        for name, make in backends.items():
            try:
                t = make(src, tgt)(s)
                try:
                    b = make(tgt, back)(t)
                except Exception as e:
                    b = f"(error: {e})"
            except Exception as e:
                t, b = f"(error: {e})", ""
            row[name], row["back_" + name] = t, b
        row["dzonext"], row["best"] = "", ""
        rows.append(row)
    cols = ["source"] + [c for n in backends for c in (n, "back_" + n)] + ["dzonext", "best"]
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    return rows


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src, tgt = ("dz", "en") if "--dz" in sys.argv else ("en", "dz")
    path = args[0] if args else "sentences.txt"
    lines = [l.strip() for l in open(path, encoding="utf-8-sig") if l.strip()]
    backends = {"google": google_backend, "nllb": nllb_backend}
    if "--kinley" in sys.argv:   # community model fine-tuned on about 225K Dzongkha-English pairs (CC BY-NC 4.0)
        backends["kinley"] = lambda s, t: nllb_backend(s, t, "kinleyrabgay/nllb-200-600M-dzo-eng-300k")
    if "--nllb13" in sys.argv:   # Meta's larger NLLB (about 5 GB download, needs several GB of RAM)
        backends["nllb13"] = lambda s, t: nllb_backend(s, t, "facebook/nllb-200-distilled-1.3B")
    stem = os.path.splitext(os.path.basename(path))[0]
    out = f"compare_{stem}.csv"   # one output file per input file, so runs never overwrite each other
    run(lines, src, tgt, backends, out)
    print(f"Wrote {out} with {len(lines)} sentences. Fill the dzonext and best columns by hand.")