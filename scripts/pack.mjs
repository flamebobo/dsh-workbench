// Builds the plugin and produces dist/workbench-plugin-<version>.zip: the plugin files, the install scripts and the install guide,
// plus dist/latest.json, a template for the update address (see core/src/update.ts).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' })
const pkg = JSON.parse(readFileSync('dsh-plugin/package.json', 'utf8'))
const name = `workbench-plugin-${pkg.version}`
const stage = `dist/${name}`
rmSync(stage, { recursive: true, force: true })
mkdirSync(`${stage}/dsh-plugin`, { recursive: true })
// exactly what the plugin needs at run time: the bundles, the patch, the locale and icon, the example skill pack
for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'package.json', 'locale', 'examples']) cpSync(`dsh-plugin/${f}`, `${stage}/dsh-plugin/${f}`, { recursive: true })
for (const f of ['install.sh', 'install.ps1', 'INSTALL.md']) cpSync(`scripts/install/${f}`, `${stage}/${f}`)
chmodSync(`${stage}/install.sh`, 0o755)
writeFileSync(`${stage}/VERSION`, `${pkg.version}\n`)

rmSync(`dist/${name}.zip`, { force: true })
execFileSync('zip', ['-qr', `${name}.zip`, name], { cwd: 'dist' })
const sha = createHash('sha256').update(readFileSync(`dist/${name}.zip`)).digest('hex')
writeFileSync('dist/latest.json', JSON.stringify({ version: pkg.version, url: `https://<内网下载地址>/${name}.zip`, notes: '<这个版本改了什么>', sha256: sha }, null, 2) + '\n')
console.log(`dist/${name}.zip  sha256 ${sha}`)
