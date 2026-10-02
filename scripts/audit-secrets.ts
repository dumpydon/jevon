import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

config({ path: '.env.local', quiet: true });
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const publishable = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const violations = new Set<string>();
for (const path of tracked) {
  if (
    /(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(path) &&
    basename(path) !== '.env.example'
  )
    violations.add(path);
}
function buildFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? buildFiles(path) : [path];
  });
}
const secret = process.env.TYPESAFE_API_KEY;
for (const path of new Set([...publishable, ...buildFiles('dist')])) {
  const content = readFileSync(path).toString('utf8');
  if (secret && (content.includes(secret) || content.includes(secret.slice(0, 12))))
    violations.add(path);
  if (
    /TYPESAFE_API_KEY\s*=\s*['"`]?(?!your_typesafe_api_key_here(?:\s|$|['"`]))[^\s'"`]{16,}/.test(
      content,
    )
  )
    violations.add(path);
}
if (violations.size) {
  console.error('Secret audit failed. Inspect these paths:', [...violations]);
  process.exit(1);
}
console.info(
  JSON.stringify({
    secretAudit: 'passed',
    trackedSecretFiles: 0,
    checkedPublishableFiles: publishable.length,
    checkedBuiltFiles: buildFiles('dist').length,
    configuredLocalKeyChecked: Boolean(secret),
  }),
);
