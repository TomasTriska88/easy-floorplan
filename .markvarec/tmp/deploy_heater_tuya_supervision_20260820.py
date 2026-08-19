from pathlib import Path
import shutil, subprocess, sys, hashlib, time, yaml

AUTO = Path("/config/automations.yaml")
TEST = Path("/config/tests/test_heater_regression.py")
CARD = Path("/config/www/lina-climate-safety-card.js")
stamp = time.strftime("%Y%m%d-%H%M%S")
bak_auto = AUTO.with_name(AUTO.name + f".bak-heater-tuya-{stamp}")
bak_test = TEST.with_name(TEST.name + f".bak-heater-tuya-{stamp}")
shutil.copy2(AUTO, bak_auto)
shutil.copy2(TEST, bak_test)

def block_bounds(text, marker):
    a = text.index(marker)
    z = text.find("\n- id:", a + len(marker))
    if z < 0:
        z = len(text)
    return a, z

def get_block(text, marker):
    a, z = block_bounds(text, marker)
    return text[a:z]

def replace_block(text, marker, block):
    a, z = block_bounds(text, marker)
    return text[:a] + block.rstrip() + text[z:]

def dump_one(obj, automation_id):
    out = yaml.safe_dump([obj], allow_unicode=True, sort_keys=False, width=180)
    first = f"- id: {automation_id}\n"
    quoted = f"- id: '{automation_id}'\n"
    if out.startswith(first):
        out = quoted + out[len(first):]
    assert out.startswith(quoted)
    return out

try:
    s = AUTO.read_text(encoding="utf-8")

    problem_id = "markvarec_loznice_primotop_problem_notify"
    voice_id = "markvarec_lina_primotop_problem_hlas"
    problem_marker = f"- id: '{problem_id}'"
    voice_marker = f"- id: '{voice_id}'"
    assert s.count(problem_marker) == 1
    assert s.count(voice_marker) == 1

    tuya_id = "markvarec_tuya_poststart_recovery"
    supervision_id = "markvarec_loznice_primotop_dohled_ztracen"

    insert = """- id: 'markvarec_tuya_poststart_recovery'
  alias: Markvarec - Tuya - jednorázová recovery po startu HA
  description: >-
    Po startu HA dá Tuya tři minuty na běžné načtení. Pokud jsou potom současně
    nedostupné tři klíčové Tuya měřicí body, provede právě jeden cílený reload
    Tuya config entry. Nejde o periodický reload a stav napájení si nevymýšlí.
  triggers:
  - trigger: homeassistant
    event: start
  conditions: []
  actions:
  - delay: '00:03:00'
  - condition: template
    value_template: >-
      {{ states('sensor.vnitrni_rozvadec_vykon') in ['unknown','unavailable']
         and states('sensor.loznicovy_rozvadec_vykon') in ['unknown','unavailable']
         and states('sensor.primotop_v_loznici_vykon') in ['unknown','unavailable'] }}
  - action: homeassistant.reload_config_entry
    continue_on_error: true
    target:
      entity_id: sensor.vnitrni_rozvadec_vykon
  mode: single

- id: 'markvarec_loznice_primotop_dohled_ztracen'
  alias: Markvarec - Ložnice - ztráta dohledu přímotopu
  description: >-
    Odděluje komunikační/nedostupný stav od recovery poruchy. Až po pěti
    minutách souvislé nedostupnosti zásuvky, QH4100 nebo příkonu upozorní,
    že přímotop není spolehlivě pod dohledem; samotná nedostupnost se
    nepovažuje za fyzickou poruchu QH4100.
  triggers:
  - trigger: template
    value_template: >-
      {{ states('switch.primotop_v_loznici_zasuvka_1') in ['unknown','unavailable']
         or states('climate.primotop_loznice') in ['unknown','unavailable']
         or states('sensor.primotop_v_loznici_vykon') in ['unknown','unavailable'] }}
    for: '00:05:00'
  conditions:
  - condition: state
    entity_id: input_boolean.loznice_primotop_recovery_povoleno
    state: 'on'
  actions:
  - action: notify.send_message
    continue_on_error: true
    target:
      entity_id: notify.tomas
    data:
      message: >-
        Přímotop v ložnici teď nemám spolehlivě pod dohledem.
        Zásuvka: {{ states('switch.primotop_v_loznici_zasuvka_1') }},
        QH4100: {{ states('climate.primotop_loznice') }},
        příkon: {{ states('sensor.primotop_v_loznici_vykon') }}.
        Může jít o napájení nebo Tuya komunikaci; z této nedostupnosti
        samotné nevyvozuji fyzickou poruchu přímotopu.
  - action: script.lina_mluv
    continue_on_error: true
    data:
      text: >-
        Pozor. Přímotop v ložnici teď nemám spolehlivě pod dohledem.
        Může jít o napájení nebo Tuya komunikaci; z toho samotného
        netvrdím poruchu QH4100.
      priorita: important
  mode: single

"""
    if tuya_id not in s and supervision_id not in s:
        s = s.replace(problem_marker, insert + problem_marker, 1)
    else:
        assert tuya_id in s and supervision_id in s, "partial heater/Tuya insertion"

    # Change only the target problem automation structurally.
    p_raw = get_block(s, problem_marker)
    p_list = yaml.safe_load(p_raw)
    assert isinstance(p_list, list) and len(p_list) == 1
    p_obj = p_list[0]
    assert str(p_obj.get("id")) == problem_id

    templates = [
        c for c in p_obj.get("conditions", [])
        if isinstance(c, dict)
        and c.get("condition") == "template"
        and "primotop_v_loznici_vykon" in str(c.get("value_template", ""))
    ]
    assert len(templates) == 1
    templates[0]["value_template"] = """{% set p = states.switch.primotop_v_loznici_zasuvka_1 %}
{% set c = states.climate.primotop_loznice %}
{% set ps = states('switch.primotop_v_loznici_zasuvka_1') %}
{% set cs = states('climate.primotop_loznice') %}
{% set power_raw = states('sensor.primotop_v_loznici_vykon') %}
{% set power_ok = power_raw not in ['unknown','unavailable','none',''] %}
{% set power = power_raw | float(0) %}
{% set pa = 999999 if p is none else (as_timestamp(now()) - as_timestamp(p.last_changed)) %}
{% set ca = 999999 if c is none else (as_timestamp(now()) - as_timestamp(c.last_changed)) %}
{{ (ps == 'off' and pa >= 120)
   or (cs == 'off' and ca >= 300)
   or (ps == 'on' and cs == 'heat' and power_ok and power < 5) }}"""

    notify_actions = [
        a for a in p_obj.get("actions", [])
        if isinstance(a, dict) and a.get("action") == "notify.send_message"
    ]
    assert len(notify_actions) == 1
    notify_actions[0].setdefault("data", {})["message"] = (
        "Řízení přímotopu v ložnici hlásí problém. "
        "Zásuvka: {{ states('switch.primotop_v_loznici_zasuvka_1') }}, "
        "QH4100: {{ states('climate.primotop_loznice') }}. "
        "Může jít o napájení, stav zařízení nebo zastaralý Tuya stav; recovery běží."
    )
    s = replace_block(s, problem_marker, dump_one(p_obj, problem_id))

    # Change only the target voice automation structurally.
    h_raw = get_block(s, voice_marker)
    h_list = yaml.safe_load(h_raw)
    assert isinstance(h_list, list) and len(h_list) == 1
    h_obj = h_list[0]
    assert str(h_obj.get("id")) == voice_id
    voice_actions = [
        a for a in h_obj.get("actions", [])
        if isinstance(a, dict) and a.get("action") == "script.lina_mluv"
    ]
    assert len(voice_actions) == 1
    voice_actions[0].setdefault("data", {})["text"] = (
        "Pozor. Řízení přímotopu v ložnici hlásí problém a recovery běží. "
        "Nemusí jít o fyzickou poruchu QH4100; podrobnosti máš v telefonu."
    )
    s = replace_block(s, voice_marker, dump_one(h_obj, voice_id))
    AUTO.write_text(s, encoding="utf-8")

    t = TEST.read_text(encoding="utf-8")
    if "U = block(\"- id: 'markvarec_tuya_poststart_recovery'\")" not in t:
        needle = "N = block(\"- id: 'markvarec_loznice_primotop_recovery_notify'\")\n"
        assert t.count(needle) == 1
        addition = (
            "U = block(\"- id: 'markvarec_tuya_poststart_recovery'\")\n"
            "D = block(\"- id: 'markvarec_loznice_primotop_dohled_ztracen'\")\n"
            "H = block(\"- id: 'markvarec_lina_primotop_problem_hlas'\")\n"
        )
        t = t.replace(needle, needle + addition, 1)

    if "# Tuya startup recovery and supervision semantics." not in t:
        needle2 = "def qh_target(optimal, minimum):\n"
        assert t.count(needle2) == 1
        checks = """# Tuya startup recovery and supervision semantics.
assert "event: start" in U
assert "delay: '00:03:00'" in U
assert U.count("homeassistant.reload_config_entry") == 1
for entity in ("sensor.vnitrni_rozvadec_vykon", "sensor.loznicovy_rozvadec_vykon",
               "sensor.primotop_v_loznici_vykon"):
    assert entity in U
assert "ps == 'off' and pa >= 120" in P
assert "cs == 'off' and ca >= 300" in P
assert "ps in bad" not in P
assert "c.last_changed" in P
assert "c.last_updated" not in P
assert "for: '00:05:00'" in D
for entity in ("switch.primotop_v_loznici_zasuvka_1", "climate.primotop_loznice",
               "sensor.primotop_v_loznici_vykon"):
    assert entity in D
assert "nemám spolehlivě pod dohledem" in D
assert "Nemusí jít o fyzickou poruchu QH4100" in H

# Hnízdo already has separate UI semantics for actual recovery fault vs unavailable climate.
CARD = Path("/config/www/lina-climate-safety-card.js").read_text(encoding="utf-8")
assert 'label: "Porucha / recovery"' in CARD
assert 'label: "Nedostupný"' in CARD

"""
        t = t.replace(needle2, checks + needle2, 1)
    TEST.write_text(t, encoding="utf-8")

    # Structural sanity before HA validation.
    parsed = yaml.safe_load(AUTO.read_text(encoding="utf-8"))
    ids = [str(x.get("id", "")) for x in parsed if isinstance(x, dict)]
    assert ids.count(tuya_id) == 1
    assert ids.count(supervision_id) == 1
    assert ids.count(problem_id) == 1
    assert ids.count(voice_id) == 1

    test = subprocess.run(["python3", str(TEST)], text=True, capture_output=True)
    print(test.stdout, end="")
    print(test.stderr, end="", file=sys.stderr)
    if test.returncode != 0:
        raise RuntimeError(f"heater regression failed rc={test.returncode}")

    check = subprocess.run(
        ["python3", "-m", "homeassistant", "--script", "check_config", "-c", "/config"],
        text=True, capture_output=True
    )
    out = (check.stdout or "") + (check.stderr or "")
    print(out)
    if check.returncode != 0 or "could not be validated and has been disabled" in out.lower():
        raise RuntimeError(f"HA check_config failed rc={check.returncode}")

    print("AUTOMATIONS_SHA256=" + hashlib.sha256(AUTO.read_bytes()).hexdigest())
    print("TEST_SHA256=" + hashlib.sha256(TEST.read_bytes()).hexdigest())
    print("HEATER_TUYA_PATCH_VALIDATED")
except Exception as exc:
    shutil.copy2(bak_auto, AUTO)
    shutil.copy2(bak_test, TEST)
    print("HEATER_TUYA_PATCH_ROLLED_BACK:", repr(exc), file=sys.stderr)
    sys.exit(82)
