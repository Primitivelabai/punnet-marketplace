// Zips extension/ to dist/punnet-<version>.zip for the Chrome Web Store.
import { readFileSync, mkdirSync, rmSync, statSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const { version } = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
const dist = join(root, 'dist');
const out = join(dist, `punnet-${version}.zip`);

mkdirSync(dist, { recursive: true });
rmSync(out, { force: true });

// Dev files never ship: Chrome's _metadata, source maps, OS junk.
const dev = /(^|[\\/])(_metadata|node_modules|\.git)([\\/]|$)|\.map$|\.DS_Store$|Thumbs\.db$/;
const files = [];
(function walk(d) {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (dev.test(p.slice(ext.length))) continue;
    if (n.isDirectory()) walk(p);
    else files.push(p);
  }
})(ext);

if (process.platform === 'win32') {
  // Compress-Archive on Windows PowerShell 5 writes backslash entry names, which the store rejects,
  // so build the zip with .NET and forward-slash names.
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z=[System.IO.Compression.ZipFile]::Open('${out.replace(/'/g, "''")}','Create')`,
    `foreach($f in @(${list})){`,
    `$n=$f.Substring(${ext.length + 1}).Replace('\\','/')`,
    `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$f,$n,'Optimal')}`,
    '$z.Dispose()',
  ].join('\n');
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-X', out, '.', '-x', '*.map', '-x', '*/_metadata/*', '-x', '.DS_Store'], { cwd: ext, stdio: 'inherit' });
}

if (!existsSync(out)) throw new Error('zip was not created');
console.log(`${out} (${files.length} files, ${(statSync(out).size / 1024).toFixed(1)} KB)`);
