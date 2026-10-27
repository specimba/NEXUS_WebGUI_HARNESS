# r622: reconstruct the Oct-26 DB from the WAL alone.
# Theory: the rollback replaced the true main file with the Sep-14 snapshot,
# invalidating the pair. WAL frame validity is checked via the WAL header's
# salt chain + per-frame checksums — NOT against main's content. A blank main
# with the matching page size lets recovery replay the entire WAL.
import sqlite3, os, struct, shutil, sys

DBDIR = "/home/z/my-project/db"
WAL = f"{DBDIR}/custom.db-wal"
WORK = "/home/z/my-project/.zscripts/dbtest/rebuild"
os.makedirs(WORK, exist_ok=True)

# 1) read the WAL header: magic (0x377f0682/0x377f0683), page size @ bytes 8-11
with open(WAL, "rb") as f:
    hdr = f.read(32)
magic, version, pagesz, ckpt_seq, salt1, salt2, ck1, ck2 = struct.unpack(">8I", hdr)
print(f"[wal-header] magic=0x{magic:08x} version={version} page_size={pagesz} ckpt_seq={ckpt_seq}")
assert magic in (0x377F0682, 0x377F0683), "not a WAL file"
assert pagesz in (512, 1024, 2048, 4096, 8192, 16384, 32768, 65536), f"bad page size {pagesz}"

main = f"{WORK}/custom.db"
for suf in ("", "-wal", "-shm"):
    p = main + suf
    if os.path.exists(p):
        os.remove(p)

# 2) craft a blank main with the matching page size (a throwaway table makes
#    the header real; its data page is irrelevant — WAL pages will shadow it)
con = sqlite3.connect(main)
con.execute(f"PRAGMA page_size={pagesz}")
con.execute("PRAGMA journal_mode=DELETE")  # avoid a new WAL of our own
con.execute("CREATE TABLE _bootstrap(x)")
con.execute("INSERT INTO _bootstrap VALUES (1)")
con.commit()
con.close()

# 3) drop the Oct WAL in place, then open and read
shutil.copy(WAL, main + "-wal")
try:
    con = sqlite3.connect(main)
    ic = con.execute("PRAGMA integrity_check;").fetchall()
    print("[rebuild integrity]", str(ic)[:120])
    tables = con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    print(f"[rebuild] tables={len(tables)}")
    for (name,) in tables:
        try:
            n = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            print(f"  ok {name}={n}")
        except Exception as e:
            print(f"  FAIL {name}: {str(e)[:80]}")
    con.close()
    sys.exit(0 if ic == [("ok",)] else 2)
except Exception as e:
    print(f"[rebuild] FAILED: {str(e)[:200]}")
    sys.exit(1)
