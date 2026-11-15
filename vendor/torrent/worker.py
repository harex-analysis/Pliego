"""One libtorrent session, controlled by Pliego over a private JSON-lines pipe."""

from ipaddress import ip_network
import json
from pathlib import Path
import queue
import sys
import threading
import time

import libtorrent as lt


def send(event, **data):
    print(json.dumps(dict(event=event, **data), ensure_ascii=True), flush=True)


def read_commands(inbox):
    for line in sys.stdin:
        try:
            inbox.put(json.loads(line))
        except ValueError:
            pass
    inbox.put({"command": "stop"})


def public_network_filter():
    result = lt.ip_filter()
    blocked = 1  # libtorrent ip_filter::blocked is not exposed by the wheel.
    # Block local and special IPv4 ranges, and require IPv6 global unicast.
    for prefix in (
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
        "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
        "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
        "203.0.113.0/24", "224.0.0.0/3", "::/3", "4000::/2", "8000::/1",
        "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20",
    ):
        network = ip_network(prefix)
        result.add_rule(str(network.network_address), str(network.broadcast_address), blocked)
    return result


def run(make_filter=public_network_filter):
    inbox = queue.Queue()
    threading.Thread(target=read_commands, args=(inbox,), daemon=True).start()
    config = inbox.get()
    if config["command"] != "probe":
        return
    cache = Path(config["cache"])
    dht_cache = cache.with_name("dht-public.dat")
    dht_flag = lt.save_state_flags_t.save_dht_state
    try:
        session_params = lt.read_session_params(dht_cache.read_bytes(), dht_flag)
    except (OSError, RuntimeError):
        session_params = lt.session_params()
    session_params.ip_filter = make_filter()
    session_params.settings = {
        "enable_upnp": False,
        "enable_natpmp": False,
        "enable_lsd": False,
        "ssrf_mitigation": True,
        "apply_ip_filter_to_trackers": True,
        "apply_filter_to_dht": True,
        "validate_https_trackers": True,
        "max_metadata_size": 8 * 1024 * 1024,
        "alert_mask": (lt.alert.category_t.error_notification |
                       lt.alert.category_t.storage_notification |
                       lt.alert.category_t.status_notification),
    }
    session = lt.session(session_params)
    magnet = config["magnet"]
    cached = lt.read_resume_data(cache.read_bytes()) if cache.is_file() else None
    handle = None
    info = cached.ti if cached else None
    phase = "probe"
    next_status = time.monotonic()
    metadata_deadline = next_status + 120

    def params():
        value = lt.parse_magnet_uri(magnet)
        value.flags &= ~(lt.torrent_flags.auto_managed | lt.torrent_flags.paused)
        value.flags |= lt.torrent_flags.apply_ip_filter
        return value

    def report_metadata():
        files = info.files()
        if files.num_files() > 20000:
            raise RuntimeError("El torrent contiene demasiados archivos.")
        supported = {".cbr", ".cbz", ".rar", ".zip"}
        entries = []
        for index in range(files.num_files()):
            if files.file_flags(index) & (files.flag_pad_file | files.flag_symlink):
                continue
            filename = files.file_name(index)
            size = files.file_size(index)
            if size > 0 and Path(filename).suffix.lower() in supported:
                entries.append(dict(index=index, name=filename, size=size))
        if len(entries) > 5000:
            raise RuntimeError("El torrent contiene más de 5000 tomos compatibles.")
        send("metadata", name=info.name(), files=entries)

    def save_dht():
        state = session.save_state(dht_flag)
        if state:
            partial = dht_cache.with_suffix(".tmp")
            partial.write_bytes(lt.bencode(state))
            partial.replace(dht_cache)

    if info:
        report_metadata()
        phase = "ready"
    else:
        probe = params()
        probe.save_path = str(cache.parent)
        probe.flags |= lt.torrent_flags.upload_mode | lt.torrent_flags.default_dont_download
        handle = session.add_torrent(probe)

    while True:
        try:
            request = inbox.get(timeout=.15)
        except queue.Empty:
            request = {}
        command = request.get("command")
        if command == "stop":
            save_dht()
            return
        if command == "download" and phase == "ready":
            if handle:
                session.remove_torrent(handle)
            download = params()
            download.ti = info
            download.flags |= lt.torrent_flags.override_trackers | lt.torrent_flags.override_web_seeds
            download.save_path = request["folder"]
            chosen = {row["index"]: row["name"] for row in request["files"]}
            count = info.files().num_files()
            download.file_priorities = [4 if index in chosen else 0 for index in range(count)]
            # Every path comes from Pliego. Torrent-supplied directory paths
            # are never used as destinations.
            download.renamed_files = {
                index: chosen.get(index, ".pliego-parts/" + str(index)) for index in range(count)
            }
            handle = session.add_torrent(download)
            phase = "download"
            next_status = 0

        for alert in session.pop_alerts():
            if isinstance(alert, (lt.torrent_error_alert, lt.file_error_alert)) and alert.handle == handle:
                raise RuntimeError(alert.message())
            if phase == "probe" and isinstance(alert, lt.metadata_received_alert):
                info = handle.torrent_file()
                handle.save_resume_data(lt.torrent_handle.save_info_dict)
                phase = "cache"
            elif phase == "cache" and isinstance(alert, lt.save_resume_data_alert):
                partial = cache.with_suffix(".tmp")
                partial.write_bytes(lt.write_resume_data_buf(alert.params))
                partial.replace(cache)
                phase = "ready"
                report_metadata()
            elif phase == "cache" and isinstance(alert, lt.save_resume_data_failed_alert):
                raise RuntimeError(alert.message())
            elif phase == "flush" and isinstance(alert, lt.cache_flushed_alert) and alert.handle == handle:
                save_dht()
                send("complete", partFile="." + str(info.info_hashes().get_best()) + ".parts")
                return

        now = time.monotonic()
        if phase in {"probe", "cache"} and now >= metadata_deadline:
            save_dht()
            send("error", message="No se encontró la lista de archivos. Prueba con el magnet completo o inténtalo más tarde.")
            return
        if phase == "download" and now >= next_status:
            status = handle.status()
            if status.is_finished:
                phase = "flush"
                handle.flush_cache()
            else:
                send("progress", progress=status.progress, speed=status.download_payload_rate,
                     peers=status.num_peers, checking=status.state in {
                         lt.torrent_status.checking_files, lt.torrent_status.checking_resume_data
                     })
            next_status = now + .75


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        send("error", message=str(error))
