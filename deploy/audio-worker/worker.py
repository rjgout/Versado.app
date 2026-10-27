"""Offline infrastructuur voor latere Audio V2-generators; schrijft geen audio of pakketten."""
import argparse
import json
import os
from pathlib import Path


def directory_status(path):
    folder = Path(path)
    return {"present": folder.is_dir(), "readable": os.access(folder, os.R_OK),
            "writable": os.access(folder, os.W_OK)}


def main():
    parser = argparse.ArgumentParser(description="Versado Audio Worker: infrastructuur, geen generator.")
    parser.add_argument("command", choices=["status", "contract"], default="status", nargs="?")
    args = parser.parse_args()
    if os.getuid() == 0:
        parser.error("Gebruik een gecontroleerde niet-root UID; UID 0 is niet toegestaan.")
    if args.command == "contract":
        # Alleen de exacte gedeelde contractbron tonen; dit is geen alternatieve validator/importer.
        print((Path(__file__).parent / "reference" / "contract.ts").read_text())
        return
    print(json.dumps({"mode": "infrastructure-only", "generationEnabled": False,
                      "packageDeliveryEnabled": False,
                      "uid": os.getuid(), "gid": os.getgid(),
                      "storageBudgetBytes": int(os.environ.get("WORKER_STORAGE_BUDGET_BYTES", "21474836480")),
                      "storageBudgetEnforcedBy": "DSM-quota vereist; omgevingswaarde is uitsluitend informatief",
                      "folders": {p: directory_status(p) for p in ["/jobs", "/work", "/outbox"]}},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
