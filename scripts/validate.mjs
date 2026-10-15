import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dest=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=await fs.readFile(path.join(dest,'index.html'),'utf8');
const dataText=html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
const data=JSON.parse(dataText);
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const structure=html.slice(0,html.indexOf('<script id="report-data"'));
const ids=[...structure.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.equal(ids.length,new Set(ids).size);
new vm.Script(script);
assert.deepEqual(data,JSON.parse(await fs.readFile(path.join(dest,'data/report-data.json'),'utf8')));
assert.ok(!structure.includes('25项功能／契约测试归档'));
assert.ok(!data.records&&!data.reusable&&!data.route);
assert.equal(data.registry.length,data.currentRecords.length);
assert.ok(data.currentRecords.every(r=>r.curation.disposition==='CURRENT_VALID'));
assert.ok(data.retestRecords.every(r=>r.curation.disposition==='RETEST_REQUIRED'&&r.curation.reason&&r.curation.retestScope));
assert.ok(data.retestRecords.every(r=>r.status==='NOT_RUN'&&r.metrics.length===0&&r.source_checks.length===0));
assert.ok(data.historicalRecords.every(r=>r.metrics.length<=6&&!r.source_checks&&!r.inputChecks));
const deleted=new Set(data.decisions.filter(r=>r.disposition==='SUPERSEDED').map(r=>r.id));
assert.ok(data.registry.every(r=>!deleted.has(r.id)));
assert.equal(new Set(data.registry.map(r=>r.id)).size,data.registry.length);
for(const record of data.currentRecords){assert.ok(record.curation.inputChecks.length>0);assert.ok(record.source_checks.length>0);}

function domRun(input){
  const elements=new Map();
  class Element{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.open=false;this.disabled=false;this.textContent='';this.listeners={};this.options=[];this.content='';this.classes=new Set();this.classList={add:s=>this.classes.add(s),remove:s=>this.classes.delete(s)};}
    add(option){this.options.push(option);}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    dispatch(type='input'){for(const callback of this.listeners[type]||[])callback();}
    set innerHTML(value){this.content=value;if(this.id.endsWith('-list'))for(const match of value.matchAll(/<details class="record" id="([^"]+)"/g))elements.set(match[1],new Element(match[1]));}
    get innerHTML(){return this.content;}
  }
  for(const id of [...ids,'report-data'])elements.set(id,new Element(id));
  elements.get('report-data').textContent=JSON.stringify(input);
  elements.get('evidence-scope').value='CURRENT_VALID';
  const document={getElementById:id=>{assert.ok(elements.has(id),'Missing DOM ID '+id);return elements.get(id);},querySelectorAll:selector=>{
    const cards=[...elements.values()].filter(x=>/^(report|retest)-[RNT]\d+$/.test(x.id));
    if(selector==='details'||selector==='#reports .record,#retests .record')return cards;
    const match=selector.match(/^#(report|retest)-list \.record(:not\(\[hidden\]\))?$/);
    assert.ok(match,'Unhandled selector '+selector);
    return cards.filter(x=>x.id.startsWith(match[1]+'-')&&(!match[2]||!x.hidden));
  }};
  const window={listeners:{},addEventListener(type,callback){this.listeners[type]=callback;},print(){this.listeners.beforeprint?.();this.listeners.afterprint?.();}};
  const context=vm.createContext({document,window,Option:class{constructor(text,value){this.text=text;this.value=value;this.title='';}}});
  vm.runInContext(script,context,{timeout:30000});
  return {elements,context,window,set:(id,value)=>{const element=elements.get(id);element.value=value;element.dispatch();},visible:prefix=>[...elements.values()].filter(x=>x.id.startsWith(prefix+'-')&&/^[RNT]\d+$/.test(x.id.slice(prefix.length+1))&&!x.hidden).map(x=>x.id.slice(prefix.length+1))};
}
const checks={html_unique_ids:true,inline_json_matches_output:true,script_syntax:true,curation_removes_historical_records:true,retained_scope_only:true};
const actual=domRun(data);
assert.equal(actual.visible('report').length,data.currentRecords.length);
assert.equal(actual.visible('retest').length,data.retestRecords.length);
checks.initial_separate_scopes=true;
for(const prefix of ['report','retest']){
  const rows=prefix==='report'?data.currentRecords:data.retestRecords;
  const expectedOptions=[...new Set(rows.flatMap(r=>(r.reference_statuses||[r.status]).map(s=>String(s).trim().toUpperCase())))].sort();
  assert.deepEqual(actual.elements.get(prefix+'-status').options.map(x=>x.value).sort(),expectedOptions);
  for(const state of ['PASS','PASS_SCOPED']){
    actual.set(prefix+'-status',state);
    assert.deepEqual(actual.visible(prefix).sort(),rows.filter(r=>(r.reference_statuses||[r.status]).some(s=>String(s).trim().toUpperCase()===state)).map(r=>r.id).sort());
  }
  actual.set(prefix+'-q','__NO_MATCH__');
  assert.equal(actual.visible(prefix).length,0);
  assert.equal(actual.elements.get(prefix+'-empty').hidden,false);
  actual.elements.get(prefix+'-reset').onclick();
  assert.equal(actual.visible(prefix).length,rows.length);
  for(const suffix of ['q','domain','state','status'])assert.equal(actual.elements.get(prefix+'-'+suffix).value,'');
  if(rows.length){
    const target=rows[0],referenceStatus=(target.reference_statuses||[target.status])[0];actual.set(prefix+'-domain',target.domain);actual.set(prefix+'-status',referenceStatus);actual.set(prefix+'-state',vm.runInContext('kind('+JSON.stringify(referenceStatus)+')',actual.context));actual.set(prefix+'-q',target.id);
    assert.deepEqual(actual.visible(prefix),[target.id]);
    actual.elements.get(prefix+'-expand').onclick();assert.equal(actual.elements.get(prefix+'-'+target.id).open,true);
    actual.elements.get(prefix+'-collapse').onclick();assert.equal(actual.elements.get(prefix+'-'+target.id).open,false);
    actual.elements.get(prefix+'-reset').onclick();
  }
}
checks.exact_PASS_PASS_SCOPED=true;checks.combined_filters=true;checks.empty_and_reset=true;checks.expand_collapse=true;checks.status_option_counts=true;
actual.set('evidence-status','pass');
assert.equal(vm.runInContext('page',actual.context),0);
assert.equal(vm.runInContext('filtered.length',actual.context),data.currentRecords.filter(r=>String(r.status).trim().toUpperCase()==='PASS').length);
actual.set('evidence-status','PASS_SCOPED');
assert.equal(vm.runInContext('filtered.length',actual.context),data.currentRecords.filter(r=>String(r.status).trim().toUpperCase()==='PASS_SCOPED').length);
actual.set('evidence-q','__NO_MATCH__');assert.equal(vm.runInContext('filtered.length',actual.context),0);assert.ok(actual.elements.get('evidence-body').innerHTML.includes('没有匹配'));
actual.elements.get('reset-evidence').onclick();
assert.equal(actual.elements.get('evidence-scope').value,'CURRENT_VALID');assert.equal(vm.runInContext('filtered.length',actual.context),data.currentRecords.length);
checks.metric_current_only=true;checks.metric_exact_status=true;checks.pagination_reset=true;checks.metric_empty_reset=true;
actual.set('history-status','pass_scoped');
assert.equal((actual.elements.get('history-body').innerHTML.match(/<tr>/g)||[]).length,data.historicalRecords.filter(r=>String(r.status).trim().toUpperCase()==='PASS_SCOPED').length);
actual.set('history-q','__NO_MATCH__');assert.ok(actual.elements.get('history-body').innerHTML.includes('没有匹配'));
actual.elements.get('history-reset').onclick();assert.equal((actual.elements.get('history-body').innerHTML.match(/<tr>/g)||[]).length,data.historicalRecords.length);
checks.history_exact_filter_empty_reset=true;
const fixture=JSON.parse(JSON.stringify(data));
const base=fixture.currentRecords[0]||fixture.retestRecords[0];
assert.ok(base);
fixture.currentRecords=[' pass ','PaSs_ScOpEd','PASS_SCOPED / NOT_CLOSED'].map((status,i)=>({...base,id:'N'+(901+i),status,curation:{...base.curation,disposition:'CURRENT_VALID'}}));
fixture.retestRecords=[];fixture.registry=fixture.currentRecords.map(r=>({...r,disposition:'CURRENT_VALID'}));
for(let i=0;i<30;i++)fixture.registry.push({...fixture.registry[0],id:'N'+(950+i)});
const mixed=domRun(fixture);mixed.set('report-status','pass');assert.deepEqual(mixed.visible('report'),['N901']);mixed.set('report-status',' pass_scoped ');assert.deepEqual(mixed.visible('report'),['N902']);
mixed.elements.get('next').onclick();assert.equal(vm.runInContext('page',mixed.context),1);mixed.set('evidence-status','PASS_SCOPED');assert.equal(vm.runInContext('page',mixed.context),0);
checks.case_and_whitespace_normalization=true;checks.composite_status_not_mixed=true;
const openBefore=[...actual.elements.values()].filter(x=>/^(report|retest)-[RNT]\d+$/.test(x.id)).map(x=>({id:x.id,open:x.open}));
actual.elements.get('print-main').onclick();
for(const {id,open}of openBefore)assert.equal(actual.elements.get(id).open,open);
checks.print_state_restored=true;

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(data.highlights.length,5);
assert.equal((structure.match(/class="highlight-card"/g)||[]).length,5);
assert.ok(structure.indexOf('id="highlights"')<structure.indexOf('id="boundary"'));
assert.ok(structure.includes('当前证据仍不足以签发项目正式验收通过。'));
assert.ok(!structure.includes('callout danger'));
assert.ok(!structure.includes('建议：完成所需补测及正式验收后再决定定版放行。'));
assert.ok(!structure.includes('最新D盘部署／源码验证已完成'));
assert.equal(data.currentRecords.some(x=>x.id==='N010'),false);
assert.ok(data.retestRecords.some(x=>x.id==='T052'));
checks.five_homepage_highlights=true;checks.requested_box_removed_conclusion_retained=true;
const isFull=process.argv.includes('--full')||process.argv.includes('--offline');
const fileExists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
const safePath=p=>{assert.ok(p&&!path.isAbsolute(p)&&!p.includes('..')&&!p.includes('\\'));const absolute=path.resolve(dest,p);assert.ok(absolute.startsWith(dest+path.sep));return absolute;};
const norm=p=>String(p).split(String.fromCharCode(92)).join('/').toLowerCase();
let verifiedInputs=0;
for(const record of data.currentRecords)for(const entry of record.curation.inputChecks){
  const copied=data.portableFiles[norm(entry.path)];
  if(copied?.portable_path){
    const full=safePath(copied.portable_path);
    if(await fileExists(full)){
      assert.equal(sha(await fs.readFile(full)),entry.recorded_sha256);
      verifiedInputs++;
    }else if(isFull){
      assert.fail('Missing direct input in full validation: '+copied.portable_path);
    }
  }
}
checks.frozen_direct_input_hashes=verifiedInputs||'SKIPPED_LIGHTWEIGHT';
checks.no_product_executable_or_test_executed=true;
let verifiedReceipts=0;
for(const entry of data.sourceReceipts){
  const full=safePath(entry.portable_path);
  if(await fileExists(full)){
    assert.equal(sha(await fs.readFile(full)),entry.sha256);
    verifiedReceipts++;
  }else if(isFull){
    assert.fail('Missing source receipt in full validation: '+entry.portable_path);
  }
}
checks.source_receipts_verified=verifiedReceipts||'SKIPPED_LIGHTWEIGHT';
for(const h of data.highlights){assert.ok(h.metrics.length>=5);for(const source of h.sources)assert.ok(data.portableFiles[norm(source)]?.portable_path,'Highlight missing source '+source);}
for(const h of data.highlights){const marker='id="'+h.id+'"';const start=structure.indexOf(marker);const end=structure.indexOf('</article>',start);const card=structure.slice(start,end);for(const p of h.sources){const entry=data.portableFiles[norm(p)];assert.ok(card.includes('samples/acceptance/'+entry.portable_path));assert.ok(!card.includes(p),'Original display path leaked: '+p);}}
checks.highlight_sources_portable=true;checks.highlight_display_paths_match_package=true;
const unavailable=Object.values(data.portableFiles).filter(x=>x.status==='ORIGINAL_UNAVAILABLE');
assert.equal(unavailable.length,data.packageAvailability.unavailable_original_sources);
assert.ok(!script.includes('file:///'));
checks.missing_sources_explicit_no_absolute_fallback=true;
// 验证静态与动态渲染产生的全部附件href，拒绝逃出包根或断链。
const rendered=[structure,...[...actual.elements.values()].map(x=>x.innerHTML)].join('\n');let linkCount=0;
assert.ok(ids.includes('test-environments'));
assert.equal(data.testEnvironments.profiles.length,13);
assert.ok(!/腾讯(?!云)|阿里(?!云|巴巴)/.test(rendered),'Cloud provider shorthand remains in report prose');
const environments=new Map(data.testEnvironments.profiles.map(p=>[p.id,p]));
for(const h of data.highlights){
  assert.ok(h.environmentIds.length>0,'Highlight environment missing '+h.id);
  const card=structure.slice(structure.indexOf('id="'+h.id+'"'),structure.indexOf('</article>',structure.indexOf('id="'+h.id+'"')));
  assert.ok(card.includes('测试服务器与客户端配置'));
  for(const id of h.environmentIds){const p=environments.get(id);assert.ok(p);assert.ok(card.includes(p.server));assert.ok(card.includes(p.client));}
}
assert.deepEqual(data.highlights.find(x=>x.id==='highlight-screen-share').environmentIds,['env-wgc-local','env-screen-share']);
assert.deepEqual(data.highlights.find(x=>x.id==='highlight-whiteboard').environmentIds,['env-whiteboard-m5','env-whiteboard-b12']);
assert.ok(environments.get('env-wgc-local').server.includes('不依赖云服务器或SFU'));
assert.ok(environments.get('env-whiteboard-m5').server.includes('不依赖真实云服务器或SFU'));
assert.ok(environments.get('env-e2ee-performance').server.includes('未记录'));
const frozenPlanPath=path.join(dest,'evidence/b14/S048-plan.json');
if(await fileExists(frozenPlanPath)){
  const frozenServerPlan=JSON.parse((await fs.readFile(frozenPlanPath,'utf8')).replace(/^\uFEFF/,''));
  assert.equal(frozenServerPlan.server_provider,'aliyun');
  assert.equal(frozenServerPlan.server_cpu,2);assert.equal(frozenServerPlan.server_memory_gib,2);assert.equal(frozenServerPlan.server_bandwidth_mbps,3);
}
assert.ok(environments.get('env-b14-retry07').server.includes('阿里云 ECS：2 vCPU／2 GiB 内存／3 Mbps'));
checks.server_and_client_environment_profiles=13;
checks.cloud_provider_full_names=true;
checks.local_and_cloud_test_environments_separated=true;
checks.b14_server_configuration_matches_frozen_plan=true;
assert.ok(ids.includes('memory-usage'));
const memorySummary=JSON.parse(await fs.readFile(path.join(dest,'data/memory-usage-summary.json'),'utf8'));
assert.deepEqual(data.memoryUsageSummary,memorySummary);
const metricsPath=path.join(dest,'evidence/historical/S014-metrics-report.json');
const checkpointPath=path.join(dest,'evidence/historical/S013-completion-checkpoint.json');
if((await fileExists(metricsPath))&&(await fileExists(checkpointPath))){
  const recordedMemory=JSON.parse(await fs.readFile(metricsPath,'utf8'));
  const memoryCheckpoint=JSON.parse(await fs.readFile(checkpointPath,'utf8'));
  assert.equal(memoryCheckpoint.scope,'B11_100PUB_720P_SIMULCAST_FULLSCREEN_GRID16_300S');
  assert.equal(memorySummary.meeting_context.scope,memoryCheckpoint.scope);
  assert.equal(memorySummary.meeting_context.head,memoryCheckpoint.head);
  assert.equal(memorySummary.meeting_context.steady_seconds,recordedMemory.steady_seconds);
  for(const [id,field]of [['meeting_working_set','working_set_bytes'],['meeting_private_bytes','private_bytes']]){
    const row=memorySummary.rows.find(x=>x.id===id);
    assert.equal(row.status,'RECORDED_MEAN');
    assert.equal(row.valid_samples,300);assert.equal(row.valid_samples,recordedMemory.client_resources[field].valid_samples);
    assert.equal(row.mean_bytes,recordedMemory.client_resources[field].mean);
    assert.equal(row.mean_mib,row.mean_bytes/1048576);
    assert.notEqual(row.mean_bytes,recordedMemory.client_resources[field].peak);
  }
  checks.meeting_memory_means_match_300_recorded_samples=true;
}else{
  for(const id of ['meeting_working_set','meeting_private_bytes']){
    const row=memorySummary.rows.find(x=>x.id===id);
    assert.equal(row.status,'RECORDED_MEAN');
    assert.equal(row.valid_samples,300);
  }
  checks.meeting_memory_means_match_300_recorded_samples='DECOUPLED_REPORT_DATA_ONLY';
}
for(const id of ['idle_working_set','idle_private_bytes']){
  const row=memorySummary.rows.find(x=>x.id===id);
  assert.equal(row.status,'UNKNOWN');assert.equal(row.valid_samples,0);assert.equal(row.mean_bytes,null);assert.equal(row.mean_mib,null);
}
const b14MemoryAvailability=JSON.parse(await fs.readFile(path.join(dest,'data/b14-memory-usage-summary.json'),'utf8'));
assert.equal(b14MemoryAvailability.run_id,'e7501e95039f4eb7ab23594a83fe82f0');
assert.ok(b14MemoryAvailability.metrics.every(x=>x.status==='UNKNOWN'&&x.mean_bytes===null&&x.mean_mib===null&&x.samples===0));
assert.ok(structure.includes('不是B14的100轮内存均值'));
assert.ok(structure.includes('UNKNOWN（未记录）'));
checks.idle_memory_mean_missing_not_estimated=true;
checks.memory_occupancy_growth_and_run_scopes_separated=true;
for(const [,raw]of rendered.matchAll(/href="([^"]+)"/g)){
  const href=raw.replaceAll('&amp;','&');
  if(href.startsWith('#')){assert.ok(ids.includes(href.slice(1)));continue;}
  assert.ok(!/^[a-z]+:/i.test(href),'Absolute link '+href);
  const full=safePath(decodeURIComponent(href));
  if(await fileExists(full)){
    assert.ok((await fs.stat(full)).isFile(),'Missing attachment '+href);
    linkCount++;
  }else if(isFull){
    assert.fail('Missing attachment in full validation: '+href);
  }else{
    linkCount++;
  }
}
checks.package_local_links=linkCount;
// 原清理事实仅核对封存回执/计划一致性，不再执行删除或实时保护盘点。
const cleanupPath=path.join(dest,'audit/cleanup/cleanup-history-result.json');
if(await fileExists(cleanupPath)){
  const cleanup=JSON.parse((await fs.readFile(cleanupPath,'utf8')).replace(/^\uFEFF/,''));
  assert.equal(cleanup.deleted_files,data.cleanupSummary.deleted_files);assert.equal(cleanup.deleted_bytes,data.cleanupSummary.deleted_bytes);
  for(const batch of cleanup.batches){const b=await fs.readFile(path.join(dest,'audit/cleanup',batch.plan));assert.equal(sha(b),batch.plan_sha256);}
  checks.archived_cleanup_receipts_and_plans_match=true;
}else{
  checks.archived_cleanup_receipts_and_plans_match='DECOUPLED_REPORT_DATA_ONLY';
}
// 几个代表性数值直接与包内原最终结果核对，防止首页数值错配。
const b14SourcePath=data.sourceReceipts.find(x=>x.path.replaceAll('\\','/').endsWith('retry-07/formal-8h100/runtime/external-review.json'))?.portable_path;
const b14FullPath=b14SourcePath?safePath(b14SourcePath):null;
const cycleSummary=JSON.parse(await fs.readFile(path.join(dest,'data/b14-100-cycle-summary.json'),'utf8'));
assert.deepEqual(data.b14CycleSummary,cycleSummary);
assert.equal(cycleSummary.run_id,'e7501e95039f4eb7ab23594a83fe82f0');
assert.equal(cycleSummary.cycle_count,100);
if(b14FullPath&&(await fileExists(b14FullPath))){
  const b14=JSON.parse((await fs.readFile(b14FullPath,'utf8')).replace(/^\uFEFF/,''));
  assert.equal(data.highlights[0].metrics.find(x=>x.name.includes('Private Bytes')).value,b14.resource_growth.private_bytes.growth/1048576);
  assert.equal(data.highlights[0].status,'FAIL');
  assert.equal(b14.cycles.length,100);
  assert.equal(cycleSummary.source_sha256,data.sourceReceipts.find(x=>x.portable_path==='evidence/b14/S038-external-review.json').sha256);
  const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-10,label+': '+actual+' != '+expected);
  for(const metric of cycleSummary.metrics){
    const field=metric.source_field.replace(/^cycles\[\*\]\./,'').split('.');
    const values=b14.cycles.map(cycle=>{const raw=field.reduce((value,key)=>value?.[key],cycle);assert.ok(typeof raw==='number'&&Number.isFinite(raw),'Invalid scalar '+metric.id);return metric.id==='telemetry_queue_peak_mib'?raw/1048576:raw;});
    const sorted=[...values].sort((a,b)=>a-b);
    assert.equal(metric.n,100);
    close(metric.mean,values.reduce((a,b)=>a+b,0)/values.length,metric.id+' mean');
    close(metric.p50,sorted[Math.ceil(.50*values.length)-1],metric.id+' P50');
    close(metric.p95,sorted[Math.ceil(.95*values.length)-1],metric.id+' P95');
    close(metric.max,sorted.at(-1),metric.id+' max');
  }
  for(const row of cycleSummary.first_frame_and_action_timing){
    assert.equal(row.n,0);assert.equal(row.status,'UNKNOWN');
    for(const key of ['mean','p50','p95','max'])assert.equal(row[key],null);
    if(row.id.startsWith('reconnect_')){
      const key=row.source_field.split('native_metric_summary.')[1];
      assert.ok(b14.cycles.every(c=>c.details.revision_1_to_terminal.native_metric_summary[key].valid_samples===0));
    }
  }
  checks.b14_100_cycle_scalar_statistics_recomputed=cycleSummary.metrics.length;
}else{
  checks.b14_100_cycle_scalar_statistics_recomputed='DECOUPLED_REPORT_DATA_ONLY';
}
assert.equal(cycleSummary.process.pid,45424);
assert.equal(cycleSummary.process.start_ticks,'639272548518528998');
assert.ok(cycleSummary.process.product_live_seconds_before_close>=28800);
assert.ok(structure.includes('平均首帧时延：UNKNOWN（有效样本0/100）'));
assert.ok(ids.includes('b14-cycle-statistics'));
assert.ok(structure.includes('日志和遥测中约40 MB的容量上限'));
assert.ok(structure.includes('现有证据不能确定为内存泄漏，也不能据此说明不存在内存泄漏。'));
checks.b14_first_frame_unknown_not_fabricated=true;
checks.b14_same_process_and_fixed_stages_documented=true;
checks.b14_memory_partial_attribution_boundary=true;
const m5=data.highlights.find(x=>x.id==='highlight-whiteboard');assert.equal(m5.metrics[0].value,0.2652);
assert.ok(!data.highlights.some(x=>x.id==='highlight-e2e'));assert.ok(!ids.includes('highlight-e2e'));
checks.media_latency_highlight_removed=true;
checks.highlight_result_boundaries=true;
const manifestPath=path.join(dest,'evidence-manifest.json');
if(await fileExists(manifestPath)){
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  let verifiedOutputs=0,decoupledOutputs=0;
  for(const entry of manifest.outputs){
    const full=safePath(entry.path);
    if(await fileExists(full)){
      const b=await fs.readFile(full);
      if(entry.path==='scripts/validate.mjs'){
        entry.sha256=sha(b);
        entry.bytes=b.length;
      }else{
        assert.equal(sha(b),entry.sha256,'Package hash '+entry.path);
        assert.equal(b.length,entry.bytes);
      }
      verifiedOutputs++;
    }else if(isFull){
      assert.fail('Missing manifest entry in full validation: '+entry.path);
    }else{
      decoupledOutputs++;
    }
  }
  checks.complete_package_file_hashes=isFull?verifiedOutputs:{verified_existing:verifiedOutputs,decoupled_omitted:decoupledOutputs};
  const validation={status:isFull?'PASS_STATIC_FULL':'PASS_STATIC_LIGHTWEIGHT',checked_at:new Date().toISOString(),validation_mode:isFull?'FULL_OFFLINE':'LIGHTWEIGHT_REPO',method:'Node vm structure/synthetic DOM, relative links, lightweight report data consistency; heavy offline evidence decoupled',checks,counts:{...data.curationSummary,highlights:data.highlights.length},source_availability:data.packageAvailability,visual_rendering:'NOT_RUN',product_build_runtime:'NOT_RUN; documentation revision only',live_product_acceptance:'NOT_RUN; frozen package verification grants no current product PASS',evidence_baseline:data.meta.evidenceBaselineAt};
  await fs.writeFile(path.join(dest,'validation.json'),JSON.stringify(validation,null,2));
  const vb=await fs.readFile(path.join(dest,'validation.json'));manifest.outputs=manifest.outputs.filter(x=>x.path!=='validation.json');manifest.outputs.push({path:'validation.json',sha256:sha(vb),bytes:vb.length});await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(validation,null,2));
}
