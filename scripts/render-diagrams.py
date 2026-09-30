"""
Render docs/diagrams/*.mmd to docs/img/*.svg with headless Chrome + Mermaid (no npm install).
GitHub's inline Mermaid viewer fails intermittently, so the README embeds these static SVGs.
    python3 scripts/render-diagrams.py
"""
import glob, html, os, re, subprocess, tempfile

CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PAGE = """<!doctype html><html><body style="margin:0;background:#fff">
<pre class="mermaid">{src}</pre>
<script type="module">
import m from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
m.initialize({{ startOnLoad: false, theme: "default", htmlLabels: false, flowchart: {{ htmlLabels: false }}, fontFamily: "Helvetica, Arial, sans-serif" }});
await m.run({{ querySelector: ".mermaid" }});
// Serialize as XML (valid for <img>) and expose it as text for --dump-dom.
const xml = new XMLSerializer().serializeToString(document.querySelector("svg"));
const ta = document.createElement("textarea"); ta.id = "out"; ta.textContent = xml;
document.body.replaceChildren(ta);
</script></body></html>"""

with tempfile.TemporaryDirectory() as tmp:
    for src in sorted(glob.glob("docs/diagrams/*.mmd")):
        name = os.path.splitext(os.path.basename(src))[0]
        page = os.path.join(tmp, f"{name}.html")
        open(page, "w").write(PAGE.format(src=html.escape(open(src).read())))
        dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=20000", "--dump-dom", f"file://{page}"],
                             capture_output=True, text=True, timeout=120).stdout
        m = re.search(r'<textarea id="out">([\s\S]*?)</textarea>', dom)
        if not m:
            raise SystemExit(f"no svg rendered for {name}")
        svg = html.unescape(m.group(1))
        # A standalone <img> needs an intrinsic size: use the viewBox, drop the responsive width.
        vb = re.search(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"', svg)
        w, h = float(vb.group(3)), float(vb.group(4))
        root, rest = svg.split(">", 1)
        root = re.sub(r'\s(?:width|height|style)="[^"]*"', "", root)
        svg = root + ">" + rest
        # White background so the diagram stays readable in GitHub dark mode.
        svg = svg.replace("<svg ", f'<svg width="{w:.0f}" height="{h:.0f}" style="background:#ffffff" ', 1)
        open(f"docs/img/{name}.svg", "w").write(svg)
        print(f"docs/img/{name}.svg  {w:.0f}x{h:.0f}")
