"""Read-only SkillHub SQLite snapshot and export; no SkillGo connection exists."""
import argparse, base64, json, os, pathlib, sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('source', help='Path to the OLD SkillHub SQLite file')
parser.add_argument('destination', help='A new, private backup directory')
args = parser.parse_args()
source = pathlib.Path(args.source).resolve()
destination = pathlib.Path(args.destination).resolve()
destination.mkdir(parents=True, exist_ok=True)
backup = destination / 'skillhub.sqlite'
output = destination / 'skillhub-export.json'
if backup.exists() or output.exists(): raise SystemExit('Refusing to overwrite an existing SkillHub backup.')
with sqlite3.connect(source.as_uri()+'?mode=ro', uri=True) as old, sqlite3.connect(backup) as saved:
    old.backup(saved)
tables = {}
with sqlite3.connect(backup.as_uri()+'?mode=ro', uri=True) as connection:
    connection.row_factory = sqlite3.Row
    for table in ['skills','versions','favorites','api_keys','recipes','messages','packages','package_chunks']:
        tables[table] = [{name:({'$binary':base64.b64encode(row[name]).decode('ascii')} if isinstance(row[name],bytes) else row[name]) for name in row.keys()} for row in connection.execute('SELECT * FROM "'+table+'"')]
output.write_text(json.dumps({'format':'skillhub-sqlite-v1','tables':tables},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
if os.name != 'nt':
    backup.chmod(0o600)
    output.chmod(0o600)
print(json.dumps({'backup':str(backup),'export':str(output),'counts':{table:len(rows) for table,rows in tables.items()}}))
