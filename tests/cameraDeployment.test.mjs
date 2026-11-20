import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkProductionBuild, production, runDeployment as originalRun, validateProduction as originalValidate } from '../scripts/deploy-camera-portal.mjs';

const publicSettings = () => ({
  WOKENET_ORIGIN: production.site,
  VITE_CONVEX_URL: production.convex,
  VITE_CLERK_FRONTEND_API_URL: production.issuer,
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from(new URL(production.issuer).hostname + '$').toString('base64'),
});
const deploySettings = () => ({ ...publicSettings(), CONVEX_DEPLOY_KEY: `prod:${production.deployment}|test-deploy-secret` });
const cameraOrigin='https://kitchen-camera.putz.sh';
const validateProduction=(env,options={})=>originalValidate(env,{cameraOrigin,...options});
const runDeployment=(env,options={})=>originalRun(env,{cameraOrigin,...options});
const folders=[];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw Error('Refuse cleanup outside the test temporary directory.');
    rmSync(folder, { recursive:true, force:true });
  }
});

describe('explicit camera production deployment', () => {
  it('defaults to a plan and never invokes commands without apply', async () => {
    const execute=vi.fn(),checkBuild=vi.fn();
    const result=await runDeployment(publicSettings(), { execute,checkBuild });
    expect(result.cameraOrigin).toBe('https://kitchen-camera.putz.sh');
    expect(execute).not.toHaveBeenCalled();expect(checkBuild).not.toHaveBeenCalled();
  });
  it('rejects conflicting existing production build settings and credentials', () => {
    for (const name of ['VITE_CONVEX_URL','VITE_CLERK_FRONTEND_API_URL','VITE_CLERK_PUBLISHABLE_KEY']) {
      expect(() => validateProduction({ ...deploySettings(),[name]:undefined },{requireKey:true})).toThrow();
    }
    expect(() => validateProduction({ ...publicSettings(),VITE_CLERK_PUBLISHABLE_KEY:'pk_test_fixture' })).toThrow();
  });
  it('refuses unsafe, temporary and placeholder camera endpoints', () => {
    for (const origin of ['http://kitchen-camera.putz.sh','/camera-api','https://localhost','https://127.0.0.1',
      'https://camera.local','https://camera.example.invalid','https://camera.example.edu',
      'https://user:password@kitchen-camera.putz.sh','https://kitchen-camera.putz.sh/api',production.site,production.convex,production.issuer]) {
      expect(() => validateProduction(publicSettings(),{cameraOrigin:origin})).toThrow();
    }
  });
  it('refuses missing, preview, project, dev, legacy and other production deployment keys before execution', async () => {
    for (const key of [undefined,'preview:team:project|secret','project:anything|secret','dev:brilliant-jaguar-587|secret',
      'prod:other-deployment|secret','legacy-secret',`prod:${production.deployment}|`]) {
      const execute=vi.fn();
      await expect(runDeployment({ ...publicSettings(),CONVEX_DEPLOY_KEY:key },{ apply:true,execute })).rejects.toThrow('production deployment-specific');
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('refuses conflicting selectors, alternate auth and Vercel preview builds', () => {
    expect(() => validateProduction({ ...deploySettings(),CONVEX_DEPLOYMENT:'dev:another-deployment' })).toThrow();
    expect(() => validateProduction({ ...deploySettings(),CONVEX_SELF_HOSTED_URL:'http://127.0.0.1' })).toThrow();
    expect(() => validateProduction({ ...deploySettings(),CONVEX_OVERRIDE_ACCESS_TOKEN:'secret' })).toThrow();
    expect(() => validateProduction({ ...deploySettings(),VERCEL_ENV:'preview' })).toThrow();
  });
  it('uses repository configuration without requiring new camera environment flags', async () => {
    const execute=vi.fn();
    const result=await runDeployment({...publicSettings(),CAMERA_ACCESS:'unused'}, {execute});
    expect(result.cameraOrigin).toBe(cameraOrigin);expect(execute).not.toHaveBeenCalled();
    const pending=originalValidate({},{cameraOrigin:''});expect(pending.configured).toBe(false);
    expect(()=>originalValidate(deploySettings(),{requireKey:true,cameraOrigin:''})).toThrow('cameraOrigin');
  });
  it('does not deploy if the real backend uses another Clerk issuer', async () => {
    const seen=[],execute=async command=>{seen.push(command);return 'https://other.clerk.example\n';};
    await expect(runDeployment(deploySettings(),{ apply:true,execute })).rejects.toThrow('Clerk issuer does not match');
    expect(seen.some(command=>command.name==='Deploy Convex and build frontend')).toBe(false);
  });
  it('stops before deployment when a required local check fails', async () => {
    const seen=[],execute=async command=>{seen.push(command);if(command.name==='Convex types')throw Error('typecheck failed');return '';};
    await expect(runDeployment(deploySettings(),{ apply:true,execute })).rejects.toThrow('typecheck failed');
    expect(seen.some(command=>command.name==='Deploy Convex and build frontend')).toBe(false);
  });
  it('checks the existing remote Clerk issuer before the pinned deploy/build and bundle guard', async () => {
    const seen=[],checkBuild=vi.fn(),execute=async command=>{
      seen.push(command);
      if(command.name==='Verify server Clerk issuer')return production.issuer+'\n';
      return '';
    };
    await runDeployment(deploySettings(),{ apply:true,execute,checkBuild });
    expect(seen.at(-1).args).toEqual(['node_modules/convex/bin/main.js','deploy','--typecheck','enable','--cmd','pnpm run build','--cmd-url-env-var-name','VITE_CONVEX_URL']);
    expect(seen.at(-2).capture).toBe(true);
    expect(seen.some(command=>command.args.includes('CAMERA_ACCESS'))).toBe(false);
    expect(checkBuild).toHaveBeenCalledTimes(1);
  });
  it('prints a concrete dry-run plan without disclosing a deployment key', () => {
    const result=spawnSync(process.execPath,['scripts/deploy-camera-portal.mjs'],{ cwd:process.cwd(),env:{ ...process.env,...deploySettings(),CONVEX_DEPLOYMENT:`prod:${production.deployment}` },encoding:'utf8' });
    expect(result.status).toBe(0);expect(result.stdout).toContain('Plan only. Nothing deployed.');
    expect(result.stdout).toContain('pnpm run build');expect(result.stdout).not.toContain('test-deploy-secret');
  });
});

describe('production bundle boundary', () => {
  it('rejects an absent build or local-mirror code in a built asset', () => {
    const folder=mkdtempSync(join(tmpdir(),'wokenet-build-'));folders.push(folder);
    expect(()=>checkProductionBuild(folder)).toThrow('Build dist/index.html first');
    writeFileSync(join(folder,'index.html'),'<script src="/assets/main.js"></script>');mkdirSync(join(folder,'assets'));
    writeFileSync(join(folder,'assets/main.js'),'console.log("production");');
    expect(()=>checkProductionBuild(folder)).not.toThrow();
    writeFileSync(join(folder,'assets/main.js'),'const token="local-mirror-not-a-jwt";');
    expect(()=>checkProductionBuild(folder)).toThrow('Local mirror code');
  });
});
