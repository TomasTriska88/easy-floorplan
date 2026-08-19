from pathlib import Path
import os
import shutil

stamp = os.environ["STAMP"]
base = Path("/config/custom_components/chatgpt_bridge")
energy = base / "energy_ops.py"
init = base / "__init__.py"
test = Path("/config/tests/test_energy_device_entity_replace_regression.py")

energy_bak = Path(f"/config/custom_components/chatgpt_bridge/energy_ops.py.bak-pump-energy-ref-{stamp}")
init_bak = Path(f"/config/custom_components/chatgpt_bridge/__init__.py.bak-pump-energy-ref-{stamp}")
test_bak = Path(f"/config/tests/test_energy_device_entity_replace_regression.py.bak-{stamp}")

shutil.copy2(energy, energy_bak)
shutil.copy2(init, init_bak)
if test.exists():
    shutil.copy2(test, test_bak)

energy_text = energy.read_text(encoding="utf-8")
func_marker = "async def async_energy_replace_device_entities("
if func_marker not in energy_text:
    addition = '\n\nasync def async_energy_replace_device_entities(\n    hass: HomeAssistant, value: dict[str, Any]\n) -> dict[str, Any]:\n    """Replace exact entity references in Energy device_consumption."""\n    replacements_raw = value.get("replacements")\n    if not isinstance(replacements_raw, list) or not replacements_raw:\n        raise ValueError("replacements must be a non-empty list")\n\n    replacements: list[tuple[str, str]] = []\n    seen_old: set[str] = set()\n    seen_new: set[str] = set()\n\n    for item in replacements_raw:\n        if not isinstance(item, dict):\n            raise ValueError("each replacement must be an object")\n        old_entity_id = str(item.get("old_entity_id", "")).strip()\n        new_entity_id = str(item.get("new_entity_id", "")).strip()\n        if not old_entity_id or not new_entity_id:\n            raise ValueError("old_entity_id and new_entity_id are required")\n        if old_entity_id == new_entity_id:\n            raise ValueError("old_entity_id and new_entity_id must differ")\n        if "." not in old_entity_id or "." not in new_entity_id:\n            raise ValueError("entity ids must include a domain")\n        if old_entity_id.split(".", 1)[0] != new_entity_id.split(".", 1)[0]:\n            raise ValueError("old and new entity ids must use the same domain")\n        if old_entity_id in seen_old:\n            raise ValueError(f"duplicate old_entity_id: {old_entity_id}")\n        if new_entity_id in seen_new:\n            raise ValueError(f"duplicate new_entity_id: {new_entity_id}")\n        if hass.states.get(new_entity_id) is None:\n            raise ValueError(f"new entity not found: {new_entity_id}")\n        seen_old.add(old_entity_id)\n        seen_new.add(new_entity_id)\n        replacements.append((old_entity_id, new_entity_id))\n\n    manager = await async_get_manager(hass)\n    prefs = manager.data or manager.default_preferences()\n    devices = deepcopy(list(prefs.get("device_consumption", [])))\n\n    counts: dict[str, int] = {old: 0 for old, _new in replacements}\n    for device in devices:\n        for key in ("stat_consumption", "stat_rate"):\n            current = device.get(key)\n            for old_entity_id, new_entity_id in replacements:\n                if current == old_entity_id:\n                    counts[old_entity_id] += 1\n                    device[key] = new_entity_id\n                    break\n\n    for old_entity_id, _new_entity_id in replacements:\n        count = counts[old_entity_id]\n        if count != 1:\n            raise ValueError(\n                f"expected exactly one Energy reference for {old_entity_id}, found {count}"\n            )\n\n    await manager.async_update({"device_consumption": devices})\n\n    return {\n        "ok": True,\n        "result": "energy_device_entities_replaced",\n        "replacements": [\n            {\n                "old_entity_id": old_entity_id,\n                "new_entity_id": new_entity_id,\n                "matches": counts[old_entity_id],\n            }\n            for old_entity_id, new_entity_id in replacements\n        ],\n    }\n'
    energy_text = energy_text.rstrip() + addition + "\n"
    energy.write_text(energy_text, encoding="utf-8")

init_text = init.read_text(encoding="utf-8")
dispatch_marker = '            if command == "energy_replace_device_entities":'
if dispatch_marker not in init_text:
    anchor = '            if command == "energy_set_price_entity":\n                from .energy_ops import async_energy_set_price_entity\n                return await asyncio.wait_for(\n                    async_energy_set_price_entity(hass, value),\n                    timeout=command_timeout,\n                )\n'
    if init_text.count(anchor) != 1:
        raise RuntimeError(f"energy dispatcher anchor expected once, found {init_text.count(anchor)}")
    insert = '            if command == "energy_set_price_entity":\n                from .energy_ops import async_energy_set_price_entity\n                return await asyncio.wait_for(\n                    async_energy_set_price_entity(hass, value),\n                    timeout=command_timeout,\n                )\n            if command == "energy_replace_device_entities":\n                from .energy_ops import async_energy_replace_device_entities\n                return await asyncio.wait_for(\n                    async_energy_replace_device_entities(hass, value),\n                    timeout=command_timeout,\n                )\n'
    init_text = init_text.replace(anchor, insert, 1)
    init.write_text(init_text, encoding="utf-8")

test.write_text(r'''from pathlib import Path

energy = Path("/config/custom_components/chatgpt_bridge/energy_ops.py").read_text(encoding="utf-8")
init = Path("/config/custom_components/chatgpt_bridge/__init__.py").read_text(encoding="utf-8")

assert energy.count("async def async_energy_replace_device_entities(") == 1
for needle in (
    'value.get("replacements")',
    '("stat_consumption", "stat_rate")',
    "hass.states.get(new_entity_id)",
    "if count != 1:",
    'await manager.async_update({"device_consumption": devices})',
    '"energy_device_entities_replaced"',
):
    assert needle in energy, needle

assert "/config/.storage/energy" not in energy

assert init.count('if command == "energy_replace_device_entities":') == 1
assert "async_energy_replace_device_entities" in init

print("ENERGY_DEVICE_ENTITY_REPLACE_REGRESSION_OK")
''', encoding="utf-8")

print(f"ENERGY_BACKUP={energy_bak}")
print(f"INIT_BACKUP={init_bak}")
print(f"TEST_BACKUP={test_bak if test_bak.exists() else 'none'}")
print("ENERGY_DEVICE_ENTITY_REPLACE_PATCH_WRITTEN")
