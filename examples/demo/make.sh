#!/bin/sh
# Builds ~/sir-demo: a git project whose patch shows every state of the editor feedback.
# Open the folder in the Extension Development Host, then open src/main.py.sirp.
set -e
D="${1:-$HOME/sir-demo}"
rm -rf "$D" && mkdir -p "$D/src" && cd "$D"
echo '{ "version": 3, "generate": { "base": { "head": true } } }' > sir.config.json
cat > src/main.py <<'P'
def hello():
    return "hello"


def middle():
    return 2


def bye():
    return "bye"
P
git init -q -b main && git add . && git -c user.name=d -c user.email=d@d commit -qm base
# the edited code: three changes, one per function
cat > src/main.py <<'P'
def hello():
    return "hello, world"


def middle():
    return 20


def bye():
    return "goodbye"
P
${SIR:-sir} generate --in src/main.py --head --out src/main.py.sirp >/dev/null
# 2 drifted: the code moves on after the patch was made
sed -i.bak 's/return 20/return 99/' src/main.py
# 3 broken: the base no longer has what the patch anchors on (the patch is edited by hand)
sed -i.bak 's/return "bye"/return "farewell"/' src/main.py.sirp
rm -f src/*.bak
echo "ready: $D  (open src/main.py.sirp)"
