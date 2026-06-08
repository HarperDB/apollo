/**
 * Pre-test setup: packs @harperdb/apollo and installs it into the test fixture.
 *
 * npm installs `file:../../` as a symlink, which breaks after setupHarperWithFixture
 * copies the fixture to a temp dir. Instead, we pack the root to a tgz and install it
 * using a path-resolved package.json so the fixture's node_modules contains real
 * extracted files that survive the recursive copy to a temporary Harper install dir.
 *
 * The fixture's source package.json (with `file:../../`) is restored after install,
 * keeping the working tree clean.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const packedDir = join(__dirname, 'packed');
const fixtureDir = join(__dirname, 'fixture');
const fixturePkgPath = join(fixtureDir, 'package.json');

// Clean and recreate the packed output directory
if (existsSync(packedDir)) {
	rmSync(packedDir, { recursive: true, force: true });
}
mkdirSync(packedDir, { recursive: true });

// Pack the root package into the packed dir
console.log('Packing @harperdb/apollo...');
execSync(`npm pack --pack-destination "${packedDir}"`, { cwd: repoRoot, stdio: 'inherit' });

// Find the produced tgz
const tgzFiles = readdirSync(packedDir).filter((f) => f.endsWith('.tgz'));
if (tgzFiles.length === 0) {
	throw new Error('npm pack did not produce a .tgz in integrationTests/packed/');
}
const tgzPath = join(packedDir, tgzFiles[0]);
console.log(`Packed: ${tgzFiles[0]}`);

// Save the original fixture package.json to restore later
const originalFixturePkg = readFileSync(fixturePkgPath, 'utf-8');

// Update the fixture package.json to reference the tgz via a path relative to the fixture dir
// (npm resolves file: deps relative to the package.json containing them)
const tgzRelPath = relative(fixtureDir, tgzPath).replace(/\\/g, '/');
const fixturePkg = JSON.parse(originalFixturePkg);
fixturePkg.dependencies['@harperdb/apollo'] = `file:${tgzRelPath}`;
writeFileSync(fixturePkgPath, JSON.stringify(fixturePkg, null, '\t') + '\n');

// Clean fixture node_modules so npm installs fresh
const fixtureNodeModules = join(fixtureDir, 'node_modules');
if (existsSync(fixtureNodeModules)) {
	rmSync(fixtureNodeModules, { recursive: true, force: true });
}
const fixtureLockfile = join(fixtureDir, 'package-lock.json');
if (existsSync(fixtureLockfile)) {
	rmSync(fixtureLockfile);
}

// Install fixture dependencies with the tgz-resolved package.json
console.log('Installing fixture dependencies...');
try {
	execSync('npm install', { cwd: fixtureDir, stdio: 'inherit' });
} finally {
	// Always restore the original fixture package.json so the working tree stays clean
	writeFileSync(fixturePkgPath, originalFixturePkg);
}

console.log('Fixture setup complete.');
