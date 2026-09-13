"""Archive only the explicit demo manifest: exclude caches, credentials and OS packages."""
import hashlib,json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]).resolve()
manifest=json.loads((root/'manifest.json').read_text())
if not manifest.get('somaDemo'):raise SystemExit('Not a SOMA demo directory')
archive=root.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name,expected in manifest['files'].items():
  file=root/name
  if root not in file.resolve().parents:raise SystemExit('Invalid path')
  if hashlib.sha256(file.read_bytes()).hexdigest()!=expected:raise SystemExit('Changed file: '+name)
  z.write(file,root.name+'/'+name)
 z.write(root/'manifest.json',root.name+'/manifest.json')
(root.parent/(archive.name+'.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
print(archive)
