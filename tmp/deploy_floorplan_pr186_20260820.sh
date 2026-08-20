set -euo pipefail
HOST=/home/lina/osobni-pamet/homeassistant/config
SRC=/home/lina/easy-floorplan-pr186-work/dist/easy-floorplan-card.js
LIVE="$HOST/www/easy-floorplan-card.js"
RES="$HOST/.storage/lovelace_resources"
DASH="$HOST/.storage/lovelace.linino_hnizdo"

OLD_SHA=9a7593a3f8f40e13056c1e16cd04b4db7477bfbded6b7b99cc4beca9dda7eaac
OLD_BYTES=388088
NEW_SHA=e018754278e11d91156ece9ae931b08f06506078cd59f260df92d6c5d3db6854
NEW_BYTES=404801
PRE_DOMEK=124244842ea73285efc2a8c4909429a1b49117c2ff3c6c2e6ced4c1b446fea51
PRE_CARD_NO_OVERLAY=199ee76b2fedb1e5d9588d9a12fcd996a694b1c0097fbfd9863c83e4d7f059c2
OLD_URL='/local/easy-floorplan-card.js?v=20260819-sunfix183-staticclosed1'
NEW_URL='/local/easy-floorplan-card.js?v=20260820-pr186-staticclosed1'

test -f "$SRC"
test -f "$LIVE"
test -f "$RES"
test -f "$DASH"
test "$(sha256sum "$SRC" | awk '{print $1}')" = "$NEW_SHA"
test "$(wc -c < "$SRC" | tr -d ' ')" = "$NEW_BYTES"
test "$(sha256sum "$LIVE" | awk '{print $1}')" = "$OLD_SHA"
test "$(wc -c < "$LIVE" | tr -d ' ')" = "$OLD_BYTES"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACK_JS="$LIVE.bak-pr186-$STAMP"
BACK_RES="$RES.bak-pr186-$STAMP"
BACK_DASH="$DASH.bak-pr186-$STAMP"
cp -a "$LIVE" "$BACK_JS"
cp -a "$RES" "$BACK_RES"
cp -a "$DASH" "$BACK_DASH"
echo "BACKUP_JS=$BACK_JS"
echo "BACKUP_RESOURCES=$BACK_RES"
echo "BACKUP_DASHBOARD=$BACK_DASH"

rollback() {
  rc=$?
  trap - ERR
  echo "FLOORPLAN_PR186_ROLLBACK_BEGIN rc=$rc"
  cp -a "$BACK_JS" "$LIVE"
  cp -a "$BACK_RES" "$RES"
  cp -a "$BACK_DASH" "$DASH"
  echo "FLOORPLAN_PR186_ROLLBACK_DONE"
  exit "$rc"
}
trap rollback ERR

python3 - "$DASH" "$RES" "$PRE_DOMEK" "$PRE_CARD_NO_OVERLAY" "$OLD_URL" "$NEW_URL" <<'PY'
import json, hashlib, os, sys, tempfile
from pathlib import Path

dash_path = Path(sys.argv[1])
res_path = Path(sys.argv[2])
pre_domek = sys.argv[3]
pre_card_no_overlay = sys.argv[4]
old_url = sys.argv[5]
new_url = sys.argv[6]

def load(p):
    return json.loads(p.read_text(encoding="utf-8"))

def walk(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)

def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

def sha(x):
    return hashlib.sha256(canon(x)).hexdigest()

def get_card(data):
    cards = [x for x in walk(data) if x.get("type") == "custom:easy-floorplan-card"]
    assert len(cards) == 1, f"floorplan cards={len(cards)}"
    return cards[0]

def get_domek(card):
    floors = {f.get("id"): f for f in card.get("floors", []) if isinstance(f, dict)}
    assert "domek" in floors, f"floor ids={list(floors)}"
    return floors["domek"]

def assert_invariants(card, domek, overlay_expected):
    assert sha(domek) == pre_domek, (sha(domek), pre_domek)
    clean = dict(card)
    clean.pop("overlayScale", None)
    assert sha(clean) == pre_card_no_overlay, (sha(clean), pre_card_no_overlay)
    if overlay_expected is None:
        assert "overlayScale" not in card
    else:
        assert card.get("overlayScale") == overlay_expected
    assert card.get("sunlight") is True
    assert card.get("sunDimming") is True
    assert card.get("north") == 0
    assert "sunBearing" not in card
    assert card.get("offlineStyle") == "strike"
    assert "compactHeader" not in card

    doors = [x for x in walk(domek) if x.get("id") == "door_pcltbs3"]
    assert len(doors) == 1
    door = doors[0]
    assert door.get("staticClosed") is True
    assert door.get("glazed") is True
    assert "sunlight" not in door

    items = {x.get("id"): x for x in domek.get("items", []) if isinstance(x, dict)}
    k = items.get("item_markvarec_krevetarium")
    assert k is not None
    assert k.get("entity") == "switch.loznice_krevetarium_osvetleni"
    assert k.get("angle") == 300
    assert k.get("glow") is True
    assert k.get("glowRadius") == 70
    assert k.get("glowColor") == "#808080"

    tv = items.get("item_markvarec_tv")
    assert tv is not None
    assert tv.get("entity") == "media_player.loznice_televize_google_tv"
    assert tv.get("showState") is False

def atomic_write_json(path, obj):
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode)
        try:
            os.chown(tmp, st.st_uid, st.st_gid)
        except PermissionError:
            pass
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

dash = load(dash_path)
res = load(res_path)
card = get_card(dash)
domek = get_domek(card)
assert_invariants(card, domek, None)

resource_objs = [
    x for x in walk(res)
    if isinstance(x.get("url"), str) and "easy-floorplan-card.js" in x["url"]
]
assert len(resource_objs) == 1, [x.get("url") for x in resource_objs]
assert resource_objs[0]["url"] == old_url, resource_objs[0]["url"]

print("PRE_DOMEK_SHA=" + sha(domek))
print("PRE_CARD_NO_OVERLAY_SHA=" + sha({k:v for k,v in card.items() if k != "overlayScale"}))
print("PRE_RESOURCE_URL=" + resource_objs[0]["url"])

resource_objs[0]["url"] = new_url
card["overlayScale"] = "plan"
atomic_write_json(res_path, res)
atomic_write_json(dash_path, dash)

dash2 = load(dash_path)
res2 = load(res_path)
card2 = get_card(dash2)
domek2 = get_domek(card2)
assert_invariants(card2, domek2, "plan")
urls2 = [
    x.get("url") for x in walk(res2)
    if isinstance(x.get("url"), str) and "easy-floorplan-card.js" in x["url"]
]
assert urls2 == [new_url], urls2
print("POST_STORAGE_DOMEK_SHA=" + sha(domek2))
print("POST_STORAGE_OVERLAY_SCALE=" + str(card2.get("overlayScale")))
print("POST_STORAGE_RESOURCE_URL=" + urls2[0])
PY

TMP="$LIVE.tmp-pr186-$$"
cp "$SRC" "$TMP"
chmod --reference="$LIVE" "$TMP"
chown --reference="$LIVE" "$TMP" 2>/dev/null || true
mv -f "$TMP" "$LIVE"
test "$(sha256sum "$LIVE" | awk '{print $1}')" = "$NEW_SHA"
test "$(wc -c < "$LIVE" | tr -d ' ')" = "$NEW_BYTES"
node --check "$LIVE"

set +e
CFG_OUT="$(docker exec homeassistant python3 -m homeassistant --script check_config --config /config 2>&1)"
CFG_RC=$?
set -e
printf '%s\n' "$CFG_OUT"
echo "CHECK_CONFIG_RC=$CFG_RC"
test "$CFG_RC" -eq 0
if printf '%s\n' "$CFG_OUT" | grep -Eiq 'could not be validated and has been disabled|configuration invalid|invalid config|error loading|failed to validate'; then
  echo "CHECK_CONFIG_TEXT_REJECTED"
  exit 41
fi
echo "CHECK_CONFIG_TEXT_OK"

python3 - "$DASH" "$RES" "$LIVE" "$PRE_DOMEK" "$PRE_CARD_NO_OVERLAY" "$NEW_URL" "$NEW_SHA" "$NEW_BYTES" <<'PY'
import json, hashlib, sys
from pathlib import Path

dash_path, res_path, js_path = map(Path, sys.argv[1:4])
pre_domek, pre_card_no_overlay, new_url, new_sha, new_bytes = sys.argv[4:9]

def walk(x):
    if isinstance(x, dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x, list):
        for v in x: yield from walk(v)

def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
def sha(x): return hashlib.sha256(canon(x)).hexdigest()

dash=json.loads(dash_path.read_text(encoding="utf-8"))
res=json.loads(res_path.read_text(encoding="utf-8"))
cards=[x for x in walk(dash) if x.get("type")=="custom:easy-floorplan-card"]
assert len(cards)==1
c=cards[0]
floors={f.get("id"):f for f in c.get("floors",[]) if isinstance(f,dict)}
domek=floors["domek"]
clean=dict(c); clean.pop("overlayScale",None)
assert sha(domek)==pre_domek
assert sha(clean)==pre_card_no_overlay
assert c.get("overlayScale")=="plan"
assert c.get("sunlight") is True and c.get("sunDimming") is True and c.get("north")==0
assert "sunBearing" not in c and c.get("offlineStyle")=="strike" and "compactHeader" not in c
doors=[x for x in walk(domek) if x.get("id")=="door_pcltbs3"]
assert len(doors)==1 and doors[0].get("staticClosed") is True and doors[0].get("glazed") is True and "sunlight" not in doors[0]
items={x.get("id"):x for x in domek.get("items",[]) if isinstance(x,dict)}
k=items["item_markvarec_krevetarium"]
assert (k.get("entity"),k.get("angle"),k.get("glow"),k.get("glowRadius"),k.get("glowColor"))==("switch.loznice_krevetarium_osvetleni",300,True,70,"#808080")
tv=items["item_markvarec_tv"]
assert tv.get("showState") is False
urls=[x.get("url") for x in walk(res) if isinstance(x.get("url"),str) and "easy-floorplan-card.js" in x["url"]]
assert urls==[new_url],urls
jsb=js_path.read_bytes()
assert hashlib.sha256(jsb).hexdigest()==new_sha
assert len(jsb)==int(new_bytes)
print("LIVE_JS_SHA=" + hashlib.sha256(jsb).hexdigest())
print("LIVE_JS_BYTES=" + str(len(jsb)))
print("LIVE_RESOURCE_URL=" + urls[0])
print("LIVE_OVERLAY_SCALE=" + c["overlayScale"])
print("LIVE_DOMEK_SHA=" + sha(domek))
print("LIVE_CARD_NO_OVERLAY_SHA=" + sha(clean))
print("LIVE_GLOBALS=" + json.dumps({
    "sunlight":c.get("sunlight"),
    "sunDimming":c.get("sunDimming"),
    "north":c.get("north"),
    "sunBearing":"<unset>" if "sunBearing" not in c else c.get("sunBearing"),
    "offlineStyle":c.get("offlineStyle"),
    "compactHeader":"<unset>" if "compactHeader" not in c else c.get("compactHeader"),
},ensure_ascii=False,sort_keys=True))
print("LIVE_DOOR=" + json.dumps(doors[0],ensure_ascii=False,sort_keys=True))
print("LIVE_KREVETARIUM=" + json.dumps({q:k.get(q) for q in ("entity","x","y","angle","glow","glowRadius","glowColor")},ensure_ascii=False,sort_keys=True))
print("LIVE_TV=" + json.dumps({q:tv.get(q,"<unset>") for q in ("entity","x","y","angle","showState")},ensure_ascii=False,sort_keys=True))
PY

echo "HA_RUNNING=$(docker inspect -f '{{.State.Running}}' homeassistant)"
test "$(docker inspect -f '{{.State.Running}}' homeassistant)" = "true"
echo "FLOORPLAN_PR186_DEPLOY_VALIDATED"
trap - ERR
nohup sh -c 'sleep 15; docker restart homeassistant >/tmp/floorplan-pr186-restart.log 2>&1' >/dev/null 2>&1 &
echo "FLOORPLAN_PR186_RESTART_SCHEDULED"
