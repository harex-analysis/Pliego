import json
from pathlib import Path
import sys

import libtorrent as lt

root = Path(sys.argv[1])
files = lt.file_storage()
lt.add_files(files, str(root / 'Demo'))
session = lt.session({
    'listen_interfaces': '127.0.0.1:0',
    'enable_dht': False, 'enable_lsd': False, 'enable_upnp': False, 'enable_natpmp': False,
})
magnets = []
for flags in (lt.create_torrent.v1_only, lt.create_torrent.v2_only):
    creator = lt.create_torrent(files, 16384, flags)
    lt.set_piece_hashes(creator, str(root))
    info = lt.torrent_info(lt.bencode(creator.generate()))
    params = lt.add_torrent_params()
    params.ti = info
    params.save_path = str(root)
    params.flags |= lt.torrent_flags.seed_mode
    session.add_torrent(params)
    magnets.append(f'{lt.make_magnet_uri(info)}&x.pe=127.0.0.1:{session.listen_port()}')
print(json.dumps(magnets), flush=True)
sys.stdin.read()
