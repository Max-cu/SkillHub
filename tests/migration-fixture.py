"""Create disposable SQLite migration fixtures, never touch a product database."""
import base64, hashlib, io, json, pathlib, sqlite3, subprocess, sys, zipfile

folder=pathlib.Path(sys.argv[1]).resolve()
folder.mkdir(parents=True,exist_ok=True)
file=folder/'fixture.sqlite'
if file.exists(): raise SystemExit('Fixture already exists; refusing overwrite.')
root=pathlib.Path(__file__).resolve().parent.parent
name='qa-migration-skill'
markdown='---\nname: '+name+'\ndescription: Disposable SQLite to PostgreSQL migration fixture.\n---\n\n# Test\n保留脚本、二进制资源和历史内容。'
resource=bytes((i*37+13)%256 for i in range(1024*1024+17))
files={'SKILL.md':markdown.encode(),'assets/data.bin':resource,'scripts/example.py':b'print("fixture only")'}
memory=io.BytesIO()
with zipfile.ZipFile(memory,'w',zipfile.ZIP_STORED) as archive:
    for path,content in files.items(): archive.writestr(name+'/'+path,content)
archive=memory.getvalue();(folder/'expected.zip').write_bytes(archive)
digest=lambda data:'sha256:'+hashlib.sha256(data).hexdigest()
time='2026-10-08T09:00:00.000Z'
token='sg_disposable_migration_fixture_key_only'
with sqlite3.connect(file) as db:
    for sql in sorted((root/'drizzle').glob('*.sql')): db.executescript(sql.read_text(encoding='utf-8'))
    db.execute('INSERT INTO skills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(name,name,'Disposable migration fixture','development','["codex"]','["qa"]','',name+'/SKILL.md',None,'MIT','local-workspace',0,time))
    db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?)',(name,'1.0.0',markdown,digest(markdown.encode()),None,'fixture',time))
    db.execute('INSERT INTO favorites VALUES(?,?,?)',('local-workspace',name,time))
    db.execute('INSERT INTO api_keys VALUES(?,?,?,?,?,?,?)',('qa-migration-key','local-workspace','Fixture key',digest(token.encode()),token[:11],'read',time))
    db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',('qa-migration-message','local-workspace','Fixture','便签第一行\nSecond line <script>plain text</script>','blue',time,.35,.6))
    db.execute('INSERT INTO recipes VALUES(?,?,?,?,?,?,?)',('qa-legacy','local-workspace','legacy','legacy','codex','[]',time))
    manifest=json.dumps([{'path':path,'size':len(content)} for path,content in files.items()])
    db.execute('INSERT INTO packages VALUES(?,?,?,?,?,?,?)',(name,'1.0.0',digest(archive),len(archive),'fixture.zip',name+'/',manifest))
    for index,offset in enumerate(range(0,len(archive),512*1024)): db.execute('INSERT INTO package_chunks VALUES(?,?,?,?)',(name,'1.0.0',index,archive[offset:offset+512*1024]))
subprocess.run([sys.executable,str(root/'scripts/export-sqlite.py'),str(file),str(folder/'snapshot')],check=True)
snapshot=json.loads((folder/'snapshot/skillhub-export.json').read_text(encoding='utf-8'))
snapshot['tables']['package_chunks'][0]['skill_id']='missing-parent-for-rollback-test'
(folder/'invalid-export.json').write_text(json.dumps(snapshot,ensure_ascii=False),encoding='utf-8')
print('Created disposable migration fixture with multi-chunk ZIP, favorites, key, note and legacy storage.')
