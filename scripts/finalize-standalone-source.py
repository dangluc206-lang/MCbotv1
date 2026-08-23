from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

pref = ROOT / 'src' / 'desktop' / 'DesktopPreferenceStore.js'
text = pref.read_text(encoding='utf-8')
if text.startswith('\\\n'):
    text = text[2:]
elif text.startswith('\\\r\n'):
    text = text[3:]
pref.write_text(text, encoding='utf-8')

# Remove this conversion-only helper before refreshing the baseline so the
# captured tree exactly matches the source ZIP delivered to the user.
Path(__file__).unlink(missing_ok=True)

baseline = subprocess.run(
    ['node', 'scripts/inspect-architecture-baseline.js'],
    cwd=ROOT,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    check=True,
).stdout
(ROOT / 'architecture' / 'baseline' / 'current.json').write_text(baseline.rstrip() + '\n', encoding='utf-8')

report = subprocess.run(
    ['node', 'scripts/inspect-architecture-baseline.js', '--report'],
    cwd=ROOT,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    check=True,
).stdout
(ROOT / 'docs' / 'architecture-roadmap' / 'baseline' / 'WP-001_GAP_REPORT.md').write_text(report, encoding='utf-8')

print('Standalone source finalization complete.')
