'use strict';
// Read-only host code + isolated workers; only synthetic roots and fresh KV DBs.
// Usage: node probe-bg-memory-candidates.cjs HOST_ROOT MAINTAINED_PATCHER_ROOT MANIFEST OUTPUT [EXPERIMENT]
// EXPERIMENT permits only a verified Proxy.get edit in an isolated worker copy.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const [hostArg, maintainedArg, manifestArg, outputArg, experimentArg] = process.argv.slice(2);
assert.ok(hostArg && maintainedArg && manifestArg && outputArg, 'four arguments required');
const hostRoot = fs.realpathSync(hostArg), maintained = fs.realpathSync(maintainedArg);
const output = path.resolve(outputArg);
assert.ok(!fs.existsSync(output), 'use a new output path; preserve earlier evidence');
const requireHost = createRequire(path.join(hostRoot, 'package.json'));
const acorn = requireHost('acorn');
const Database = requireHost('better-sqlite3');
const hostNode = path.join(hostRoot, 'server/node');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifests = JSON.parse(fs.readFileSync(path.resolve(manifestArg), 'utf8'));
const experiment = experimentArg ? JSON.parse(fs.readFileSync(path.resolve(experimentArg), 'utf8')) : null;
const hiddenUnknown = experiment?.kind === 'hide-unimplemented-top-level';
let supportedMethods = [], fixture = null;
function walkAst(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) walkAst(child, visit);
        else if (value && typeof value === 'object') walkAst(value, visit);
    }
}
if (experiment) {
    assert.equal(experiment.purpose, 'capability-isolation-validation');
    assert.ok(['unmodified', 'hide-listener', 'hide-unimplemented-top-level'].includes(experiment.kind));
    const source = fs.readFileSync(path.join(maintained, 'patches/lazy-chat-bg-adapter/files-1.10/server/node/bgPluginHost.cjs'), 'utf8');
    const switches=[];
    walkAst(acorn.parse(source,{ecmaVersion:'latest'}),node=>{
        if(node.type==='SwitchStatement'&&node.discriminant.type==='Identifier'&&node.discriminant.name==='method')switches.push(node);
    });
    assert.equal(switches.length,1);
    supportedMethods=[...new Set(switches[0].cases.filter(c=>typeof c.test?.value==='string').map(c=>c.test.value))].sort();
    assert.deepEqual(supportedMethods,experiment.supportedMethods);
    fixture=experiment.fixture;
    assert.equal(hash(Buffer.from(JSON.stringify(fixture))),experiment.fixtureSha256);
    const dbSource=fs.readFileSync(fixture.allowedDbKeysFile,'utf8');
    assert.equal(hash(Buffer.from(dbSource)),fixture.allowedDbKeysSourceSha256);
    const match=dbSource.match(/export const allowedDbKeys = (\[[\s\S]*?\n\])/);
    assert.ok(match,'native allowedDbKeys declaration missing');
    const parsed=acorn.parse('const keys='+match[1],{ecmaVersion:'latest'}).body[0].declarations[0].init;
    assert.ok(parsed.elements.every(e=>e.type==='Literal'&&typeof e.value==='string'));
    assert.deepEqual(parsed.elements.map(e=>e.value),fixture.allowedDbKeys);
    assert.ok(Number.isSafeInteger(experiment.afterObservationMs)&&experiment.afterObservationMs>=0&&experiment.afterObservationMs<=5000);
}
const checkedFiles = new Map();
function checkHost(file) {
    if (checkedFiles.has(file)) return;
    const relative = path.relative(hostNode, file);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    if(experiment&&experiment.kind!=='unmodified'){
        // Session __dirname selects the child worker; pin the whole copied path.
        assert.equal(fs.realpathSync(file),file,'experiment CJS dependencies must be physical isolated copies');
    }
    const bytes = fs.readFileSync(file);
    const owners = ['lazy-chat-bg-adapter/files-1.10', 'lazy-chat-sync/files-1.10', 'bg-preserve/files']
        .map(owner => path.join(maintained, 'patches', owner, 'server/node', relative)).filter(p => fs.existsSync(p));
    assert.equal(owners.length, 1, 'resolve the maintained owner before testing: ' + relative);
    const base=fs.readFileSync(owners[0]);
    const modified=Boolean(experiment&&experiment.kind!=='unmodified'&&relative==='bgPluginWorker.cjs');
    if(modified){
        assert.equal(fs.realpathSync(file),file,'worker must be a physical isolated copy');
        assert.equal(hash(base),experiment.baseWorkerSha256);
        const anchor='            return Object.hasOwn(target, key) ? target[key] : (...args) => apiCall(key, args);';
        const original=base.toString('utf8');
        assert.equal(original.split(anchor).length,2,'Proxy edit anchor must be unique');
        let workerRange;
        walkAst(acorn.parse(original,{ecmaVersion:'latest'}),node=>{
            if(node.type==='FunctionDeclaration'&&node.id?.name==='runWorker')workerRange=[node.start,node.end];
        });
        assert.ok(workerRange&&original.indexOf(anchor)>workerRange[0]&&original.indexOf(anchor)<workerRange[1]);
        const guard=hiddenUnknown
            ? '            if (!Object.hasOwn(target, key) && !'+JSON.stringify(supportedMethods)+'.includes(key)) return undefined;'
            : "            if (key === 'addRisuChatListener') return undefined;";
        const expected=Buffer.from(original.replace(anchor,guard+'\n'+anchor));
        assert.ok(bytes.equals(expected),'only the declared Proxy.get edit is allowed');
        assert.equal(hash(bytes),experiment.variantWorkerSha256);
    }else assert.ok(bytes.equals(base), 'candidate/maintained source mismatch: ' + relative);
    checkedFiles.set(file, { path: relative, owner: path.relative(maintained, owners[0]), bytes: bytes.length, sha256: hash(bytes),
        baseSha256:hash(base),modified,realpath:fs.realpathSync(file) });
    for (const match of bytes.toString('utf8').matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
        checkHost(requireHost.resolve(path.resolve(path.dirname(file), match[1])));
    }
}
checkHost(path.join(hostNode, 'bgPluginHost.cjs'));
checkHost(path.join(hostNode, 'bgNotifications.cjs'));
const { createBgPluginHost } = requireHost('./server/node/bgPluginHost.cjs');
const { createBgNotifications } = requireHost('./server/node/bgNotifications.cjs');
const runDir = fs.mkdtempSync('/tmp/bg-memory-smoke-');
const env = { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` };
function slice() {
    const result = execFileSync('/usr/bin/systemctl', ['--user', 'show', 'pocketrisu-bg-plugin.slice',
        '-p', 'TasksCurrent', '-p', 'MemoryCurrent'], { env, encoding: 'utf8', timeout: 5000 });
    return Object.fromEntries(result.trim().split('\n').map(line => line.split('=')));
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function census(source) {
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true,
        allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    const roots = new Set(['Risuai', 'risuai']);
    const browser = new Set(['document', 'window', 'localStorage', 'navigator', 'Blob', 'FormData',
        'Event', 'EventTarget', 'location', 'fetch', 'indexedDB', 'WebSocket', 'Worker']);
    const api = new Map(), globals = new Map(), dynamic = [];
    // AC aliases the host through a conditional expression; minified RCM uses
    // unrelated locals named R. Do not treat those as host API accesses.
    function hostAlias(node) {
        return node?.type === 'Identifier' && roots.has(node.name)
            || node?.type === 'ConditionalExpression' && (hostAlias(node.consequent) || hostAlias(node.alternate));
    }
    function chain(node) {
        if (node.type === 'Identifier') return node.name;
        if (node.type !== 'MemberExpression') return null;
        const left = chain(node.object);
        const right = !node.computed && node.property.type === 'Identifier' ? node.property.name
            : node.computed && typeof node.property.value === 'string' ? node.property.value : null;
        return left && right ? left + '.' + right : null;
    }
    function walk(node, parent, key) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && hostAlias(node.init)) roots.add(node.id.name);
        if (node.type === 'MemberExpression') {
            const name = chain(node);
            if (name && roots.has(name.split('.')[0])) {
                const entry = api.get(name) ?? { member: name, count: 0, lines: [] };
                entry.count++; if (entry.lines.length < 8) entry.lines.push(node.loc.start.line); api.set(name, entry);
            } else if (node.computed && node.object.type === 'Identifier' && roots.has(node.object.name)) {
                dynamic.push({ line: node.loc.start.line, expression: source.slice(node.start, node.end) });
            }
        }
        if (node.type === 'Identifier' && browser.has(node.name)
            && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
            && !(parent?.type === 'Property' && key === 'key' && !parent.computed)) {
            const entry = globals.get(node.name) ?? { identifier: node.name, count: 0, lines: [] };
            entry.count++; if (entry.lines.length < 8) entry.lines.push(node.loc.start.line); globals.set(node.name, entry);
        }
        for (const [k, value] of Object.entries(node)) {
            if (['loc', 'start', 'end'].includes(k)) continue;
            if (Array.isArray(value)) for (const child of value) walk(child, node, k);
            else if (value && typeof value === 'object') walk(value, node, k);
        }
    }
    walk(ast);
    return { parser: `acorn ${acorn.version}`, apiRoots: [...roots], scope: 'lexical member/identifier census, not scope-resolved; guards/aliases require source review',
        api: [...api.values()].sort((a,b) => a.member.localeCompare(b.member)),
        browserIdentifiers: [...globals.values()], dynamic };
}
const controlScripts = {
    healthy: `await Risuai.addRisuReplacer('beforeRequest',async x=>x.concat({role:'system',content:'control-added'}));
        await Risuai.addRisuReplacer('afterRequest',async x=>x+' control-after');`,
    unknownCaught: `try{await Risuai.g2DeliberatelyUnsupportedApi();}catch{}
        await Risuai.addRisuReplacer('beforeRequest',async x=>x);`,
    bindingFailure: `await Risuai.addRisuReplacer('beforeRequest',async x=>{
        await Risuai.nativeFetch('http://127.0.0.1:1/g2-control',{method:'POST'});return x;});`,
    responding: `await Risuai.addRisuReplacer('beforeRequest',async x=>{
        const r=await Risuai.nativeFetch('http://127.0.0.1:1/g2-control',{method:'POST'});
        if(r.status!==200)throw Error('control_response_invalid');return x;});`,
    falseCapability: `try{
        if(typeof Risuai.g2OptionalListener==='function') await Risuai.g2OptionalListener();
        else await Risuai.addRisuReplacer('beforeRequest',async x=>x.concat({role:'system',content:'fallback-used'}));
    }catch{}`,
    hasGuard: `if('g2OptionalListener' in Risuai)throw Error('unexpected_has_capability');
        await Risuai.addRisuReplacer('beforeRequest',async x=>x.concat({role:'system',content:'has-fallback-used'}));`,
    capabilityShape: `if(typeof Risuai.getRuntimeInfo!=='function'||Risuai.apiVersion!=='3.0'
        ||typeof Risuai.pluginStorage.getItem!=='function')throw Error('accepted_surface_changed');
        const info=await Risuai.getRuntimeInfo();if(info.apiVersion!=='3.0')throw Error('runtime_info_changed');
        await Risuai.addRisuReplacer('beforeRequest',async x=>x.concat({role:'system',content:'accepted-surface-preserved'}));`,
};
async function runOne(label, plugin, localValues, transportMode) {
    const db = new Database(path.join(runDir, label + '.db'));
    db.exec('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT)');
    const readKeys = new Set();
    const kvGet = key => {readKeys.add(key);return db.prepare('SELECT value FROM kv WHERE key=?').get(key)?.value ?? null;};
    const kvSet = (key,value) => db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(key,value);
    const kvDel = key => db.prepare('DELETE FROM kv WHERE key=?').run(key);
    const kvList = prefix => db.prepare('SELECT key FROM kv WHERE substr(key,1,?)=? ORDER BY key').all(prefix.length,prefix).map(x=>x.key);
    const grants = ['db','replacer','provider','mainDom'];
    const keys = grants.map(permission => JSON.stringify([plugin.name,permission]));
    kvSet('cache/plugin-permissions/state.json', JSON.stringify({given:keys,denied:[],cache:keys.map(k=>[k+'_lastGrantTime',Date.now()])}));
    for(const [key,value] of Object.entries(localValues)) kvSet('cache/plugin-storage/'+Buffer.from(key).toString('base64url')+'.json',JSON.stringify(value));
    let root = { ...(fixture?.rootExtras??{}), plugins:[plugin], pluginCustomStorage:{}, characters:[{chaId:'g2-synthetic-character',name:'Synthetic',chatPage:0,
        chats:[{id:'g2-synthetic-chat',message:[{role:'user',data:'The brass key is in the blue drawer.',chatId:'g2-user-1'}],scriptstate:{}}]}] };
    const beforeHash = hash(Buffer.from(JSON.stringify(root)));
    const notifications = createBgNotifications({db,kvGet,kvSet,kvDel,kvList});
    const registry = Object.fromEntries(['replacerbeforeRequest','replacerafterRequest','editinput','editoutput','editprocess','editdisplay'].map(k=>[k,new Set()]));
    registry.providers = new Map();
    const controller = new AbortController(), events=[], diagnostics=[], network=[], critical=[], writes=[];
    const summary = () => Object.fromEntries(Object.entries(registry).map(([k,v])=>[k,v.size]));
    let stage='load', host;
    const started=performance.now();
    const result={label,pluginName:plugin.name,sha256:hash(Buffer.from(plugin.script)),transportMode,grants,events,diagnostics,network,critical,writes};
    const nativeFetch = async (url,options={}) => {
        // A transport fixture: never forwards any URL or reads external credentials.
        const parsed=new URL(url); network.push({stage,origin:parsed.origin,path:parsed.pathname,method:options.method??'GET'});
        if(transportMode==='throw') throw Object.assign(Error('g2_fixture_transport_denied'),{code:'g2_fixture_transport_denied'});
        if(parsed.pathname==='/g2-control') return Response.json({fixture:true});
        // No fake product protocol: a real JSON 503 is an observed backend outage.
        return Response.json({error:'g2_synthetic_backend_unavailable'},{status:503});
    };
    try {
        host=await createBgPluginHost({database:root,getDatabase:()=>root,getSelection:()=>({characterIndex:0,chatIndex:0}),hydrate:async x=>structuredClone(x),
            storageOwner:{peekRoot:()=>root,getRoot:async()=>root,writeRoot:async mutate=>{root=mutate(root);writes.push({stage,group:'root'});},
                kvGet,kvSet:(k,v)=>{kvSet(k,v);writes.push({stage,group:'local',key:k});},kvDel,kvList,transaction:task=>db.transaction(task)()},
            beforeEffect:()=>{},onCriticalFailure:error=>{critical.push(error.code??error.message);controller.abort(error);},
            publishNotification:(event,identity)=>{events.push(structuredClone(event));return identity?notifications.publishPluginFailure(event,identity):notifications.publish(event);},
            publishDiagnostic:event=>diagnostics.push(structuredClone(event)),
            operation:{operationId:randomUUID(),charId:'g2-synthetic-character',chatId:'g2-synthetic-chat'},signal:controller.signal,
            bindings:{registry,allowedDbKeys:fixture?.allowedDbKeys??['characters','plugins','pluginCustomStorage','pluginStorageMeta'],bodyInterceptors:[],
                characterMetadata:x=>({...x,chats:[]}),nativeFetch,risuFetch:nativeFetch,
                requestChatDataMain:async()=>{network.push({stage,kind:'model-denied'});throw Error('g2_fixture_model_denied');},
                installProvider:(name,fn)=>{registry.providers.set(name,fn);return()=>registry.providers.delete(name);}}});
        result.loadMs=performance.now()-started;result.registeredAfterLoad=summary();
        // Observe short delayed init; this is not 15s/45s/180s coverage.
        await sleep(150);result.registeredAfterObservation=summary();
        stage='before';let messages=[{role:'system',content:'[[RCM]]'},{role:'user',content:'Where is the brass key?'}];
        result.beforeCallbacksInvoked=0;
        for(const fn of registry.replacerbeforeRequest){result.beforeCallbacksInvoked++;messages=await fn(messages,'model');}
        result.beforeMessages=messages;
        stage='after';let answer='It is in the blue drawer.';
        result.afterCallbacksInvoked=0;
        for(const fn of registry.replacerafterRequest){result.afterCallbacksInvoked++;answer=await fn(answer,'model');}
        result.afterAnswer=answer;
        result.afterObservationMs=result.afterCallbacksInvoked>0?(experiment?.afterObservationMs??0):0;
        if(result.afterObservationMs)await sleep(result.afterObservationMs);
        await host.assertNotifications();
    } catch(error) {result.thrown={stage,code:error.code??null,message:error.message};}
    finally {
        stage='close';if(host){try{await host.close();}catch(error){result.closeError={code:error.code??null,message:error.message};}}
        result.closedRegistry=summary();result.wallMs=performance.now()-started;
        result.rootChanged=hash(Buffer.from(JSON.stringify(root)))!==beforeHash;
        result.durableNotices=kvList('internal/bg-notifications/v1/').map(k=>JSON.parse(kvGet(k)).event);
        result.kvReadKeys=[...readKeys].sort();
        db.close();
    }
    return result;
}
async function main(){
    const aliasControl=census('const R=typeof Risuai!=="undefined"?Risuai:risuai; R.addRisuReplacer();');
    assert.ok(aliasControl.api.some(x=>x.member==='R.addRisuReplacer'));
    assert.equal(census('function f(R){R.push(1);return R[0];}').api.length,0);
    const sources=manifests.map(row=>{
        const bytes=fs.readFileSync(path.resolve(row.file));assert.equal(hash(bytes),row.sha256,'original JS differs from pinned manifest');
        const script=bytes.toString('utf8');assert.ok(Buffer.from(script).equals(bytes));
        return {row,script,census:census(script)};
    });
    const baseline=slice();
    // Avoid attributing shared-slice work belonging to another request to this probe.
    assert.equal(Number(baseline.TasksCurrent),0,'plugin slice busy; retry after it becomes idle, never cancel work');
    const report={createdAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
        hostFiles:[...checkedFiles.values()],experiment:experiment??{kind:'unmodified',fixture:'legacy-smoke'},sqliteHarnessVersion:requireHost('better-sqlite3/package.json').version,
        baseline,transport:'binding fixture; respond means HTTP503 outage except HTTP200 for a control, not a successful product protocol',runDir,
        census:Object.fromEntries(sources.map(x=>[x.row.id,x.census])),runs:[]};
    for(const [name,script]of Object.entries(controlScripts)) report.runs.push(await runOne('control-'+name,{name:'g2-control-'+name,version:'3.0',enabled:true,script,realArg:{}},{},name==='bindingFailure'?'throw':'respond'));
    const healthy=report.runs[0];assert.equal(healthy.registeredAfterLoad.replacerbeforeRequest,1);assert.equal(healthy.beforeMessages.at(-1).content,'control-added');assert.ok(healthy.afterAnswer.endsWith('control-after'));assert.equal(healthy.events.length,0);
    if(hiddenUnknown){assert.equal(report.runs[1].events.length,0);assert.equal(report.runs[1].beforeCallbacksInvoked,1);}
    else assert.ok(report.runs[1].events.some(e=>e.code==='plugin_api_unsupported'));
    // disable() normalizes non-permission/non-API errors to plugin_hook_failed.
    assert.equal(report.runs[2].network.length,1);
    assert.ok(report.runs[2].events.some(e=>e.code==='plugin_hook_failed' && e.phase==='before_request' && e.effectsMayHaveOccurred));
    assert.equal(report.runs[3].network.length,1);assert.equal(report.runs[3].events.length,0);
    if(hiddenUnknown){assert.equal(report.runs[4].events.length,0);assert.equal(report.runs[4].beforeMessages.at(-1).content,'fallback-used');}
    else{
        assert.ok(report.runs[4].events.some(e=>e.code==='plugin_api_unsupported'));
        assert.equal(report.runs[4].registeredAfterLoad.replacerbeforeRequest,0);
        assert.equal(report.runs[4].beforeCallbacksInvoked,0);
    }
    assert.equal(report.runs[5].events.length,0);assert.equal(report.runs[5].beforeMessages.at(-1).content,'has-fallback-used');
    assert.equal(report.runs[6].events.length,0);assert.equal(report.runs[6].beforeMessages.at(-1).content,'accepted-surface-preserved');
    for(const {row,script} of sources){
        const plugin={name:row.name,version:'3.0',enabled:true,script,realArg:{}};
        assert.ok(!row.arms||row.arms.length>0&&row.arms.every(a=>['empty','configured'].includes(a)));
        assert.ok(!row.transports||row.transports.length>0&&row.transports.every(a=>['throw','respond'].includes(a)));
        for(const arm of [{name:'empty',values:{}}, {name:'configured',values:row.localValues??{}}].filter(a=>!row.arms||row.arms.includes(a.name))){
            const configured=structuredClone(plugin);if(arm.name==='configured')configured.realArg=row.realArg??{};
            for(const mode of row.transports??['throw','respond'])report.runs.push(await runOne(`${row.id}-${arm.name}-${mode}`,configured,arm.values,mode));
        }
        assert.equal(hash(fs.readFileSync(path.resolve(row.file))),row.sha256);
    }
    let final;
    for(let i=0;i<40;i++){final=slice();if(Number(final.TasksCurrent)===0)break;await sleep(50);}
    report.final=final;assert.equal(Number(final.TasksCurrent),0,'slice did not settle; inspect owned workers without cancelling unrelated work');
    for(const run of report.runs){assert.ok(Object.values(run.closedRegistry).every(n=>n===0));assert.ok(!run.closeError);}
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({output,runs:report.runs.map(r=>({label:r.label,registered:r.registeredAfterLoad,events:r.events.map(e=>({code:e.code,detail:e.message})),network:r.network.length,thrown:r.thrown})),final},null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
