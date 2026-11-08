# autonag's mascot as client/mascot.wac: shrunk to twice the 130 pixels it is shown at, as a data: URI — a built
# page's policy allows images from data: and blob: and nothing else.
#     python3 tools/gen_mascot.py ../autonag/client/src/assets/mascot.png
import base64, io, sys
from PIL import Image
im = Image.open(sys.argv[1])
im.thumbnail((260, 260), Image.LANCZOS)
buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
open('client/assets/mascot.png', 'wb').write(buf.getvalue())
s = base64.b64encode(buf.getvalue()).decode()
open('client/mascot.wac', 'w').write("// autonag's mascot, at twice the size it is shown, as the data: URI a page's policy allows (client/assets/mascot.png;\n// written by tools/gen_mascot.py).\n\nexport static string MASCOT = \"data:image/png;base64," + s + "\";\n")
