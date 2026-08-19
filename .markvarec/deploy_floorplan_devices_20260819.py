import json, os, shutil
from pathlib import Path

p=Path("/config/.storage/lovelace.linino_hnizdo")
data=json.loads(p.read_text(encoding="utf-8"))

def walk(x):
    if isinstance(x,dict):
        yield x
        for v in x.values(): yield from walk(v)
    elif isinstance(x,list):
        for v in x: yield from walk(v)

cards=[x for x in walk(data) if x.get("type")=="custom:easy-floorplan-card" and x.get("title")=="Plán Markvarce"]
assert len(cards)==1, f"floorplan cards={len(cards)}"
c=cards[0]
assert c.get("sunDimming") is True
assert c.get("sunlight") is True
assert c.get("north")==0
assert "sunBearing" not in c
assert "compactHeader" not in c
doors=[x for x in walk(c) if x.get("id")=="door_pcltbs3"]
assert len(doors)==1 and doors[0].get("staticClosed") is True and doors[0].get("glazed") is True
assert "sunlight" not in doors[0]

floors={f.get("id"):f for f in c.get("floors",[])}
assert "domek" in floors and "pozemek" in floors

bak=p.with_name(p.name+".bak-floorplan-devices-"+os.environ["STAMP"])
shutil.copy2(p,bak)

def act(toggle=False):
    return {
      "tap_action":{"action":"toggle" if toggle else "more-info"},
      "hold_action":{"action":"more-info"}
    }

def item(i,e,x,y,k,n,state=False,toggle=False,secondary=None):
    d={"id":i,"entity":e,"x":x,"y":y,"kind":k,"name":n,"size":36,
       "display":"badge","badgeContent":"icon","showName":True,"showState":state,
       "hideWhenInactive":False}
    d.update(act(toggle))
    if secondary: d["secondaryEntity"]=secondary
    return d

def upsert(floor,new):
    items=floor.setdefault("items",[])
    found=[x for x in items if x.get("id")==new["id"]]
    assert len(found)<=1, new["id"]
    if found:
        old=found[0]
        pos={k:old[k] for k in ("x","y","angle") if k in old}
        old.clear(); old.update(new); old.update(pos)
    else:
        assert all(x.get("entity")!=new["entity"] for x in items), f"entity duplicate {new['entity']}"
        items.append(new)

c["offlineStyle"]="strike"

d=floors["domek"]
# Existing fan: preserve its position/rotation and interaction, add a useful second reading/name.
fans=[x for x in d.get("items",[]) if x.get("id")=="item_9zaj9cc"]
assert len(fans)==1
fans[0]["secondaryEntity"]="sensor.loznice_vetrak_vykon"
fans[0]["showName"]=True
fans[0]["showState"]=True

for x in [
 item("item_markvarec_loznice_svetlo","light.loznice_svetlo",1040,350,"light","Světlo (ložnice)",False,True),
 item("item_markvarec_primotop","climate.primotop_loznice",1010,410,"climate","Přímotop",True,False,"sensor.primotop_v_loznici_vykon"),
 item("item_markvarec_krevetarium","switch.loznice_krevetarium_osvetleni",1080,455,"switch","Krevetárium",True,True,"sensor.vanocni_osvetleni_vykon"),
 item("item_markvarec_loznice_pritomnost","binary_sensor.tze284_rvnbnvw8_ts0601",900,365,"binary_sensor","Přítomnost – ložnice",True),
 item("item_markvarec_nest","media_player.loznice_google_nest_mini",920,245,"media_player","Google Nest Mini",True),
 item("item_markvarec_tv","media_player.loznice_televize_google_tv",1000,245,"media_player","Televize",True),
 item("item_markvarec_sencor_loznice","sensor.sencor_loznice_teplota",960,385,"sensor","Sencor – ložnice",True),
 item("item_markvarec_starlink","sensor.sonoff_s60zbtpf_vykon",875,430,"sensor","Starlink – příkon",True),
 item("item_markvarec_sencor_technicka","sensor.sencor_technicka_teplota",690,455,"sensor","Sencor – technická",True),
 item("item_markvarec_vnitrni_rozvadec","sensor.vnitrni_rozvadec_vykon",625,520,"sensor","Vnitřní rozvaděč",True),
 item("item_markvarec_loznicovy_rozvadec","sensor.loznicovy_rozvadec_vykon",700,535,"sensor","Ložnicový rozvaděč",True),
 item("item_markvarec_jezirkovy_rozvadec","sensor.jezirko_rozvadec_vykon",775,550,"sensor","Jezírkový rozvaděč",True),
]: upsert(d,x)

z=floors["pozemek"]
for x in [
 item("item_markvarec_camera_dvur","camera.dvur",180,180,"camera","Kamera – dvůr",True),
 item("item_markvarec_camera_branka","camera.branka_live",400,180,"camera","Kamera – branka",True,False,"sensor.branka_baterie"),
 item("item_markvarec_camera_voliera","camera.voliera",620,180,"camera","Kamera – voliéra",True),
 item("item_markvarec_reflektor","light.drubezi_vybeh_drubezi_vybeh",840,180,"light","Voliéra – reflektor",True,True),
 item("item_markvarec_radar_voliera","binary_sensor.voliera_pritomnost_drubeze",1060,180,"binary_sensor","Voliéra – aktivita",True),
 item("item_markvarec_nous_krepelky","sensor.nous_e6_temperature",280,360,"sensor","NOUS E6 – křepelky",True,False,"sensor.nous_e6_humidity"),
 item("item_markvarec_kurnik_teplota","sensor.sonoff_snzb_02d_teplota",560,360,"sensor","SONOFF – kurník",True,False,"sensor.sonoff_snzb_02d_vlhkost_vzduchu"),
 item("item_markvarec_meteostanice","sensor.sencor_slunecni_zareni",840,360,"sensor","Meteostanice Sencor",True),
 item("item_markvarec_jezirko_filtrace","sensor.jezirko_stav_cisteni",1080,360,"sensor","Jezírko – filtrace",True),
 item("item_markvarec_destovka_cerpadlo","switch.zahrada_cerpadlo_destovka",1320,360,"switch","Čerpadlo dešťovky (přenosné)",True),
]: upsert(z,x)

# Never seed known legacy/unsafe technical controls as interactive Floorplan items.
for f in floors.values():
    ents=[x.get("entity") for x in f.get("items",[])]
    assert "switch.vybeh_zasuvka_1" not in ents
    assert "switch.loznice_vetrak" not in ents
    assert "light.primotop_loznice_backlight" not in ents

tmp=p.with_name(p.name+".tmp-floorplan-devices")
tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
os.replace(tmp,p)

check=json.loads(p.read_text(encoding="utf-8"))
cc=[x for x in walk(check) if x.get("type")=="custom:easy-floorplan-card" and x.get("title")=="Plán Markvarce"]
assert len(cc)==1
c=cc[0]
assert c.get("offlineStyle")=="strike"
assert "compactHeader" not in c
assert c.get("sunDimming") is True and c.get("sunlight") is True and c.get("north")==0 and "sunBearing" not in c
ff={f.get("id"):f for f in c.get("floors",[])}
expected={
"light.loznice_svetlo","climate.primotop_loznice","switch.loznice_krevetarium_osvetleni",
"binary_sensor.tze284_rvnbnvw8_ts0601","media_player.loznice_google_nest_mini",
"media_player.loznice_televize_google_tv","sensor.sencor_loznice_teplota",
"sensor.sonoff_s60zbtpf_vykon","sensor.sencor_technicka_teplota",
"sensor.vnitrni_rozvadec_vykon","sensor.loznicovy_rozvadec_vykon","sensor.jezirko_rozvadec_vykon",
"camera.dvur","camera.branka_live","camera.voliera","light.drubezi_vybeh_drubezi_vybeh",
"binary_sensor.voliera_pritomnost_drubeze","sensor.nous_e6_temperature",
"sensor.sonoff_snzb_02d_teplota","sensor.sencor_slunecni_zareni",
"sensor.jezirko_stav_cisteni","switch.zahrada_cerpadlo_destovka"
}
allents=[x.get("entity") for f in ff.values() for x in f.get("items",[])]
for e in expected: assert allents.count(e)==1,(e,allents.count(e))
assert allents.count("fan.loznice_vetrak_loznice_zasuvka_1")==1
print("FLOORPLAN_DEVICES_WRITE_OK")
print("BACKUP="+str(bak))
print("DOMEK_ITEMS="+str(len(ff["domek"].get("items",[]))))
print("POZEMEK_ITEMS="+str(len(ff["pozemek"].get("items",[]))))
