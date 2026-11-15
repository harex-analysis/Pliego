"""Inspect the production filter or allow the test suite's loopback seed."""

from pathlib import Path
import runpy
import sys


if len(sys.argv) > 1:
    worker = runpy.run_path(sys.argv[1])
    address_filter = worker["public_network_filter"]()
    for address in ("127.0.0.1", "10.20.30.40", "192.168.20.1", "172.16.0.1",
                    "169.254.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"):
        assert address_filter.access(address), address
    for address in ("1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"):
        assert not address_filter.access(address), address
else:
    worker = runpy.run_path(str(Path(__file__).resolve().parents[1] / "vendor/torrent/worker.py"))

    def loopback_filter():
        address_filter = worker["public_network_filter"]()
        address_filter.add_rule("127.0.0.1", "127.0.0.1", 0)
        return address_filter

    try:
        worker["run"](loopback_filter)
    except Exception as error:
        worker["send"]("error", message=str(error))
