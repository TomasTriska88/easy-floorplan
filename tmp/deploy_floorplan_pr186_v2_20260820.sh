set -euo pipefail
C=homeassistant
SRC=/home/lina/easy-floorplan-pr186-work/dist/easy-floorplan-card.js
LIVE=/config/www/easy-floorplan-card.js
RES=/config/.storage/lovelace_resources
DASH=/config/.storage/lovelace.linino_hnizdo

OLD_SHA=9a7593a3f8f40e13056c1e16cd04b4db7477bfbded6b7b99cc4beca9dda7eaac
OLD_BYTES=388088
NEW_SHA=e018754278e11d91156ece9ae931b08f06506078cd59f260df92d6c5d3db6854
NEW_BYTES=404801
PRE_DOMEK=124244842ea73285efc2a8c4909429a1b49117c2ff3c6c2e6ced4c1b446fea51
PRE_CARD_NO_OVERLAY=199ee76b2fedb1e5d9588d9a12fcd996a694b1c0097fbfd9863c83e4d7f059c2
OLD_URL='/local/easy-floorplan-card.js?v=20260819-sunfix183-staticclosed1'
NEW_URL='/local/easy-floorplan-card.js?v=20260820-pr186-staticclosed1'

test -f "$SRC"
test "$(sha256sum "$SRC" | awk '{print $1}')" = "$NEW_SHA"
test "$(wc -c < "$SRC" | tr -d ' ')" = "$NEW_BYTES"
node --check "$SRC"
test "$(docker inspect -f '{{.State.Running}}' "$C")" = "true"

docker exec "$C" sh -c "test -f '$LIVE' && test -f '$RES' && test -f '$DASH'"
test "$(docker exec "$C" sha256sum "$LIVE" | awk '{print $1}')" = "$OLD_SHA"
test "$(docker exec "$C" wc -c "$LIVE" | awk '{print $1}')" = "$OLD_BYTES"

docker exec -i "$C" python3 - "$DASH" "$RES" "$PRE_DOMEK" "$PRE_CARD_NO_OVERLAY" "$OLD_URL" <<'PY'
import json, hashlib, sys
from pathlib import Path

dash_path=Path(sys.argv[1]); res_path=Path(sys.argv[2])
pre_domek=sys.argv[3]; pre_card_no_overlay=sys.argv[4]; old_url=sys.argv[5]

def walk(x):
    if isinstance(x,dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x,list):
        for v in x: yield from walk(v)

def canon(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")

def sha(x): return hashlib.sha256(canon(x)).hexdigest()

dash=json.loads(dash_path.read_text(encoding="utf-8"))
res=json.loads(res_path.read_text(encoding="utf-8"))
cards=[x for x in walk(dash) if x.get("type")=="custom:easy-floorplan-card"]
assert len(cards)==1, len(cards)
c=cards[0]
floors={f.get("id"):f for f in c.get("floors",[]) if isinstance(f,dict)}
domek=floors["domek"]
clean=dict(c); clean.pop("overlayScale",None)
assert sha(domek)==pre_domek,(sha(domek),pre_domek)
assert sha(clean)==pre_card_no_overlay,(sha(clean),pre_card_no_overlay)
assert "overlayScale" not in c
assert c.get("sunlight") is True
assert c.get("sunDimming") is True
assert c.get("north")==0
assert "sunBearing" not in c
assert c.get("offlineStyle")=="strike"
assert "compactHeader" not in c
doors=[x for x in walk(domek) if x.get("id")=="door_pcltbs3"]
assert len(doors)==1
door=doors[0]
assert door.get("staticClosed") is True
assert door.get("glazed") is True
assert "sunlight" not in door
items={x.get("id"):x for x in domek.get("items",[]) if isinstance(x,dict)}
k=items["item_markvarec_krevetarium"]
assert (k.get("entity"),k.get("angle"),k.get("glow"),k.get("glowRadius"),k.get("glowColor"))==("switch.loznice_krevetarium_osvetleni",300,True,70,"#808080")
tv=items["item_markvarec_tv"]
assert tv.get("entity")=="media_player.loznice_televize_google_tv"
assert tv.get("showState") is False
urls=[x.get("url") for x in walk(res) if isinstance(x.get("url"),str) and "easy-floorplan-card.js" in x["url"]]
assert urls==[old_url],urls
print("PRE_DOMEK_SHA="+sha(domek))
print("PRE_CARD_NO_OVERLAY_SHA="+sha(clean))
print("PRE_RESOURCE_URL="+urls[0])
print("PRE_OVERLAY_SCALE=<unset>")
PY

STAMP="$(date +%Y%m%d-%H%M%S)"
BACK_JS="$LIVE.bak-pr186-$STAMP"
BACK_RES="$RES.bak-pr186-$STAMP"
BACK_DASH="$DASH.bak-pr186-$STAMP"
docker exec "$C" cp -a "$LIVE" "$BACK_JS"
docker exec "$C" cp -a "$RES" "$BACK_RES"
docker exec "$C" cp -a "$DASH" "$BACK_DASH"
echo "BACKUP_JS=$BACK_JS"
echo "BACKUP_RESOURCES=$BACK_RES"
echo "BACKUP_DASHBOARD=$BACK_DASH"

TMP_IN="/tmp/easy-floorplan-card-pr186-$$.js"
rollback() {
  rc=$?
  trap - ERR
  echo "FLOORPLAN_PR186_ROLLBACK_BEGIN rc=$rc"
  docker exec "$C" cp -a "$BACK_JS" "$LIVE" || true
  docker exec "$C" cp -a "$BACK_RES" "$RES" || true
  docker exec "$C" cp -a "$BACK_DASH" "$DASH" || true
  docker exec "$C" rm -f "$TMP_IN" >/dev/null 2>&1 || true
  echo "FLOORPLAN_PR186_ROLLBACK_DONE"
  exit "$rc"
}
trap rollback ERR

docker exec -i "$C" python3 - "$DASH" "$RES" "$PRE_DOMEK" "$PRE_CARD_NO_OVERLAY" "$OLD_URL" "$NEW_URL" <<'PY'
import json, hashlib, os, sys, tempfile
from pathlib import Path

dash_path=Path(sys.argv[1]); res_path=Path(sys.argv[2])
pre_domek=sys.argv[3]; pre_card_no_overlay=sys.argv[4]
old_url=sys.argv[5]; new_url=sys.argv[6]

def walk(x):
    if isinstance(x,dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x,list):
        for v in x: yield from walk(v)

def canon(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")

def sha(x): return hashlib.sha256(canon(x)).hexdigest()

def atomic_write(path,obj):
    st=path.stat()
    fd,tmp=tempfile.mkstemp(prefix=path.name+".tmp.",dir=str(path.parent))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(obj,f,ensure_ascii=False,separators=(",",":"))
            f.flush(); os.fsync(f.fileno())
        os.chmod(tmp,st.st_mode)
        try: os.chown(tmp,st.st_uid,st.st_gid)
        except PermissionError: pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

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
assert "overlayScale" not in c
resource_objs=[x for x in walk(res) if isinstance(x.get("url"),str) and "easy-floorplan-card.js" in x["url"]]
assert len(resource_objs)==1
assert resource_objs[0]["url"]==old_url
resource_objs[0]["url"]=new_url
c["overlayScale"]="plan"
atomic_write(res_path,res)
atomic_write(dash_path,dash)

dash2=json.loads(dash_path.read_text(encoding="utf-8"))
res2=json.loads(res_path.read_text(encoding="utf-8"))
cards2=[x for x in walk(dash2) if x.get("type")=="custom:easy-floorplan-card"]
assert len(cards2)==1
c2=cards2[0]
floors2={f.get("id"):f for f in c2.get("floors",[]) if isinstance(f,dict)}
domek2=floors2["domek"]
clean2=dict(c2); clean2.pop("overlayScale",None)
assert sha(domek2)==pre_domek
assert sha(clean2)==pre_card_no_overlay
assert c2.get("overlayScale")=="plan"
assert c2.get("sunlight") is True and c2.get("sunDimming") is True and c2.get("north")==0
assert "sunBearing" not in c2 and c2.get("offlineStyle")=="strike" and "compactHeader" not in c2
doors=[x for x in walk(domek2) if x.get("id")=="door_pcltbs3"]
assert len(doors)==1 and doors[0].get("staticClosed") is True and doors[0].get("glazed") is True and "sunlight" not in doors[0]
items={x.get("id"):x for x in domek2.get("items",[]) if isinstance(x,dict)}
k=items["item_markvarec_krevetarium"]
assert (k.get("entity"),k.get("angle"),k.get("glow"),k.get("glowRadius"),k.get("glowColor"))==("switch.loznice_krevetarium_osvetleni",300,True,70,"#808080")
tv=items["item_markvarec_tv"]
assert tv.get("showState") is False
urls=[x.get("url") for x in walk(res2) if isinstance(x.get("url"),str) and "easy-floorplan-card.js" in x["url"]]
assert urls==[new_url],urls
print("POST_STORAGE_DOMEK_SHA="+sha(domek2))
print("POST_STORAGE_CARD_NO_OVERLAY_SHA="+sha(clean2))
print("POST_STORAGE_OVERLAY_SCALE="+c2["overlayScale"])
print("POST_STORAGE_RESOURCE_URL="+urls[0])
PY

docker cp "$SRC" "$C:$TMP_IN"
test "$(docker exec "$C" sha256sum "$TMP_IN" | awk '{print $1}')" = "$NEW_SHA"
test "$(docker exec "$C" wc -c "$TMP_IN" | awk '{print $1}')" = "$NEW_BYTES"
docker exec "$C" cp "$TMP_IN" "$LIVE"
docker exec "$C" rm -f "$TMP_IN"
test "$(docker exec "$C" sha256sum "$LIVE" | awk '{print $1}')" = "$NEW_SHA"
test "$(docker exec "$C" wc -c "$LIVE" | awk '{print $1}')" = "$NEW_BYTES"

set +e
CFG_OUT="$(docker exec "$C" python3 -m homeassistant --script check_config --config /config 2>&1)"
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

docker exec -i "$C" python3 - "$DASH" "$RES" "$LIVE" "$PRE_DOMEK" "$PRE_CARD_NO_OVERLAY" "$NEW_URL" "$NEW_SHA" "$NEW_BYTES" <<'PY'
import json, hashlib, sys
from pathlib import Path

dash_path=Path(sys.argv[1]); res_path=Path(sys.argv[2]); js_path=Path(sys.argv[3])
pre_domek=sys.argv[4]; pre_card_no_overlay=sys.argv[5]
new_url=sys.argv[6]; new_sha=sys.argv[7]; new_bytes=int(sys.argv[8])

def walk(x):
    if isinstance(x,dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x,list):
        for v in x: yield from walk(v)

def canon(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")

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
assert c.get("sunlight") is True
assert c.get("sunDimming") is True
assert c.get("north")==0
assert "sunBearing" not in c
assert c.get("offlineStyle")=="strike"
assert "compactHeader" not in c
doors=[x for x in walk(domek) if x.get("id")=="door_pcltbs3"]
assert len(doors)==1
door=doors[0]
assert door.get("staticClosed") is True and door.get("glazed") is True and "sunlight" not in door
items={x.get("id"):x for x in domek.get("items",[]) if isinstance(x,dict)}
k=items["item_markvarec_krevetarium"]
assert (k.get("entity"),k.get("angle"),k.get("glow"),k.get("glowRadius"),k.get("glowColor"))==("switch.loznice_krevetarium_osvetleni",300,True,70,"#808080")
tv=items["item_markvarec_tv"]
assert tv.get("showState") is False
urls=[x.get("url") for x in walk(res) if isinstance(x.get("url"),str) and "easy-floorplan-card.js" in x["url"]]
assert urls==[new_url],urls
jsb=js_path.read_bytes()
assert hashlib.sha256(jsb).hexdigest()==new_sha
assert len(jsb)==new_bytes
print("LIVE_JS_SHA="+hashlib.sha256(jsb).hexdigest())
print("LIVE_JS_BYTES="+str(len(jsb)))
print("LIVE_RESOURCE_URL="+urls[0])
print("LIVE_OVERLAY_SCALE="+c["overlayScale"])
print("LIVE_DOMEK_SHA="+sha(domek))
print("LIVE_CARD_NO_OVERLAY_SHA="+sha(clean))
print("LIVE_GLOBALS="+json.dumps({
    "sunlight":c.get("sunlight"),
    "sunDimming":c.get("sunDimming"),
    "north":c.get("north"),
    "sunBearing":"<unset>" if "sunBearing" not in c else c.get("sunBearing"),
    "offlineStyle":c.get("offlineStyle"),
    "compactHeader":"<unset>" if "compactHeader" not in c else c.get("compactHeader"),
},ensure_ascii=False,sort_keys=True))
print("LIVE_DOOR="+json.dumps(door,ensure_ascii=False,sort_keys=True))
print("LIVE_KREVETARIUM="+json.dumps({q:k.get(q) for q in ("entity","x","y","angle","glow","glowRadius","glowColor")},ensure_ascii=False,sort_keys=True))
print("LIVE_TV="+json.dumps({q:tv.get(q,"<unset>") for q in ("entity","x","y","angle","showState")},ensure_ascii=False,sort_keys=True))
PY

echo "HA_RUNNING=$(docker inspect -f '{{.State.Running}}' "$C")"
test "$(docker inspect -f '{{.State.Running}}' "$C")" = "true"
echo FLOORPLAN_PR186_DEPLOY_V2_VALIDATED
trap - ERR
nohup sh -c 'sleep 15; docker restart homeassistant >/tmp/floorplan-pr186-restart.log 2>&1' >/dev/null 2>&1 &
echo FLOORPLAN_PR186_RESTART_SCHEDULED
