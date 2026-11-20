/** Explicit production build/deploy helper. The default only prints a plan. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const production = Object.freeze({
  deployment: 'brilliant-jaguar-587',
  convex: 'https://brilliant-jaguar-587.convex.cloud',
  issuer: 'https://clerk.wokenet.putz.sh',
  site: 'https://wokenet.putz.sh',
  convexCliVersion: '1.24.8',
});
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const convexBin = 'node_modules/convex/bin/main.js';
const commands = [
  { name: 'Frontend types', args: ['node_modules/typescript/bin/tsc', '-b'] },
  { name: 'Convex types', args: ['node_modules/typescript/bin/tsc', '-p', 'convex/tsconfig.json', '--noEmit'] },
  { name: 'Tests', args: ['node_modules/vitest/vitest.mjs', 'run'] },
  { name: 'Verify server Clerk issuer', args: [convexBin, 'env', 'get', 'VITE_CLERK_FRONTEND_API_URL', '--prod'], capture: true },
  { name: 'Deploy Convex and build frontend', args: [convexBin, 'deploy', '--typecheck', 'enable', '--cmd', 'pnpm run build', '--cmd-url-env-var-name', 'VITE_CONVEX_URL'] },
];

export function validateProduction(env, { requireKey = false, cameraOrigin = JSON.parse(readFileSync(resolve(repo, 'src/kitchen-camera-config.json'), 'utf8')).cameraOrigin } = {}) {
  if (env.WOKENET_ORIGIN && env.WOKENET_ORIGIN !== production.site) throw Error('Set WOKENET_ORIGIN to the intended production Wokenet origin.');
  if ((requireKey || env.VITE_CONVEX_URL) && env.VITE_CONVEX_URL !== production.convex) throw Error('VITE_CONVEX_URL must select the existing production Convex deployment.');
  if ((requireKey || env.VITE_CLERK_FRONTEND_API_URL) && env.VITE_CLERK_FRONTEND_API_URL !== production.issuer) throw Error('VITE_CLERK_FRONTEND_API_URL must select the existing production Clerk issuer.');
  const key = env.VITE_CLERK_PUBLISHABLE_KEY;
  if ((requireKey || key) && (typeof key !== 'string' || !key.startsWith('pk_live_') ||
    Buffer.from(key.slice(8), 'base64').toString('utf8') !== new URL(production.issuer).hostname + '$')) {
    throw Error('Use the production Clerk publishable key for the existing Wokenet issuer.');
  }
  if (env.CONVEX_DEPLOYMENT && env.CONVEX_DEPLOYMENT !== `prod:${production.deployment}`) throw Error('CONVEX_DEPLOYMENT points away from the intended production deployment.');
  const deploymentKey = env.CONVEX_DEPLOY_KEY;
  if ((requireKey || deploymentKey) && (typeof deploymentKey !== 'string' ||
    !deploymentKey.startsWith(`prod:${production.deployment}|`) ||
    !/^[^|\s]+\|[^|\s]+$/.test(deploymentKey))) {
    throw Error('Supply the existing production deployment-specific CONVEX_DEPLOY_KEY through the environment; preview, project and other deployment keys are refused.');
  }
  for (const name of ['CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_OVERRIDE_ACCESS_TOKEN']) {
    if (env[name]) throw Error('Remove alternative Convex deployment/authentication overrides before using this production helper.');
  }
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') throw Error('Production deployment is refused from a Vercel preview or development build.');
  if (!cameraOrigin && !requireKey) return { cameraOrigin: null, configured: false, commands };
  let camera;
  try { camera = new URL(cameraOrigin); } catch { throw Error('Set cameraOrigin in src/kitchen-camera-config.json to the approved permanent HTTPS origin.'); }
  const hostname = camera.hostname;
  if (camera.protocol !== 'https:' || camera.origin !== cameraOrigin || camera.username || camera.password ||
    !hostname.includes('.') || isIP(hostname.replace(/^\[|\]$/g, '')) ||
    /(?:^|\.)(?:localhost|local|invalid|test|example)$/.test(hostname) || /(?:^|\.)example\.(?:com|net|org|edu)$/.test(hostname) ||
    [production.site, production.convex, production.issuer].includes(camera.origin)) {
    throw Error('cameraOrigin in src/kitchen-camera-config.json must be an approved HTTPS DNS origin, with no path, credentials or placeholder hostname.');
  }
  return { cameraOrigin: camera.origin, configured: true, commands };
}

export function checkProductionBuild(folder = resolve(repo, 'dist')) {
  if (!existsSync(resolve(folder, 'index.html'))) throw Error('Build dist/index.html first.');
  const forbidden = ['local-mirror-not-a-jwt', 'preview@example.invalid', 'LOCAL MIRROR', '/scripts/mirror/'];
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.isFile() && /\.(?:html|js|mjs|json)$/.test(entry.name)) {
        const content = readFileSync(path, 'utf8');
        if (forbidden.some(marker => content.includes(marker))) throw Error('Local mirror code was found in production assets.');
      }
    }
  }
  inspect(folder);
}

export async function runDeployment(env, { apply = false, execute, checkBuild = checkProductionBuild, cameraOrigin } = {}) {
  const plan = validateProduction(env, { requireKey: apply, cameraOrigin });
  if (!apply) return plan;
  const childEnv = { ...env, CONVEX_DEPLOYMENT: `prod:${production.deployment}` };
  const run = execute ?? ((command) => {
    const result = spawnSync(process.execPath, command.args, { cwd: repo, env: childEnv,
      stdio: command.capture ? 'pipe' : 'inherit', encoding: 'utf8', timeout: command.capture ? 120000 : 600000 });
    if (result.error || result.status !== 0) throw Error(`${command.name} failed; no subsequent deployment step was run.`);
    return result.stdout ?? '';
  });
  for (const command of commands) {
    const result = await run(command);
    if (command.name === 'Verify server Clerk issuer' && String(result).trim() !== production.issuer) {
      throw Error('Production Convex Clerk issuer does not match the existing Wokenet issuer.');
    }
  }
  checkBuild();
  return plan;
}

function printPlan() {
  console.log(`Pinned Convex CLI: ${production.convexCliVersion}; target ${production.convex}`);
  for (const command of commands) console.log(`  node ${command.args.map(arg => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`);
  console.log('  node scripts/deploy-camera-portal.mjs --check-build');
  console.log('This deploys Convex and produces dist. It does not publish Vercel or configure DNS, TLS, Pi access, provider settings or a GitHub PR.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--check-build', '--help'].includes(arg))) throw Error('Use --help, --check-build, or the explicit --apply flag.');
  if (args.includes('--help')) {
    console.log('Default: validate public settings and print a plan; no commands or network requests run.');
    console.log('Public camera URL: src/kitchen-camera-config.json. Access: current PUTZ membership in source. Apply reuses the existing Convex/Clerk build settings.');
    console.log('To apply: provide the existing production CONVEX_DEPLOY_KEY in the environment, then pass --apply.');
    printPlan();return;
  }
  if (args.includes('--check-build')) {
    if (args.length !== 1) throw Error('--check-build cannot be combined with another action.');
    checkProductionBuild();console.log('Production bundle excludes the isolated local mirror.');return;
  }
  printPlan();
  validateProduction(process.env, { requireKey: args.includes('--apply') });
  const installed = JSON.parse(readFileSync(resolve(repo, 'node_modules/convex/package.json'), 'utf8'));
  if (installed.version !== production.convexCliVersion) throw Error('Install the frozen pnpm lockfile before using the pinned production helper.');
  const result = await runDeployment(process.env, { apply: args.includes('--apply') });
  if(!result.configured)console.log('Camera hostname is pending in src/kitchen-camera-config.json; production apply is blocked.');
  console.log(args.includes('--apply') ? 'Convex deployment and frontend build completed. Vercel publication is a separate provider action.' : 'Plan only. Nothing deployed. Use --apply only after reviewing the target, settings and commands.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message);process.exitCode = 1; });
}
