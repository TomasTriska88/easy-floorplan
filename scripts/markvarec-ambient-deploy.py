#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path('/home/lina/easy-floorplan-ambient-prod')
BUILD = REPO / 'dist/easy-floorplan-card.js'
NEW_HASH = 'b09285c08f48b64262d4562fa8c368782889c8f3941282cfaaf98650881c815c'
OLD_HASH = '3da32b90f7a7849db966bd03e57df8bf389c79c947a97a5dbf5551d6e80e44d4'
CARD_STRIPPED_HASH = '199ee76b2fedb1e5d9588d9a12fcd996a694b1c0097fbfd9863c83e4d7f059c2'
JS = '/config/www/easy-floorplan-card.js'
STORE = '/config/.storage/lovelace.linino_hnizdo'
JS_STAGE = '/config/www/.easy-floorplan-card.js.ambient1.new'
STORE_STAGE = '/config/.storage/.lovelace.linino_hnizdo.ambient1.new'
JS_BAK = '/config/www/easy-floorplan-card.js.bak-pre-ambient-20260822-1928'
STORE_BAK = '/config/.storage/lovelace.linino_hnizdo.bak-pre-ambient-20260822-1928'


def run(*args: str, capture: bool = False) -> str:
    cp = subprocess.run(args, check=True, text=True, capture_output=capture)
    return cp.stdout.strip() if capture else ''


def docker(*args: str, capture: bool = False) -> str:
    return run('docker', *args, capture=capture)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def card_digest(card: dict, *, strip_ambient: bool) -> str:
    data = copy.deepcopy(card)
    if strip_ambient:
        data.pop('ambientDaylight', None)
    raw = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def find_floorplan_cards(obj: object) -> list[dict]:
    found: list[dict] = []
    def walk(node: object) -> None:
        if isinstance(node, dict):
            if node.get('type') == 'custom:easy-floorplan-card':
                found.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(obj)
    return found


def container_sha(path: str) -> str:
    out = docker('exec', 'homeassistant', 'sha256sum', path, capture=True)
    return out.split()[0]


def main() -> None:
    if sha256_file(BUILD) != NEW_HASH:
        raise SystemExit('validated build hash mismatch')
    if container_sha(JS) != OLD_HASH:
        raise SystemExit('production JS changed since audit')

    with tempfile.TemporaryDirectory(prefix='markvarec-ambient-') as td:
        td_path = Path(td)
        store_copy = td_path / 'lovelace.linino_hnizdo'
        patched_copy = td_path / 'lovelace.linino_hnizdo.ambient1'
        docker('cp', f'homeassistant:{STORE}', str(store_copy))
        obj = json.loads(store_copy.read_text(encoding='utf-8'))
        data = obj.get('data', {})
        root = data.get('config', data)
        cards = find_floorplan_cards(root)
        if len(cards) != 1:
            raise SystemExit(f'expected exactly one floorplan card, got {len(cards)}')
        card = cards[0]
        if 'ambientDaylight' in card:
            raise SystemExit(f'ambientDaylight already present: {card["ambientDaylight"]!r}')
        before = card_digest(card, strip_ambient=True)
        if before != CARD_STRIPPED_HASH:
            raise SystemExit(f'card invariant mismatch before patch: {before}')
        card['ambientDaylight'] = True
        after = card_digest(card, strip_ambient=True)
        if after != CARD_STRIPPED_HASH:
            raise SystemExit(f'card invariant mismatch after patch: {after}')
        new_full = card_digest(card, strip_ambient=False)
        patched_copy.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

        # Stage both artifacts and validate them before touching the live paths.
        docker('cp', str(BUILD), f'homeassistant:{JS_STAGE}')
        docker('cp', str(patched_copy), f'homeassistant:{STORE_STAGE}')
        docker('exec', 'homeassistant', 'sh', '-lc',
               f"chown --reference='{JS}' '{JS_STAGE}'; chmod --reference='{JS}' '{JS_STAGE}'; "
               f"chown --reference='{STORE}' '{STORE_STAGE}'; chmod --reference='{STORE}' '{STORE_STAGE}'")
        if container_sha(JS_STAGE) != NEW_HASH:
            raise SystemExit('staged JS hash mismatch')

        docker('exec', 'homeassistant', 'cp', '-p', JS, JS_BAK)
        docker('exec', 'homeassistant', 'cp', '-p', STORE, STORE_BAK)
        swapped_js = False
        swapped_store = False
        try:
            docker('exec', 'homeassistant', 'mv', JS_STAGE, JS)
            swapped_js = True
            docker('exec', 'homeassistant', 'mv', STORE_STAGE, STORE)
            swapped_store = True
            if container_sha(JS) != NEW_HASH:
                raise RuntimeError('live JS hash mismatch after swap')
            verify_copy = td_path / 'verify-store'
            docker('cp', f'homeassistant:{STORE}', str(verify_copy))
            verify_obj = json.loads(verify_copy.read_text(encoding='utf-8'))
            verify_data = verify_obj.get('data', {})
            verify_root = verify_data.get('config', verify_data)
            verify_cards = find_floorplan_cards(verify_root)
            if len(verify_cards) != 1 or verify_cards[0].get('ambientDaylight') is not True:
                raise RuntimeError('live card did not read back ambientDaylight=true')
            stripped = card_digest(verify_cards[0], strip_ambient=True)
            if stripped != CARD_STRIPPED_HASH:
                raise RuntimeError(f'live card invariant changed: {stripped}')
            full = card_digest(verify_cards[0], strip_ambient=False)
        except Exception:
            if swapped_js:
                docker('exec', 'homeassistant', 'cp', '-p', JS_BAK, JS)
            if swapped_store:
                docker('exec', 'homeassistant', 'cp', '-p', STORE_BAK, STORE)
            raise
        finally:
            docker('exec', 'homeassistant', 'rm', '-f', JS_STAGE, STORE_STAGE)

    print('DEPLOY_STAGED_OK')
    print(f'js_hash={NEW_HASH}')
    print(f'card_stripped_sha={CARD_STRIPPED_HASH}')
    print(f'card_full_sha={full}')
    print(f'js_backup={JS_BAK}')
    print(f'store_backup={STORE_BAK}')


if __name__ == '__main__':
    main()
