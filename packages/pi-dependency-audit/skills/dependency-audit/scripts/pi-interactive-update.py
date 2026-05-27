#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RUN_AUDIT_SCRIPT = SCRIPT_DIR / "run_pi_dependency_audit.py"
AGGREGATED_JSON = Path("/tmp/pi_audit_aggregated.json")
MARKDOWN_REPORT = Path("/tmp/pi_audit_report.md")

def main():
    print("\n🛡️ Starte Sicherheits-Audit der Pi-Abhängigkeiten...")
    
    # 1. Run the audit script
    audit_res = subprocess.run(["python3", str(RUN_AUDIT_SCRIPT)], text=True)
    if audit_res.returncode != 0:
        print("❌ Audit fehlgeschlagen oder abgebrochen.")
        return 1
        
    if not AGGREGATED_JSON.exists():
        print("❌ Audit-Ergebnisdatei nicht gefunden.")
        return 1
    if MARKDOWN_REPORT.exists():
        print(f"📄 Detail-Report: {MARKDOWN_REPORT}")
        
    try:
        results = json.loads(AGGREGATED_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"❌ Fehler beim Lesen der Audit-Ergebnisse: {e}")
        return 1
        
    # 2. Filter updates
    updates = [i for i in results if i.get("status") in {"update_available", "too_fresh"}]
    if not updates:
        print("\n✅ Alle Pi-Erweiterungen sind auf dem neuesten Stand!")
        return 0
        
    print("\n🔄 Ausstehende Updates und Audit-Ergebnisse:")
    print("=" * 80)
    
    # Helper to get source name
    def get_pi_source(item):
        if item.get("type") == "npm":
            return f"npm:{item['name']}"
        source = item.get("source")
        if source:
            return str(source)
        name = item.get("name", "")
        if name == "pi-skills":
            return "git:github.com/fgladisch/pi-skills"
        if name == "pi-plugins":
            return "git:github.com/testzugang/pi-plugins"
        if name == "pi-community-themes":
            return "git:https://github.com/hasit/pi-community-themes"
        return f"git:github.com/testzugang/{name}"
        
    # Print menu
    for idx, item in enumerate(updates, start=1):
        name = item.get("name")
        current = item.get("current")[:8] if item.get("type") == "git" and item.get("current") else item.get("current")
        latest = item.get("latest")[:8] if item.get("type") == "git" and item.get("latest") else item.get("latest")
        decision = item.get("decision", "UNKNOWN")
        status = item.get("status")
        
        # Format decision string
        if decision in {"QUARANTINE", "BLOCK_UNTIL_REVIEW"}:
            dec_str = f"❌ {decision}"
        elif decision == "REVIEW_BEFORE_USE":
            dec_str = f"🟡 {decision}"
        elif status == "too_fresh":
            dec_str = f"⏱️ TOO FRESH (Alterssperre)"
        else:
            dec_str = f"✅ SAFE"
            
        print(f"[{idx}] {name} ({current} -> {latest})")
        print(f"    Urteil: {dec_str} | Quelle: {get_pi_source(item)}")
        print("-" * 80)
        
    print("\nOptionen:")
    print(" - Gib die Nummern ein, die du aktualisieren willst (z.B. 1, 3, 5)")
    print(" - 'safe' für alle als sicher eingestuften Updates")
    print(" - 'all' für alle Updates (inkl. Warnungen/Quarantäne, auf eigene Gefahr!)")
    print(" - 'q' zum Abbrechen")
    if MARKDOWN_REPORT.exists():
        print(f"\nDetails zu blockierten/verschobenen Updates: {MARKDOWN_REPORT}")
    
    try:
        user_input = input("\nDeine Auswahl: ").strip().lower()
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 0
        
    if user_input in {"q", "quit", "exit", ""}:
        print("Abgebrochen.")
        return 0
        
    selected_items = []
    
    if user_input == "safe":
        selected_items = [i for i in updates if i.get("decision") not in {"BLOCK_UNTIL_REVIEW", "QUARANTINE"} and i.get("status") != "too_fresh"]
        if not selected_items:
            print("Keine sicheren Updates vorhanden.")
            return 0
    elif user_input == "all":
        selected_items = updates
    else:
        # Parse numbers
        parts = [p.strip() for p in user_input.split(",")]
        for p in parts:
            try:
                idx = int(p)
                if 1 <= idx <= len(updates):
                    selected_items.append(updates[idx - 1])
                else:
                    print(f"⚠️ Ungültige Nummer: {idx}")
            except ValueError:
                if p:
                    print(f"⚠️ Ungültige Eingabe übersprungen: '{p}'")
                
    if not selected_items:
        print("Keine Updates ausgewählt.")
        return 0
        
    print(f"\n🚀 Folgende {len(selected_items)} Updates werden installiert:")
    for item in selected_items:
        print(f"  - {item.get('name')} ({get_pi_source(item)})")
        
    try:
        confirm = input("\nFortfahren? [J/n]: ").strip().lower()
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 0
        
    if confirm not in {"", "j", "ja", "yes", "y"}:
        print("Abgebrochen.")
        return 0
        
    # Execute actual pi update commands
    for item in selected_items:
        source = get_pi_source(item)
        print(f"\n========================================================")
        print(f"📦 Führe aus: pi update {source}")
        print(f"========================================================")
        subprocess.run(["pi", "update", source])
        
    print("\n✅ Update-Prozess beendet!")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        sys.exit(0)
