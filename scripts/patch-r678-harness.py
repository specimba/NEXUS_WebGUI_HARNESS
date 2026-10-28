import pathlib
p = pathlib.Path("scripts/cdp-qa-golden-r673.mjs")
s = p.read_text()

old_read = '''  const drift = await evalJs(ws, `(() => {
    const chips = [...document.querySelectorAll("span[title]")];
    const led = chips.find((el) => (el.textContent ?? "").includes("\\u29c9 ledger"));'''
# the file holds the literal glyph, not the escape — match on the literal
old_read = old_read.replace("\\u29c9", "\u29c9")
if old_read not in s:
    raise SystemExit("PATCH-FAIL: drift read block not found")
new_read = '''  let drift = { found: false };
  for (let attempt = 0; attempt < 8 && drift.found !== true; attempt++) {
    drift = await evalJs(ws, `(() => {
    const chips = [...document.querySelectorAll("span[title]")];
    const led = chips.find((el) => (el.textContent ?? "").includes("\u29c9 ledger"));'''
s = s.replace(old_read, new_read, 1)

old_tail = '''  })()`);
  results.push(["P4 ledger-drift-witness"'''
new_tail = '''    })()`);
    if (drift.found !== true) await sleep(1300);
  }
  results.push(["P4 ledger-drift-witness"'''
if old_tail not in s:
    raise SystemExit("PATCH-FAIL: drift tail not found")
s = s.replace(old_tail, new_tail, 1)

old_json = "p1, p2, drift, results:"
if old_json not in s:
    raise SystemExit("PATCH-FAIL: json line not found")
s = s.replace(old_json, "p1, p2, boardMode, drift, results:", 1)

p.write_text(s)
print("PATCH-OK")
