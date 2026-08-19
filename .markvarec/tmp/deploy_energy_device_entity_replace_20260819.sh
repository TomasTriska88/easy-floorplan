set -euo pipefail
URL="https://raw.githubusercontent.com/TomasTriska88/easy-floorplan/e2bd88f36498d44e7b5e0ec12de3cc8d43aa2d48/.markvarec/tmp/patch_energy_device_entity_replace_20260819.py"
P=/tmp/patch_energy_device_entity_replace_20260819.py
C=/tmp/patch_energy_device_entity_replace_20260819.py
curl -fsSL "$URL" -o "$P"
test "$(wc -c < "$P" | tr -d ' ')" = "6500"
test "$(sha256sum "$P" | awk '{print $1}')" = "f764b10b99a659920902062e3914cb89847c5ca3629455207d7ced9106004cb7"
python3 -m py_compile "$P"
docker cp "$P" homeassistant:"$C"
rm -f "$P"
STAMP="$(date +%Y%m%d-%H%M%S)"
set +e
PATCH_OUT="$(docker exec -e STAMP="$STAMP" homeassistant python3 "$C" 2>&1)"
PATCH_RC=$?
set -e
printf '%s\n' "$PATCH_OUT"
docker exec homeassistant rm -f "$C"
if [ "$PATCH_RC" -ne 0 ]; then
  echo ENERGY_DEVICE_ENTITY_REPLACE_PATCH_FAILED
  exit "$PATCH_RC"
fi
ENERGY_BAK="$(printf '%s\n' "$PATCH_OUT" | sed -n 's/^ENERGY_BACKUP=//p')"
INIT_BAK="$(printf '%s\n' "$PATCH_OUT" | sed -n 's/^INIT_BACKUP=//p')"
TEST_BAK="$(printf '%s\n' "$PATCH_OUT" | sed -n 's/^TEST_BACKUP=//p')"
test -n "$ENERGY_BAK"
test -n "$INIT_BAK"
test -n "$TEST_BAK"
set +e
VALID_OUT="$(docker exec homeassistant sh -lc 'python3 -m py_compile /config/custom_components/chatgpt_bridge/energy_ops.py /config/custom_components/chatgpt_bridge/__init__.py && python3 /config/tests/test_energy_device_entity_replace_regression.py && python -m homeassistant --script check_config -c /config' 2>&1)"
VALID_RC=$?
set -e
printf '%s\n' "$VALID_OUT"
BAD=0
[ "$VALID_RC" -eq 0 ] || BAD=1
printf '%s\n' "$VALID_OUT" | grep -Fqi "could not be validated and has been disabled" && BAD=1
if [ "$BAD" -ne 0 ]; then
  docker exec -e ENERGY_BAK="$ENERGY_BAK" -e INIT_BAK="$INIT_BAK" -e TEST_BAK="$TEST_BAK" homeassistant sh -lc '
    cp "$ENERGY_BAK" /config/custom_components/chatgpt_bridge/energy_ops.py
    cp "$INIT_BAK" /config/custom_components/chatgpt_bridge/__init__.py
    if [ "$TEST_BAK" = "none" ]; then
      rm -f /config/tests/test_energy_device_entity_replace_regression.py
    else
      cp "$TEST_BAK" /config/tests/test_energy_device_entity_replace_regression.py
    fi
  '
  echo ENERGY_DEVICE_ENTITY_REPLACE_VALIDATION_FAILED_ROLLED_BACK
  exit 82
fi
echo ENERGY_DEVICE_ENTITY_REPLACE_VALIDATION_OK
nohup sh -c 'sleep 8; docker restart homeassistant >/tmp/pump-energy-helper-restart.log 2>&1' >/dev/null 2>&1 &
echo ENERGY_DEVICE_ENTITY_REPLACE_RESTART_SCHEDULED
