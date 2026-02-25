import re

with open("app/routes/app._index.tsx", "r") as f:
    content = f.read()

content = content.replace("defer, Await } from \"react-router\";", "Await } from \"react-router\";")
content = content.replace("return defer({", "return {")
content = content.replace("  });\n};", "  };\n};")

with open("app/routes/app._index.tsx", "w") as f:
    f.write(content)

