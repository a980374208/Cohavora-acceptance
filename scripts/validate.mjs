import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {consolidateTests} from './consolidate-tests.mjs';
import {validateReportLayout} from './validate-report-layout.mjs';
import {refreshCompleted} from './refresh-completed.mjs';
import {refreshHistory} from './refresh-history.mjs';
import {refreshStage} from './refresh-stage.mjs';
import {refreshPlanResults} from './refresh-plan-results.mjs';
import {refreshStageReport} from './render-stage-closure.mjs';
const dest=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=await fs.readFile(path.join(dest,'index.html'),'utf8');
const dataText=html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
const data=JSON.parse(dataText);
const baseline=JSON.parse(await fs.readFile(path.join(dest,'data/report-input.json'),'utf8'));
const testPlan=JSON.parse(await fs.readFile(path.join(dest,'data/test-plan.json'),'utf8'));
assert.deepEqual(data.timingMeasurements,testPlan.timing_measurements,'Timing definitions must come from the maintained test plan');
const baselineBefore=JSON.stringify(baseline),derived=consolidateTests(baseline);
assert.equal(JSON.stringify(baseline),baselineBefore,'Consolidation must preserve the frozen input catalog');
assert.deepEqual(data.consolidation,derived.consolidation,'Generated consolidation differs from the maintained plan');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.equal(script.trim(),(await fs.readFile(path.join(dest,'assets/report.js'),'utf8')).trim(),'Embedded client script must match its maintained source');
const structure=html.slice(0,html.indexOf('<script id="report-data"'));
derived.b14CycleSummary=JSON.parse(await fs.readFile(path.join(dest,'data/b14-100-cycle-summary.json'),'utf8'));
derived.testEnvironments=JSON.parse(await fs.readFile(path.join(dest,'data/test-environments.json'),'utf8'));
derived.memoryUsageSummary=JSON.parse(await fs.readFile(path.join(dest,'data/memory-usage-summary.json'),'utf8'));
await refreshCompleted(dest,derived,{writeEvidence:false});
await refreshHistory(dest,derived,{writeEvidence:false});
const beforeStage=structuredClone({highlights:derived.highlights,retestRecords:derived.retestRecords,b14CycleSummary:derived.b14CycleSummary,memoryUsageSummary:derived.memoryUsageSummary});
await refreshStage(dest,derived,{writeEvidence:false});
const beforePlanResults=structuredClone(derived.retestRecords);
await refreshPlanResults(dest,derived);
const beforeP10Records=structuredClone(derived.retestRecords);
for(const [index,record] of derived.retestRecords.entries()){
  const {completed_results,...unchanged}=record;
  assert.deepEqual(unchanged,beforePlanResults[index],'Completed result display must not change group assessments, gate definitions or boundaries');
  if(record.plan_kind==='product')assert.ok(Array.isArray(completed_results),'Every product group needs an explicit completed-result list');
  else assert.equal(completed_results,undefined,'Auxiliary plans keep their existing display');
}
const latestP10Source='reports/product/p10-long-soak-results-20261027.json';
const latestP10Report=latestP10Source.replace(/\.json$/,'.html');
let latestP10Bytes,latestP10;
try{latestP10Bytes=await fs.readFile(path.join(dest,latestP10Source));}
catch(error){if(error.code!=='ENOENT')throw error;}
if(latestP10Bytes){
  latestP10=JSON.parse(latestP10Bytes.toString('utf8').replace(/^\uFEFF/,''));
  assert.equal(latestP10.status,'PASS_SCOPED');assert.equal(latestP10.raw_status,undefined);assert.equal(latestP10.current_disposition,undefined);
  assert.equal(latestP10.full_gate_credit,0);assert.equal(latestP10.formal_credit,0);assert.equal(latestP10.release_eligible,false);
  assert.equal(latestP10.runs.length,2);
  assert.deepEqual(latestP10.runs.map(run=>run.status),['PASS_SCOPED','INCONCLUSIVE']);
  assert.ok(latestP10.runs.every(run=>run.raw_status===undefined&&run.current_disposition===undefined));
  assert.equal(latestP10.acceptance_policy.server_net_rx_drops.role,'record_only');
  assert.equal(latestP10.acceptance_policy.server_net_rx_drops.threshold,null);
  assert.equal(latestP10.acceptance_policy.server_net_rx_drops.recording_required,true);
  assert.equal(latestP10.policy_id,'P10_HOLD_RECOVERY_MEDIA_V2_20261027');
  assert.equal(latestP10.acceptance_policy.policy_id,latestP10.policy_id);
  assert.equal(latestP10.acceptance_policy.wall_duration.role,'efficiency_record_only');
  assert.equal(latestP10.acceptance_policy.wall_duration.threshold,null);
  assert.equal(latestP10.acceptance_policy.wall_duration.recording_required,true);
  assert.equal(latestP10.acceptance_policy.execution_watchdog.role,'execution_guard');
  assert.equal(latestP10.acceptance_policy.execution_watchdog.limit_seconds,10500);
  for(const [index,run]of latestP10.runs.entries()){
    const review=run.reassessment;
    assert.equal(review.policy_id,latestP10.policy_id);
    assert.equal(review.date,'2026-10-27');
    assert.equal(review.method,'OFFLINE_REASSESSMENT_EXISTING_EVIDENCE');
    assert.equal(review.status,index===0?'PASS_SCOPED':'INCONCLUSIVE');
    assert.deepEqual(Object.keys(review.criteria).sort(),Object.keys(run.criteria).sort());
    const reviewCounts={};
    for(const [name,criterion]of Object.entries(review.criteria)){
      const expected=run.criteria[name].status;
      assert.equal(criterion.status,expected,'Published criterion status must match its current reassessment');
      assert.ok(criterion.source_locator.startsWith('/runs/'+index+'/criteria/'+name),'Reassessment must identify its criterion source');
      reviewCounts[criterion.status]=(reviewCounts[criterion.status]||0)+1;
    }
    assert.deepEqual(review.criteria_status_counts,reviewCounts);
    assert.deepEqual(reviewCounts,index===0?{PASS:10}:{PASS:7,INCONCLUSIVE:3});
    assert.ok(review.effective_hold.fixed_seconds>=1800&&review.effective_hold.mixed_seconds>=7200&&review.effective_hold.recovered_seconds>=60);
    assert.equal(review.effective_hold.status,'PASS');
    assert.equal(review.action_recovery.command_count,168);assert.equal(review.action_recovery.all_converged,true);
    assert.equal(review.action_recovery.soft_reconnect_count,9);assert.equal(review.action_recovery.full_reconnect_count,9);
    assert.equal(review.action_recovery.status,'PASS');
    assert.equal(review.media_quality.fixed_status,'PASS');assert.equal(review.media_quality.recovered_status,'PASS');
    assert.equal(review.media_quality.audio_status,run.criteria.audio_healthy_windows.status);
    assert.equal(review.media_quality.status,index===0?'PASS':'INCONCLUSIVE');
    assert.equal(review.execution_watchdog.limit_seconds,10500);
    assert.equal(review.execution_watchdog.observed_wall_seconds,run.timing.wall_seconds);
    assert.ok(review.execution_watchdog.observed_wall_seconds<review.execution_watchdog.limit_seconds);
    assert.equal(review.execution_watchdog.triggered,false);assert.equal(review.execution_watchdog.status,'PASS');
    assert.equal(review.efficiency.role,'efficiency_record_only');
    assert.equal(review.efficiency.wall_seconds,run.timing.wall_seconds);
  }
  assert.equal(latestP10.runs[0].criteria.server_resources.host.metrics.zero_growth_deltas.net_rx_drops,45);
  assert.equal(new Set(latestP10.runs.map(run=>run.run_id)).size,2);
  assert.ok(latestP10.runs.every(run=>run.run_id&&run.full_gate_credit===0&&run.formal_credit===0));
  const projection=latestP10.plan_projection,allowed=new Set(['status','date','stage_status','reference_statuses','evidence_scope','validity','limitations','sources','environmentIds','completed_results','full_gate_credit']);
  assert.ok(Object.keys(projection).every(key=>allowed.has(key)),'Latest P10 must preserve the maintained plan definitions');
  assert.equal(projection.status,'PASS_SCOPED');assert.equal(projection.stage_status.status,'PASS_SCOPED');
  assert.equal(projection.full_gate_credit,0);assert.equal(projection.stage_status.full_gate_credit,0);
  assert.equal(projection.date,projection.stage_status.as_of);
  assert.deepEqual(projection.stage_status.gates.map(gate=>gate.status),['PASS_SCOPED','PASS_SCOPED','PASS_SCOPED','NOT_RUN']);
  assert.deepEqual(projection.reference_statuses,[],'Current P10 presentation must omit superseded historical statuses');
  assert.deepEqual(projection.stage_status.retained_failures,[],'Current P10 presentation must omit superseded historical failures');
  assert.deepEqual(projection.stage_status.gates.map(gate=>gate.definition),testPlan.groups.find(group=>group.plan_code==='P10').gates);
  const record=derived.retestRecords.find(row=>row.plan_code==='P10'),previousPlan=structuredClone(record);
  Object.assign(record,structuredClone(projection));
  const runResults=record.completed_results.filter(result=>result.source_path===latestP10Source);
  assert.equal(runResults.length,2,'Both completed long-soak runs must remain independent');
  assert.ok(runResults.every(result=>result.current_disposition===undefined),'Current revised-policy results must be published directly');
  for(const [index,run]of latestP10.runs.entries())assert.equal(runResults.find(result=>result.source_locator==='/runs/'+index+'/status')?.status,run.status);
  assert.equal(latestP10.highlight.id,'highlight-p10');
  const profileIds=new Set(latestP10.environment_profiles.map(profile=>profile.id));
  assert.equal(profileIds.size,latestP10.environment_profiles.length);
  assert.ok(latestP10.highlight.environmentIds.length>0&&latestP10.highlight.environmentIds.every(id=>profileIds.has(id)));
  derived.testEnvironments.profiles=[...derived.testEnvironments.profiles.filter(profile=>!profileIds.has(profile.id)),...structuredClone(latestP10.environment_profiles)];
  derived.retainedHighlights=[structuredClone(derived.highlights.find(highlight=>highlight.id==='highlight-e2ee'))];
  const cards=new Map(derived.highlights.map(highlight=>[highlight.id,highlight]));
  cards.set('highlight-p10',{...structuredClone(latestP10.highlight),report_path:latestP10Report});
  derived.highlights=['highlight-b14','highlight-p10','highlight-b15','highlight-screen-share','highlight-whiteboard'].map(id=>cards.get(id));
  await refreshStageReport(dest,derived,{writeEvidence:false});
  const sources=[];
  for(const relative of new Set([latestP10Source,latestP10Report,...latestP10.highlight.sources,...record.sources,...latestP10.environment_profiles.flatMap(profile=>profile.sources.map(source=>source.path))])){
    const absolute=path.resolve(dest,relative),within=path.relative(dest,absolute);
    assert.ok(within&&!within.startsWith('..')&&!path.isAbsolute(within));
    const bytes=relative===latestP10Source?latestP10Bytes:await fs.readFile(absolute);
    const receipt={original_path:relative,portable_path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,status:'COMPLETED_P10_RESULT_SOURCE'};
    for(const name of [relative,absolute])derived.portableFiles[name.replaceAll('\\','/').toLowerCase()]=receipt;
    sources.push({path:relative,sha256:receipt.sha256,bytes:receipt.bytes});
  }
  const summary=derived.completedResultProjection.groups.find(group=>group.plan_code==='P10');
  Object.assign(summary,{completed_result_count:record.completed_results.length,
    status_counts:record.completed_results.reduce((counts,result)=>{counts[result.status]=(counts[result.status]||0)+1;return counts;},{}),
    current_status_counts:record.completed_results.reduce((counts,result)=>{const status=result.current_disposition?.status||result.status;counts[status]=(counts[status]||0)+1;return counts;},{})});
  delete summary.empty_reason;
  derived.completedResultProjection.sources=[...derived.completedResultProjection.sources.filter(source=>source.path!==latestP10Source),sources.find(source=>source.path===latestP10Source)];
  const runSummaryFields=['run_id','label','status','full_gate_credit','formal_credit','qualification_credit','release_eligible'];
  const runSummaries=latestP10.runs.map(run=>Object.fromEntries(runSummaryFields.filter(key=>Object.hasOwn(run,key)).map(key=>[key,run[key]])));
  derived.p10LatestProjection={source:latestP10Source,report:latestP10Report,status:latestP10.status,policy_id:latestP10.policy_id,runs:runSummaries,full_gate_credit:0,formal_credit:0,release_eligible:false,previous_plan:previousPlan,sources};
  assert.deepEqual(data.retainedHighlights,derived.retainedHighlights,'Replacing a homepage card must preserve the original E2EE evidence');
  assert.deepEqual(data.p10LatestProjection,derived.p10LatestProjection,'P10 latest projection must bind both current reassessments and source bytes');
  const start=structure.indexOf('id="highlight-p10"'),cardMarkup=structure.slice(start,structure.indexOf('</article>',start));
  assert.ok(start>=0&&cardMarkup.includes('href="'+latestP10Report+'"'),'P10 homepage card must link the complete two-run report');
  assert.ok(!structure.includes('id="highlight-e2ee"'),'The replaced E2EE card must not create a sixth homepage card');
  const p10HTML=await fs.readFile(path.join(dest,latestP10Report),'utf8');
  for(const run of latestP10.runs)assert.ok(p10HTML.includes(run.run_id)&&p10HTML.includes(run.status),'Both run identities and current judgments must remain in the detailed report');
  assert.ok(p10HTML.includes('PASS_SCOPED')&&p10HTML.includes('INCONCLUSIVE'));
}else{
  await refreshStageReport(dest,derived,{writeEvidence:false});
  assert.equal(data.p10LatestProjection,undefined);assert.equal(data.retainedHighlights,undefined);
}
const closureRecords=structuredClone(derived.retestRecords);
assert.deepEqual(data.completedResultProjection,derived.completedResultProjection,'Completed test results must be reproducible from their exact source judgments');
assert.deepEqual(data.retestRecords,derived.retestRecords,'Generated plan result notes differ from completed-scope evidence');
assert.deepEqual(data.stageRefresh,derived.stageRefresh,'Stage projection must be reproducible from the retained sources');
assert.deepEqual(data.stageReleaseDecision,derived.stageReleaseDecision,'User release approval must reproduce from its explicit decision source');
assert.deepEqual(data.completedRepairRefresh,derived.completedRepairRefresh,'Later completed repair scopes must reproduce from frozen receipts');
assert.deepEqual(data.completedNetworkRefresh,derived.completedNetworkRefresh,'The completed eleven-case network update must reproduce from its scoped source');
assert.deepEqual(data.completedTelemetryRefresh,derived.completedTelemetryRefresh,'The latest completed 60-second telemetry pair must reproduce from its scoped source');
assert.deepEqual(data.completedP15Refresh,derived.completedP15Refresh,'The latest completed P15 clock run must reproduce without rewriting frozen-stage history');
assert.deepEqual(data.completedP19Refresh,derived.completedP19Refresh,'Current local qualification must reproduce independently of camera, other hosts and Formal');
assert.deepEqual(data.completedP19CameraRefresh,derived.completedP19CameraRefresh,'Camera scoped PASS must reproduce from the original review and deterministic owner test');
assert.deepEqual(data.completedFlutterDiagnosis,derived.completedFlutterDiagnosis,'Completed isolated diagnosis must reproduce without changing shared-service test results');
assert.deepEqual(data.deferredFlutterBugs,derived.deferredFlutterBugs,'User-deferred bug disposition must reproduce independently of raw runtime verdicts');
for(const highlight of [...data.highlights,...(data.retainedHighlights||[])].filter(row=>row.id!=='highlight-p10'))assert.deepEqual(highlight.metrics,beforeStage.highlights.find(row=>row.id===highlight.id).metrics,'Different-scope or unfinished new results must preserve existing metric rows');
assert.deepEqual(data.highlights.find(row=>row.id==='highlight-b14'),beforeStage.highlights.find(row=>row.id==='highlight-b14'),'Stage closure must not supersede the completed B14 Formal');
assert.deepEqual(data.b14CycleSummary,beforeStage.b14CycleSummary,'The three-cycle UI observation must not replace B14 100-cycle timings');
assert.deepEqual(data.memoryUsageSummary,beforeStage.memoryUsageSummary,'The newer missing idle observation must not replace completed B14/B11 memory means');
assert.deepEqual(data.curationSummary,derived.curationSummary);
assert.deepEqual(data.completedRefresh,derived.completedRefresh,'Only approved completed scopes may be refreshed');
assert.ok(!structure.includes('id="completed-results"')&&!structure.includes('id="latest-reports"'),'Keep the pushed home layout');
const ids=[...structure.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.equal(ids.length,new Set(ids).size);
new vm.Script(script);
assert.deepEqual(data,JSON.parse(await fs.readFile(path.join(dest,'data/report-data.json'),'utf8')));
assert.ok(!structure.includes('25项功能／契约测试归档'));
assert.ok(!data.records&&!data.reusable&&!data.route);
assert.equal(data.registry.length,data.currentRecords.length);
assert.equal(data.currentRecords.length,4);
assert.equal(baseline.historicalRecords.length,44);
assert.equal(data.historicalRecords.length,40);
assert.equal(baseline.retestRecords.length,52);
assert.equal(data.retestRecords.length,24);
assert.deepEqual(data.retestRecords.map(r=>r.id),Array.from({length:24},(_,i)=>'T'+String(i+1).padStart(3,'0')));
assert.equal(data.retestRecords.filter(r=>r.plan_kind==='product').length,21);
assert.equal(data.retestRecords.filter(r=>r.plan_kind==='auxiliary').length,3);
assert.deepEqual(data.currentRecords,baseline.currentRecords);
assert.deepEqual(data.historicalRecords,derived.historicalRecords);
assert.deepEqual(data.testEnvironments,derived.testEnvironments);
assert.deepEqual(data.highlights,derived.highlights);
for(const highlight of [...data.highlights,...(data.retainedHighlights||[])].filter(row=>row.id!=='highlight-p10')){
 const original=baseline.highlights.find(row=>row.id===highlight.id);
 assert.equal(highlight.id,original.id); assert.equal(highlight.title,original.title);
 assert.deepEqual(highlight.metrics.map(({name,limit,unit})=>({name,limit,unit})),original.metrics.map(({name,limit,unit})=>({name,limit,unit})),'Preserve original metric columns and thresholds');
}
for(const [id,indices] of [['highlight-screen-share',[0,7]],['highlight-b15',[0,1,2,3]],['highlight-whiteboard',[0,1,2]]]){
 const current=data.highlights.find(h=>h.id===id),original=baseline.highlights.find(h=>h.id===id);
 for(const i of indices)assert.deepEqual(current.metrics[i].value,original.metrics[i].value,'Incomplete or unrun scopes must not overwrite historical data');
}
assert.deepEqual(data.sourceReceipts,baseline.sourceReceipts);
assert.equal(data.curationSummary.metrics,baseline.curationSummary.metrics);
assert.ok(data.currentRecords.every(r=>r.curation.disposition==='CURRENT_VALID'));
assert.ok(data.retestRecords.every(r=>r.curation.disposition==='RETEST_REQUIRED'&&r.curation.reason&&r.curation.retestScope));
assert.ok(data.retestRecords.every(r=>r.metrics.length===0&&r.source_checks.length===0));
assert.ok(data.historicalRecords.every(r=>r.metrics.length<=6&&!r.source_checks&&!r.inputChecks));
const deleted=new Set(data.decisions.filter(r=>r.disposition==='SUPERSEDED').map(r=>r.id));
assert.ok(data.registry.every(r=>!deleted.has(r.id)));
assert.equal(new Set(data.registry.map(r=>r.id)).size,data.registry.length);
for(const record of data.currentRecords){assert.ok(record.curation.inputChecks.length>0);assert.ok(record.source_checks.length>0);}
const originalById=new Map(baseline.retestRecords.map(record=>[record.id,record]));
const planById=new Map(testPlan.groups.map(group=>[group.id,group]));
const timingDefinitions=data.timingMeasurements;
assert.ok(timingDefinitions&&timingDefinitions.definition_version);
assert.ok(Array.isArray(timingDefinitions.collection_policy)&&timingDefinitions.collection_policy.length>0);
assert.deepEqual(timingDefinitions.availability_reasons.map(reason=>reason.id).sort(),['DEFINITION_PENDING','NOT_RETAINED','NOT_TRIGGERED']);
const availabilityById=new Map(timingDefinitions.availability_reasons.map(reason=>[reason.id,reason]));
availabilityById.set('RECORDED',{id:'RECORDED',label:'已留存'});
for(const [id,label]of Object.entries({NOT_TRIGGERED:'未触发',NOT_RETAINED:'未留存',DEFINITION_PENDING:'口径待明确'})){const reason=availabilityById.get(id);assert.ok(reason.label.includes(label));assert.ok(reason.description);}
assert.deepEqual(timingDefinitions.definitions.map(definition=>definition.id).sort(),['join_ready','leave_complete','ui_first_paint']);
const timingDefinitionById=new Map(timingDefinitions.definitions.map(definition=>[definition.id,definition]));
for(const definition of timingDefinitions.definitions){
  assert.ok(definition.name&&definition.start&&definition.end&&definition.start!==definition.end);
  assert.ok(Array.isArray(definition.group_ids)&&definition.group_ids.length>0&&new Set(definition.group_ids).size===definition.group_ids.length);
  assert.ok(definition.group_ids.every(id=>planById.has(id)),'Unknown group in timing definition '+definition.id);
  assert.ok(Array.isArray(definition.rules)&&definition.rules.length>0);
  assert.ok(Array.isArray(definition.evidence)&&definition.evidence.length>0);
  assert.equal(definition.collection_status,'OBSERVATION_RECORDED');
}
assert.ok(timingDefinitionById.get('join_ready').end.includes('startup transaction已提交成功'));
assert.ok(timingDefinitionById.get('join_ready').rules.some(rule=>rule.includes('较早的InMeeting')));
assert.ok(timingDefinitionById.get('join_ready').rules.some(rule=>rule.includes('DegradedSuccess')));
assert.ok(timingDefinitionById.get('leave_complete').end.includes('native cleanup完成'));
assert.ok(timingDefinitionById.get('leave_complete').end.includes('SessionStopped／meetingLeft'));
assert.ok(timingDefinitionById.get('ui_first_paint').end.includes('paint')&&timingDefinitionById.get('ui_first_paint').end.includes('event loop'));
assert.ok(timingDefinitionById.get('ui_first_paint').rules.some(rule=>rule.includes('不代表DWM呈现')));
const consolidation=data.consolidation;
assert.equal(consolidation.original_retest_count,52);
assert.equal(consolidation.displayed_retest_count,24);
assert.equal(consolidation.product_count,21);assert.equal(consolidation.auxiliary_count,3);
assert.equal(consolidation.merged_or_retained_original_count,50);assert.equal(consolidation.removed_independent_count,2);
assert.equal(consolidation.execution,testPlan.stage_freeze.status);
assert.equal(consolidation.stage_execution,'STOPPED_AFTER_CLOSURE');
assert.equal(consolidation.new_test_execution,'NOT_RUN');
for(const flag of ['historical_results_changed','current_tool_results_changed','thresholds_changed'])assert.equal(consolidation[flag],false);
assert.equal(consolidation.mapping.length,52);
assert.equal(new Set(consolidation.mapping.map(row=>row.original_id)).size,52);
assert.deepEqual(consolidation.mapping.map(row=>row.original_id).sort(),[...originalById.keys()].sort());
const mappingById=new Map(consolidation.mapping.map(row=>[row.original_id,row]));
const groupedOriginalIds=data.retestRecords.flatMap(record=>record.originalIds);
assert.equal(groupedOriginalIds.length,50);assert.equal(new Set(groupedOriginalIds).size,50);
assert.ok(!groupedOriginalIds.includes('T028')&&!groupedOriginalIds.includes('T029'));
for(const record of data.retestRecords){
  const group=planById.get(record.id);assert.ok(group);
  const expectedStage=latestP10&&record.plan_code==='P10'?latestP10.plan_projection.stage_status:group.stage_status;
  assert.deepEqual(record.originalIds,group.originalIds);
  assert.equal(record.plan_kind,group.plan_kind);assert.equal(record.plan_code,group.plan_code);
  assert.ok(group.gates.length>=3&&group.gates.every(gate=>typeof gate==='string'&&gate.trim()));
  assert.equal(new Set(group.gates).size,group.gates.length);
  assert.deepEqual(record.gates,group.gates);assert.deepEqual(record.curation.retestScope,group.gates);
  assert.ok(group.stage_status,'A recorded stage assessment must be projected for '+group.plan_code);
  assert.equal(record.status,expectedStage.status,'Plan badge must show its recorded stage status: '+group.plan_code);
  assert.deepEqual(record.stage_status,expectedStage,'Plan details must preserve the complete recorded assessment: '+group.plan_code);
  assert.equal(record.stage_status.full_gate_credit,0,'Partial-stage projection cannot award complete gate credit');
  assert.equal(record.full_gate_credit,0);
  assert.equal(record.date,expectedStage.as_of,'Plan result date must be the recorded assessment date');
  assert.deepEqual(record.sources.slice(0,2),[testPlan.stage_freeze.stage_report_html,testPlan.stage_freeze.stage_report]);
  for(const source of record.sources.slice(2))assert.ok((latestP10&&record.plan_code==='P10'&&data.p10LatestProjection.sources.some(receipt=>receipt.path===source))||data.completedRepairRefresh.sources.some(receipt=>receipt.path===source)||source===data.completedNetworkRefresh.source||source===data.completedTelemetryRefresh.source||(['P08','P10'].includes(record.plan_code)&&source===data.stageReleaseDecision.source)||(record.plan_code==='P19'&&[data.completedP19Refresh.source,data.completedP19CameraRefresh.source].includes(source))||(record.plan_code==='P15'&&source===data.completedP15Refresh.source)||(record.plan_code==='P20'&&['data/b14-user-disposition-20261023.json','data/b14-historical-metrics.json','reports/b14/b14-historical-metrics.html'].includes(source))||(['P05','P06'].includes(record.plan_code)&&[data.completedFlutterDiagnosis.source,data.completedFlutterDiagnosis.execution_source,data.deferredFlutterBugs.source,data.deferredFlutterBugs.report].includes(source)),'Later scope sources must belong to the recorded completed receipts or explicit user disposition');
  assert.deepEqual(record.conditions,group.conditions);
  assert.deepEqual(record.boundaries.slice(0,group.boundaries.length),group.boundaries,'Original plan boundaries must remain before the completed-scope notes');
  assert.ok(record.conditions.length&&record.boundaries.length);
  const originals=record.originalIds.map(id=>{const original=originalById.get(id);assert.ok(original);const mapping=mappingById.get(id);assert.equal(mapping.destination_kind,record.plan_kind);assert.equal(mapping.destination_id,record.id);assert.equal(mapping.destination_code,record.plan_code);assert.ok(mapping.reason);return original;});
  const expectedReferences=latestP10&&record.plan_code==='P10'?latestP10.plan_projection.reference_statuses:[...new Set(originals.flatMap(original=>original.reference_statuses||[original.status]))];
  assert.deepEqual(record.reference_statuses,expectedReferences,'Reference statuses must follow the current presentation scope: '+record.id);
  assert.deepEqual(record.coverage.length,record.originalIds.length);
  for(const [index,original]of originals.entries()){assert.ok(record.coverage[index].includes(original.id)&&record.coverage[index].includes(original.title));}
}
assert.deepEqual(consolidation.non_test_actions,testPlan.non_test_actions);
assert.equal(consolidation.non_test_actions.length,2);
for(const action of consolidation.non_test_actions){const mapping=mappingById.get(action.originalId);assert.equal(mapping.destination_kind,action.kind);assert.equal(mapping.destination_id,action.id);assert.equal(mapping.disposition,'REMOVED_AS_INDEPENDENT_TEST');assert.ok(action.reason&&action.preserve);assert.deepEqual(mapping.covered_by,action.coveredBy);assert.ok(action.coveredBy.length&&action.coveredBy.every(id=>planById.has(id)));}
assert.equal(mappingById.get('T028').destination_kind,'archive');
assert.ok(consolidation.non_test_actions.find(action=>action.originalId==='T028').preserve.includes('USER_REPORTED'));
assert.equal(mappingById.get('T029').destination_kind,'covered');
assert.ok(baseline.historicalRecords.some(record=>record.id==='H031'));
const formal=data.retestRecords.find(record=>record.originalIds.includes('T044'));
assert.equal(formal.plan_kind,'product');assert.ok(formal.reference_statuses.includes('FAIL'));
assert.ok(formal.gates.some(gate=>gate.includes('64 MiB')));
assert.ok(formal.boundaries.some(boundary=>boundary.includes('UNKNOWN')));
const attribution=data.retestRecords.find(record=>record.originalIds.includes('T048'));
assert.ok(attribution.reference_statuses.some(status=>status.includes('UNKNOWN')&&status.includes('FAIL')));

function domRun(input){
  const elements=new Map();
  class Element{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.open=false;this.disabled=false;this.textContent='';this.listeners={};this.options=[];this.content='';this.classes=new Set();this.classList={add:s=>this.classes.add(s),remove:s=>this.classes.delete(s)};}
    add(option){this.options.push(option);}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    dispatch(type='input'){for(const callback of this.listeners[type]||[])callback();}
    set innerHTML(value){this.content=value;if(this.id.endsWith('-list')){let index=0;for(const match of value.matchAll(/<details\b([^>]*)>/g)){const id=match[1].match(/\bid="([^"]+)"/)?.[1]||this.id+'-details-'+index++;const element=new Element(id);element.isDetails=true;elements.set(id,element);}}}
    get innerHTML(){return this.content;}
  }
  for(const id of [...ids,'report-data'])elements.set(id,new Element(id));
  const staticDetails=[...structure.matchAll(/<details\b([^>]*)>/g)].map((match,index)=>{const id=match[1].match(/\bid="([^"]+)"/)?.[1]||'static-details-'+index;const element=elements.get(id)||new Element(id);element.isDetails=true;element.open=/\bopen(?:\s|=|$)/.test(match[1]);elements.set(id,element);return element;});
  elements.get('report-data').textContent=JSON.stringify(input);
  const recordElements=()=>[...elements.values()].filter(x=>/^(report|retest|aux)-[RNT]\d+$/.test(x.id));
  const document={getElementById:id=>{assert.ok(elements.has(id),'Missing DOM ID '+id);return elements.get(id);},querySelectorAll:selector=>{
    const cards=recordElements();
    if(selector==='details')return [...elements.values()].filter(x=>x.isDetails);
    if(/^#(?:reports|retests|aux) \.record(?:,#(?:reports|retests|aux) \.record)*$/.test(selector)){const sections=selector.split(',').map(x=>x.split(' ')[0]);const sectionByPrefix={report:'#reports',retest:'#retests',aux:'#aux'};return cards.filter(x=>sections.includes(sectionByPrefix[x.id.split('-')[0]]));}
    const match=selector.match(/^#(report|retest|aux)-list \.record(:not\(\[hidden\]\))?$/);
    assert.ok(match,'Unhandled selector '+selector);
    return cards.filter(x=>x.id.startsWith(match[1]+'-')&&(!match[2]||!x.hidden));
  }};
  const window={listeners:{},printSnapshots:[],addEventListener(type,callback){this.listeners[type]=callback;},print(){this.listeners.beforeprint?.();this.printSnapshots.push(document.querySelectorAll('details').map(x=>({id:x.id,open:x.open})));this.listeners.afterprint?.();}};
  const context=vm.createContext({document,window,Option:class{constructor(text,value){this.text=text;this.value=value;this.title='';}}});
  vm.runInContext(script,context,{timeout:30000});
  return {elements,context,window,staticDetails,set:(id,value)=>{const element=elements.get(id);assert.ok(element,'Missing DOM ID '+id);element.value=value;element.dispatch();},visible:prefix=>recordElements().filter(x=>x.id.startsWith(prefix+'-')&&!x.hidden).map(x=>x.id.slice(prefix.length+1))};
}
const checks={html_unique_ids:true,inline_json_matches_output:true,maintained_script_matches_inline:true,script_syntax:true,curation_removes_historical_records:true,retained_scope_only:true,original_52_ids_have_unique_destinations:true,product_21_auxiliary_3_separated:true,subgates_and_original_states_preserved:true,summary_not_reexecuted_and_archive_not_counted:true,frozen_thresholds_and_formal_unknown_boundaries_preserved:true};
if(latestP10)checks.p10_revised_policy_two_run_reassessment_and_zero_full_gate_credit=true;
checks.completed_scopes_replace_original_columns_only=true;
checks.unfinished_attempts_not_promoted=true;
const actual=domRun(data);
const initialEnvironmentOpen=actual.elements.get('environment-profiles').open;
assert.equal(actual.visible('report').length,data.currentRecords.length);
assert.equal(actual.visible('retest').length,21);
assert.equal(actual.visible('aux').length,3);
checks.initial_separate_scopes=true;
for(const record of data.retestRecords){
  const markup=vm.runInContext('recordMarkup('+JSON.stringify(record)+',"retest")',actual.context);
  const summary=markup.slice(0,markup.indexOf('</summary>'));
  if(latestP10&&record.plan_code==='P10'){
    assert.ok(!markup.includes('<summary>历史参考状态')&&!markup.includes('<h4>保留失败</h4>')&&!markup.includes('61／100')&&!markup.includes('61/100')&&!markup.includes('LONG_SOAK_NOT_RUN'),'Rendered P10 card must omit superseded failures and stale long-soak status');
  }
  assert.ok(summary.includes(htmlEscape(record.status))&&summary.includes(htmlEscape(record.date)),'Collapsed plan header must show its recorded stage result and date: '+record.plan_code);
  for(const [field,label] of [['completed_scope','已完成范围'],['remaining','剩余范围'],['retained_failures','保留失败'],['inconclusive','未定结论']]){
    const items=record.stage_status[field]||[];
    if(items.length)assert.ok(markup.includes('<h4>'+label+'</h4>'),'Missing stage assessment section: '+record.plan_code+'.'+field);
    for(const item of items)assert.ok(markup.includes(htmlEscape(item)),'Recorded stage assessment is not visible: '+record.plan_code+'.'+field);
  }
  assert.ok(markup.includes('完整主门通过计数为 0'),'Partial stages must keep zero full-gate credit visible: '+record.plan_code);
  for(const source of record.sources){
    const portable=data.portableFiles[source.toLowerCase()]?.portable_path;
    assert.ok(portable,'Missing mapped stage result source: '+source);
    assert.ok(markup.includes('href="'+htmlEscape(portable)+'"'),'Stage source must be a usable result link: '+record.plan_code);
  }
  for(const gate of record.stage_status.gates){
    const expected=vm.runInContext('badge('+JSON.stringify(gate.status)+')',actual.context)+' '+htmlEscape(record.gates[gate.index]);
    assert.ok(markup.includes('<li>'+expected+'</li>'),'Stage subgate must display its own recorded status: '+record.plan_code+'.'+gate.index);
  }
  if(record.plan_kind==='product'){
    assert.ok(summary.includes('整组状态')&&summary.includes('已完成结果')&&summary.includes('剩余范围：'+record.stage_status.remaining.length+'项'),'Collapsed product header must separate group status, completed results and remaining scope: '+record.plan_code);
    const results=record.completed_results;
    assert.equal(new Set(results.map(result=>result.id)).size,results.length,'Completed results must not repeat a case within the same group: '+record.plan_code);
    const counts=new Map([['PASS',0],['FAIL',0]]);
    for(const result of results){const status=result.current_disposition?.status||result.status;counts.set(status,(counts.get(status)||0)+1);}
    if(!results.length)assert.ok(summary.includes('无已完成结果记录'),'Empty evidence must not become a PASS');
    else for(const [status,count] of counts){const label=status==='USER_PASS'?'user_pass':status==='USER-PASS'?'user-pass':status;if(count>0)assert.ok(summary.includes(htmlEscape(label+' '+count)),'Collapsed result counts must distinguish current dispositions from raw executed verdicts: '+record.plan_code+'.'+status);else assert.ok(!summary.includes(htmlEscape(label+' 0')),'Default zero placeholder must be hidden when non-zero completed results exist: '+record.plan_code+'.'+status);}
    const table=markup.match(/<table class="metric-table completed-results">([\s\S]*?)<\/table>/)?.[1]||'';
    assert.equal((table.match(/data-result-id=/g)||[]).length,results.length,'Every completed result must be directly visible in its original group');
    for(const result of results){
      const row=table.split('<tr data-result-id="'+htmlEscape(result.id)+'">')[1]?.split('</tr>')[0];
      assert.ok(row,'Missing visible completed result: '+record.plan_code+'.'+result.id);
      for(const value of [result.title,result.scope,result.status,result.date,result.source_locator])assert.ok(row.includes(htmlEscape(value)),'Missing result scope, verdict, date or source locator: '+result.id);
      const source=data.portableFiles[result.source_path.toLowerCase()]?.portable_path;
      assert.ok(source&&row.includes('href="'+htmlEscape(source)+'"'),'Completed result needs its own usable source link: '+result.id);
      if(result.current_disposition){
        assert.ok(row.includes('原实测 '+htmlEscape(result.status))&&row.includes(htmlEscape(result.current_disposition.status))&&row.includes(htmlEscape(result.current_disposition.date)),'Deferred row must retain raw judgment and show its separate disposition date');
        assert.ok(row.includes('href="'+htmlEscape(result.current_disposition.report_path)+'"'),'Deferred row must link to its cause and repair plan');
      }
    }
  }else assert.ok(!summary.includes('已完成结果'),'Auxiliary group summary must stay unchanged');
}
checks.stage_result_headers_and_expanded_scope_date_sources_visible=true;
checks.stage_subgate_statuses_and_zero_full_gate_credit_visible=true;
checks.completed_test_verdicts_and_remaining_scope_visible_in_original_product_groups=true;
for(const prefix of ['report','retest','aux']){
  const rows=prefix==='report'?data.currentRecords:data.retestRecords.filter(r=>r.plan_kind===(prefix==='retest'?'product':'auxiliary'));
  const expectedOptions=[...new Set(rows.map(row=>String(row.status).trim().toUpperCase()))].sort();
  assert.deepEqual(actual.elements.get(prefix+'-status').options.map(x=>x.value).sort(),expectedOptions);
  for(const option of actual.elements.get(prefix+'-status').options){const count=rows.filter(row=>String(row.status).trim().toUpperCase()===option.value).length;assert.ok(option.text.endsWith(' ('+count+')'));assert.equal(option.title,option.value==='USER_PASS'?'user_pass':option.value==='USER-PASS'?'user-pass':option.value);}
  for(const state of [...new Set([...expectedOptions,'PASS','PASS_SCOPED'])]){
    actual.set(prefix+'-status',state);
    assert.deepEqual(actual.visible(prefix).sort(),rows.filter(row=>String(row.status).trim().toUpperCase()===state).map(row=>row.id).sort());
  }
  actual.set(prefix+'-q','__NO_MATCH__');
  assert.equal(actual.visible(prefix).length,0);
  assert.equal(actual.elements.get(prefix+'-empty').hidden,false);
  actual.elements.get(prefix+'-reset').onclick();
  assert.equal(actual.visible(prefix).length,rows.length);
  for(const suffix of ['q','domain','state','status'])assert.equal(actual.elements.get(prefix+'-'+suffix).value,'');
  if(rows.length){
    const target=rows[0],currentStatus=target.status;actual.set(prefix+'-domain',target.domain);actual.set(prefix+'-status',currentStatus);actual.set(prefix+'-state',vm.runInContext('kind('+JSON.stringify(currentStatus)+')',actual.context));actual.set(prefix+'-q',target.id);
    assert.deepEqual(actual.visible(prefix),[target.id]);
    actual.elements.get(prefix+'-expand').onclick();assert.equal(actual.elements.get(prefix+'-'+target.id).open,true);
    actual.elements.get(prefix+'-collapse').onclick();assert.equal(actual.elements.get(prefix+'-'+target.id).open,false);
    actual.elements.get(prefix+'-reset').onclick();
  }
}
checks.exact_PASS_PASS_SCOPED=true;checks.combined_filters=true;checks.empty_and_reset=true;checks.expand_collapse=true;checks.status_option_counts=true;
assert.ok(!ids.includes('catalog')&&!ids.some(id=>id.startsWith('evidence-')));
assert.ok(!/function renderEvidence|let page=/.test(script));
checks.duplicate_metric_catalog_removed=true;
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
const mixed=domRun(fixture);mixed.set('report-status','pass');assert.deepEqual(mixed.visible('report'),['N901']);mixed.set('report-status',' pass_scoped ');assert.deepEqual(mixed.visible('report'),['N902']);
checks.case_and_whitespace_normalization=true;checks.composite_status_not_mixed=true;
const assessmentFixture=JSON.parse(JSON.stringify(data));
const assessmentBase=assessmentFixture.retestRecords.find(record=>record.plan_kind==='product');
assessmentFixture.retestRecords=[
  {status:'PARTIAL',reference_statuses:['PASS']},
  {status:'FAIL',reference_statuses:['PASS_SCOPED']},
  {status:'PASS_SCOPED',reference_statuses:['FAIL']},
  {status:'NOT_RUN',reference_statuses:['PASS']}
].map((sample,index)=>({...assessmentBase,...sample,id:'T'+(901+index),stage_status:{...assessmentBase.stage_status,status:sample.status}}));
const currentAssessments=domRun(assessmentFixture);
currentAssessments.set('retest-status','PASS');assert.deepEqual(currentAssessments.visible('retest'),[]);
currentAssessments.set('retest-status','PARTIAL');assert.deepEqual(currentAssessments.visible('retest'),['T901']);
currentAssessments.set('retest-status','FAIL');assert.deepEqual(currentAssessments.visible('retest'),['T902']);
currentAssessments.set('retest-status','PASS_SCOPED');assert.deepEqual(currentAssessments.visible('retest'),['T903']);
currentAssessments.elements.get('retest-reset').onclick();
currentAssessments.set('retest-state','PASS');assert.deepEqual(currentAssessments.visible('retest'),['T903']);
currentAssessments.set('retest-state','FAIL');assert.deepEqual(currentAssessments.visible('retest'),['T902']);
currentAssessments.set('retest-state','OTHER');assert.deepEqual(currentAssessments.visible('retest'),['T901','T904']);
checks.current_assessment_filters_do_not_use_historical_reference_statuses=true;
const printable=[...actual.elements.values()].filter(x=>x.isDetails);
for(const [i,element]of printable.entries())element.open=i%2===0;
const openBefore=printable.map(x=>({id:x.id,open:x.open}));
actual.elements.get('print-main').onclick();
assert.ok(actual.window.printSnapshots.at(-1).every(x=>x.open),'Print must expand all report details');
for(const {id,open}of openBefore)assert.equal(actual.elements.get(id).open,open);
checks.print_state_restored=true;

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(Buffer.from((await fs.readFile(path.join(dest,'assets/report-style.css'),'utf8')).replace(/\r\n/g,'\n'))),'a9c1c2f2ddafd014a6ab094b2cd2e868672d6f61582e2977bdd2e84e1b24b79c','Pushed stylesheet must be preserved');
assert.ok(!script.includes('本轮 NOT_RUN')&&!script.includes('整组尚未执行'),'Recorded plan stages must not be labeled as entirely unrun');
assert.deepEqual([...structure.match(/<nav aria-label="报告目录">([\s\S]*?)<\/nav>/)[1].matchAll(/href="([^"]+)"/g)].map(x=>x[1]),['#decision','#highlights','#retests','#memory-usage','#test-environments','#history','#appendix']);
assert.equal(data.highlights.length,5);
assert.equal((structure.match(/class="highlight-card"/g)||[]).length,5);
assert.ok(structure.indexOf('id="highlights"')<structure.indexOf('id="boundary"'));
assert.ok(structure.includes(data.stageReleaseDecision.statement + '。'),'The conclusion must show the current user-approved release decision');
assert.ok(!structure.includes('callout danger'));
assert.ok(!structure.includes('建议：完成所需补测及正式验收后再决定定版放行。'));
assert.ok(!structure.includes('最新D盘部署／源码验证已完成'));
assert.equal(data.currentRecords.some(x=>x.id==='N010'),false);
assert.ok(data.retestRecords.some(x=>x.originalIds.includes('T052')&&x.plan_kind==='auxiliary'));
checks.five_homepage_highlights=true;checks.requested_box_removed_conclusion_retained=true;
const isFull=process.argv.includes('--full')||process.argv.includes('--offline');
const fileExists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
const safePath=p=>{assert.ok(p&&!path.isAbsolute(p)&&!p.includes('..')&&!p.includes('\\'));const absolute=path.resolve(dest,p);assert.ok(absolute.startsWith(dest+path.sep));return absolute;};
const norm=p=>String(p).split(String.fromCharCode(92)).join('/').toLowerCase();
let verifiedInputs=0,omittedInputs=0;
for(const record of data.currentRecords)for(const entry of record.curation.inputChecks){
  const copied=data.portableFiles[norm(entry.path)];
  if(copied?.portable_path){
    const full=safePath(copied.portable_path);
    if(await fileExists(full)){
      assert.equal(sha(await fs.readFile(full)),entry.recorded_sha256);
      verifiedInputs++;
    }else if(isFull){
      assert.fail('Missing direct input in full validation: '+copied.portable_path);
    }else omittedInputs++;
  }else if(isFull)assert.fail('Unmapped direct input in full validation: '+entry.path);
  else omittedInputs++;
}
checks.frozen_direct_input_hashes={verified_existing:verifiedInputs,decoupled_omitted:omittedInputs};
checks.no_product_executable_or_test_executed=true;
let verifiedReceipts=0,omittedReceipts=0;
for(const entry of data.sourceReceipts){
  const full=safePath(entry.portable_path);
  if(await fileExists(full)){
    assert.equal(sha(await fs.readFile(full)),entry.sha256);
    verifiedReceipts++;
  }else if(isFull){
    assert.fail('Missing source receipt in full validation: '+entry.portable_path);
  }else omittedReceipts++;
}
checks.source_receipts_verified={verified_existing:verifiedReceipts,decoupled_omitted:omittedReceipts};
for(const h of data.highlights){assert.ok(h.metrics.length>=5);for(const source of h.sources)assert.ok(data.portableFiles[norm(source)]?.portable_path,'Highlight missing source '+source);}
for(const h of data.highlights){const marker='id="'+h.id+'"';const start=structure.indexOf(marker);const end=structure.indexOf('</article>',start);const card=structure.slice(start,end);for(const p of h.sources){const entry=data.portableFiles[norm(p)];assert.ok(card.includes('samples/acceptance/'+entry.portable_path));if(/^[a-z]:[\\/]/i.test(p))assert.ok(!card.includes(p),'Original display path leaked: '+p);}}
checks.highlight_sources_portable=true;checks.highlight_display_paths_match_package=true;
const unavailable=Object.values(data.portableFiles).filter(x=>x.status==='ORIGINAL_UNAVAILABLE');
assert.equal(unavailable.length,data.packageAvailability.unavailable_original_sources);
assert.ok(!script.includes('file:///'));
checks.missing_sources_explicit_no_absolute_fallback=true;
// 检查全部渲染链接；轻量仓库仅允许冻结基准中已声明的附件缺省。
const rendered=[structure,...[...actual.elements.values()].map(x=>x.innerHTML)].join('\n');
const declaredOmissions=new Set([...Object.values(baseline.portableFiles).map(x=>x.portable_path),...baseline.sourceReceipts.map(x=>x.portable_path),...Object.values(baseline.auditFiles),baseline.packageAvailability.missing_source_details].filter(Boolean));
const existingLinks=new Set(),omittedLinks=new Set();let linkCount=0;
assert.ok(ids.includes('test-environments'));
assert.ok(data.testEnvironments.profiles.length>=13);
assert.ok(!/腾讯(?!云)|阿里(?!云|巴巴)/.test(rendered),'Cloud provider shorthand remains in report prose');
const environments=new Map(data.testEnvironments.profiles.map(p=>[p.id,p]));
const environmentOverview=elementMarkup('test-environments');
const environmentTable=elementMarkup('environment-profiles');
assert.ok(environmentTable.startsWith('<details class="appendix environment-profiles" id="environment-profiles">'),'All environment rows need one shared disclosure');
assert.equal((environmentOverview.match(/<details\b/g)||[]).length,1,'Environment overview must expand and collapse as one table');
assert.equal((environmentOverview.match(/<table class="environment-overview">/g)||[]).length,1);
assert.equal((environmentTable.match(/<tr id=/g)||[]).length,data.testEnvironments.profiles.length);
assert.equal(actual.elements.get('environment-profiles').isDetails,true);
assert.equal(initialEnvironmentOpen,false,'Shared environment table must start collapsed');
assert.ok(environmentTable.includes('<summary>查看全部测试环境配置（'+data.testEnvironments.profiles.length+'项）</summary>'));
for(const label of ['原测试范围','服务器','客户端','负载与适用边界'])assert.ok(environmentTable.includes('<th>'+label+'</th>'));
for(const profile of data.testEnvironments.profiles){
  const entry=elementMarkup(profile.id);
  assert.ok(entry.startsWith('<tr id="'+profile.id+'">'),'Environment profile anchor must point to its row in the shared table: '+profile.id);
  assert.ok(!entry.includes('<details'),'Environment rows must not require individual expansion');
  for(const value of [profile.label,profile.server,profile.client,profile.load,profile.boundary])assert.ok(entry.includes(htmlEscape(value)),'Environment content lost: '+profile.id);
  for(const source of profile.sources){assert.ok(entry.includes('href="'+htmlEscape(source.path)+'"'));assert.ok(entry.includes(htmlEscape(source.basis)));}
  assert.ok(!actual.elements.get(profile.id).isDetails);
}
checks.environment_profiles_in_single_collapsible_table_with_original_configuration_and_sources=true;
for(const h of data.highlights){
  assert.ok(h.environmentIds.length>0,'Highlight environment missing '+h.id);
  const card=structure.slice(structure.indexOf('id="'+h.id+'"'),structure.indexOf('</article>',structure.indexOf('id="'+h.id+'"')));
  assert.ok(card.includes('测试服务器与客户端配置'));
  for(const id of h.environmentIds){const p=environments.get(id);assert.ok(p);assert.ok(card.includes(p.server));assert.ok(card.includes(p.client));}
}
assert.deepEqual(data.highlights.find(x=>x.id==='highlight-screen-share').environmentIds,derived.highlights.find(x=>x.id==='highlight-screen-share').environmentIds);
assert.deepEqual(data.highlights.find(x=>x.id==='highlight-whiteboard').environmentIds,derived.highlights.find(x=>x.id==='highlight-whiteboard').environmentIds);
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
checks.server_and_client_environment_profiles=data.testEnvironments.profiles.length;
checks.cloud_provider_full_names=true;
checks.local_and_cloud_test_environments_separated=true;
checks.b14_server_configuration_matches_frozen_plan=true;
assert.ok(ids.includes('memory-usage'));
const originalMemorySummary=JSON.parse(await fs.readFile(path.join(dest,'data/memory-usage-summary.json'),'utf8'));
const memorySummary=data.memoryUsageSummary;
assert.deepEqual(memorySummary.meeting_context,originalMemorySummary.meeting_context);
assert.deepEqual(memorySummary.rows.filter(row=>row.id.startsWith('meeting_')),originalMemorySummary.rows.filter(row=>row.id.startsWith('meeting_')),'Independent B11 means must remain unchanged');
const timingBytes=await fs.readFile(safePath(data.b14CycleSummary.timing_source_path));
const timingReview=JSON.parse(timingBytes.toString('utf8'));
const completedFormal=JSON.parse(await fs.readFile(safePath('data/completed-evidence/b14-formal-20261023-completed-scoped.json'),'utf8'));
assert.equal(completedFormal.schema,'cohavora_b14_formal_completed_scoped_v1');
assert.equal(timingReview.original_receipt.sha256,completedFormal.source_receipts.timing_review.sha256);
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
assert.equal(memorySummary.b14_run_id,data.b14CycleSummary.run_id);
assert.equal(memorySummary.timing_source_path,data.b14CycleSummary.timing_source_path);
assert.equal(memorySummary.source_sha256,sha(timingBytes));
assert.equal(memorySummary.rows.length,4);assert.equal(memorySummary.post_leave_rows.length,2);
assert.ok(memorySummary.sources.some(source=>source.path===memorySummary.timing_source_path&&source.sha256===sha(timingBytes)));
const idleReview=timingReview.idle_memory;
assert.equal(idleReview.status,'OBSERVATION_ONLY');assert.equal(idleReview.release_gate_issued,false);
assert.equal(idleReview.definition_version,'2026-10-16-idle-v1');
assert.equal(testPlan.idle_memory_measurements.definition_version,idleReview.definition_version);
assert.equal(testPlan.idle_memory_measurements.collection_status,'OBSERVATION_RECORDED');
assert.equal(testPlan.idle_memory_measurements.implementation_status,'IMPLEMENTED_OBSERVATION_RECORDED');
assert.equal(data.b14CycleSummary.idle_memory_definition_version,idleReview.definition_version);
assert.equal(idleReview.source_sha256,'ebee3f8eda5c458c2780caf62c0e9acb5e80f52c95d2527b17609d216b6af7ab');
assert.equal(idleReview.windows.length,101);assert.equal(idleReview.summaries.length,4);
assert.equal(data.b14CycleSummary.recorded_idle_memory_statistics.length,4);
const nearMemory=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-10,label+': '+actual+' != '+expected);
for(const [scene,windowCount,sampleCount] of [['initial_home_idle',1,5],['post_leave_home_idle',100,445]]){
  const windows=idleReview.windows.filter(window=>window.scene===scene);
  assert.equal(windows.length,windowCount);
  assert.deepEqual(windows.map(window=>window.cycle).sort((a,b)=>a-b),Array.from({length:windowCount},(_,i)=>i+1));
  for(const window of windows){
    assert.equal(window.status,'RECORDED');assert.equal(window.reason,'none');assert.equal(window.software_state,'idle_home');
    assert.equal(window.warmup_seconds,5);assert.ok(window.observed_samples>=window.valid_samples);assert.ok(window.valid_samples>=3);assert.equal(window.samples.length,window.valid_samples);
    assert.ok(window.end_elapsed_seconds-window.begin_elapsed_seconds>=2);
    for(const [index,sample] of window.samples.entries()){
      assert.equal(sample.run_id,data.b14CycleSummary.run_id);assert.equal(sample.pid,data.b14CycleSummary.process.pid);
      assert.equal(sample.process_start_ticks,data.b14CycleSummary.process.start_ticks);
      assert.equal(sample.process_run_id,timingReview.samples[0].process_run_id);assert.equal(sample.cycle,window.cycle);
      assert.equal(sample.process_alive,true);assert.equal(sample.home_visible,true);assert.equal(sample.software_state,'idle_home');assert.equal(sample.native_cleanup_pending,0);
      if(scene==='post_leave_home_idle')assert.equal(sample.native_session_complete,true);
      if(index)assert.ok(sample.sample_elapsed_seconds-window.samples[index-1].sample_elapsed_seconds<=2.5);
    }
  }
  for(const [metric,originalId] of [['working_set_bytes','idle_working_set'],['private_bytes','idle_private_bytes']]){
    const values=windows.flatMap(window=>window.samples.map(sample=>{assert.ok(Number.isFinite(sample[metric])&&sample[metric]>0);return sample[metric];}));
    assert.equal(values.length,sampleCount);
    const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    const original=idleReview.summaries.find(row=>row.scene===scene&&row.metric===metric);assert.ok(original);
    assert.equal(original.status,'RECORDED');assert.equal(original.valid_samples,sampleCount);
    nearMemory(original.mean_bytes,mean,scene+' raw '+metric);nearMemory(original.mean_mib,mean/1048576,scene+' raw MiB '+metric);
    const derived=data.b14CycleSummary.recorded_idle_memory_statistics.find(row=>row.id===scene+':'+metric);assert.ok(derived);
    assert.equal(derived.valid_windows,windowCount);assert.equal(derived.valid_samples,sampleCount);assert.equal(derived.status,'RECORDED');
    nearMemory(derived.mean_bytes,mean,scene+' derived '+metric);nearMemory(derived.mean_mib,mean/1048576,scene+' derived MiB '+metric);
    const rows=scene==='initial_home_idle'?memorySummary.rows:memorySummary.post_leave_rows;
    const row=rows.find(row=>scene==='initial_home_idle'?row.id===originalId:row.metric===memorySummary.rows.find(initial=>initial.id===originalId).metric);assert.ok(row,'Missing '+scene+' '+metric);
    assert.equal(row.status,'RECORDED_MEAN');assert.equal(row.valid_samples,sampleCount);assert.equal(row.source,memorySummary.timing_source_path);
    nearMemory(row.mean_bytes,mean,scene+' rendered '+metric);nearMemory(row.mean_mib,mean/1048576,scene+' rendered MiB '+metric);
    const memorySection=elementMarkup('memory-usage');
    assert.ok(memorySection.includes(row.mean_mib.toLocaleString('en-US',{maximumFractionDigits:3,useGrouping:false})),'Recorded idle mean not rendered: '+scene+' '+metric);
  }
}
const b14MemoryAvailability=JSON.parse(await fs.readFile(path.join(dest,'data/b14-memory-usage-summary.json'),'utf8'));
assert.equal(b14MemoryAvailability.run_id,'e7501e95039f4eb7ab23594a83fe82f0');
assert.ok(b14MemoryAvailability.metrics.every(x=>x.status==='UNKNOWN'&&x.mean_bytes===null&&x.mean_mib===null&&x.samples===0));
assert.ok(structure.includes('不是B14的100轮内存均值'));
assert.ok(elementMarkup('memory-usage').includes('该B14的会议状态绝对平均占用仍未导出'));
checks.b14_idle_memory_means_recomputed_from_450_same_run_samples=true;
checks.b14_initial_and_post_leave_idle_scenes_separated=true;
checks.memory_occupancy_growth_and_run_scopes_separated=true;
for(const [,raw]of rendered.matchAll(/href="([^"]+)"/g)){
  const href=raw.replaceAll('&amp;','&');
  if(href.startsWith('#')){assert.ok(actual.elements.has(href.slice(1)),'Missing anchor '+href);continue;}
  assert.ok(!/^[a-z]+:/i.test(href),'Absolute link '+href);
  const relative=decodeURIComponent(href),full=safePath(relative);
  linkCount++;
  if(await fileExists(full)){
    assert.ok((await fs.stat(full)).isFile(),'Missing attachment '+href);
    existingLinks.add(relative);
  }else if(isFull){
    assert.fail('Missing attachment in full validation: '+href);
  }else{
    assert.ok(declaredOmissions.has(relative),'Undeclared broken link '+href);
    omittedLinks.add(relative);
  }
}
checks.package_local_links={references:linkCount,verified_existing:existingLinks.size,decoupled_omitted:omittedLinks.size,omitted_paths:[...omittedLinks].sort()};
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
const b14SourcePath=data.b14CycleSummary.source_path;
const b14FullPath=b14SourcePath?safePath(b14SourcePath):null;
const cycleSummary=JSON.parse(await fs.readFile(path.join(dest,'data/b14-100-cycle-summary.json'),'utf8'));
assert.deepEqual(data.b14CycleSummary,cycleSummary);
assert.equal(cycleSummary.run_id,'5653c962b41646c4aa1e4600fefa8e97');
assert.equal(cycleSummary.overall_verdict,'FAIL');
assert.equal(cycleSummary.raw_verdict,'FAIL');
assert.equal(cycleSummary.cycle_count,100);
assert.equal(cycleSummary.procedure_parameters.network_reconnect_episodes_per_cycle_maximum,0);
const expectedTimingReasons={camera_first_frame:'NOT_RETAINED',screen_first_frame:'NOT_RETAINED',first_paint:'RECORDED',join_duration:'RECORDED',leave_duration:'RECORDED',reconnect_video_first:'NOT_TRIGGERED',reconnect_audio_first:'NOT_TRIGGERED',reconnect_render_first:'NOT_TRIGGERED'};
const expectedTimingDefinitions={first_paint:'ui_first_paint',join_duration:'join_ready',leave_duration:'leave_complete'};
assert.equal(sha(timingBytes),completedFormal.timing_source.sha256);
assert.equal(cycleSummary.timing_source_sha256,sha(timingBytes));
assert.equal(timingReview.run_id,cycleSummary.run_id);
assert.equal(timingReview.status,'OBSERVATION_ONLY');assert.equal(timingReview.release_gate_issued,false);
assert.equal(timingReview.definition_version,timingDefinitions.definition_version);
assert.equal(cycleSummary.timing_definition_version,timingReview.definition_version);
assert.equal(timingReview.source_sha256,'641c8fb2e94ed2fb3a05c153b2125d199efa4f108fa809daa91e3f255ce7ab36');
assert.equal(timingReview.samples.length,300);assert.equal(timingReview.cycle_coverage.length,300);
assert.equal(new Set(timingReview.samples.map(sample=>sample.operation_id)).size,300);
assert.deepEqual(timingReview.outcomes,{success:300});
const cycleIds=new Map(cycleSummary.per_cycle.map(cycle=>[cycle.cycle,cycle.cycle_id]));
const closeTiming=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-10,label+': '+actual+' != '+expected);
const recordedBuckets=new Map();
for(const sample of timingReview.samples){
  assert.equal(sample.run_id,cycleSummary.run_id);assert.equal(sample.pid,cycleSummary.process.pid);
  assert.equal(sample.valid,true);assert.equal(sample.missing_reason,'none');
  assert.equal(sample.scene,'meeting');assert.equal(sample.definition_version,timingDefinitions.definition_version);
  assert.equal(sample.clock_domain,'process_steady_clock_us');assert.ok(timingDefinitionById.has(sample.metric));
  assert.equal(sample.cycle_id,cycleIds.get(sample.cycle));
  assert.ok(Number.isFinite(sample.elapsed_us)&&sample.elapsed_us>0);assert.equal(sample.end_us-sample.begin_us,sample.elapsed_us);
  assert.ok(['success','degraded_success'].includes(sample.outcome));
  if(sample.outcome==='degraded_success')assert.equal(sample.metric,'join_ready');
  const terminal=sample.raw_records.filter(record=>record.attributes.phase==='terminal');assert.equal(terminal.length,1);
  assert.equal(terminal[0].run_id,sample.run_id);assert.equal(terminal[0].operation_id,sample.operation_id);
  assert.equal(terminal[0].attributes.elapsed_us,sample.elapsed_us);assert.equal(terminal[0].outcome,sample.outcome);
  const key=sample.metric+':'+sample.outcome;
  if(!recordedBuckets.has(key))recordedBuckets.set(key,[]);
  recordedBuckets.get(key).push(sample.elapsed_us/1000);
}
assert.equal(new Set(timingReview.samples.map(sample=>sample.process_run_id)).size,1);
for(const metric of timingDefinitionById.keys()){
  const samples=timingReview.samples.filter(sample=>sample.metric===metric);
  assert.equal(samples.length,100);assert.deepEqual(samples.map(sample=>sample.cycle).sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i+1));
  const coverage=timingReview.cycle_coverage.filter(row=>row.metric===metric);
  assert.equal(coverage.length,100);
  assert.deepEqual(coverage.map(row=>row.cycle).sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i+1));
  for(const row of coverage){assert.equal(row.cycle_id,cycleIds.get(row.cycle));assert.equal(row.availability,'RECORDED');assert.equal(row.samples,1);assert.equal(row.complete_samples,1);}
}
assert.deepEqual([...recordedBuckets.keys()].sort(),['join_ready:success','leave_complete:success','ui_first_paint:success']);
assert.equal(cycleSummary.recorded_timing_statistics.length,3);
for(const row of cycleSummary.recorded_timing_statistics){
  const values=recordedBuckets.get(row.id);assert.ok(values);const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(values.length/2);
  const expected={n:values.length,mean:values.reduce((sum,value)=>sum+value,0)/values.length,p50:values.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,p95:sorted[Math.ceil(.95*values.length)-1],max:sorted.at(-1)};
  assert.equal(row.id,row.metric+':'+row.outcome);assert.equal(row.scene,'meeting');assert.equal(row.unit,'ms');assert.equal(row.original_limit,null);
  const rawSummary=timingReview.summaries.find(bucket=>bucket.metric===row.metric&&bucket.scene===row.scene&&bucket.outcome===row.outcome);assert.ok(rawSummary);
  assert.equal(row.n,expected.n);assert.equal(rawSummary.valid_success_count,expected.n);assert.equal(rawSummary.count,expected.n);
  for(const key of ['mean','p50','p95','max']){closeTiming(row[key],expected[key],row.id+' '+key);closeTiming(rawSummary[key+'_ms'],expected[key],row.id+' original '+key);}
}
assert.equal(cycleSummary.first_frame_and_action_timing.length,8);
assert.deepEqual(cycleSummary.first_frame_and_action_timing.map(row=>row.id).sort(),Object.keys(expectedTimingReasons).sort());
for(const row of cycleSummary.first_frame_and_action_timing){
  assert.equal(row.availability_reason,expectedTimingReasons[row.id]);assert.ok(availabilityById.has(row.availability_reason));
  assert.equal(row.definition_id,expectedTimingDefinitions[row.id]);
  assert.equal(row.unit,'ms');assert.equal(row.original_limit,null);assert.ok(row.reason);
  if(row.availability_reason==='RECORDED'){
    const bucket=cycleSummary.recorded_timing_statistics.find(bucket=>bucket.metric===row.definition_id&&bucket.outcome==='success');assert.ok(bucket);
    assert.equal(row.status,'RECORDED');assert.equal(row.n,bucket.n);assert.equal(row.source,cycleSummary.timing_source_path);
    for(const key of ['mean','p50','p95','max'])assert.equal(row[key],bucket[key]);
    assert.equal(row.degraded_success_n,0);
  }else{
    assert.equal(row.status,'UNKNOWN');assert.equal(row.n,0);assert.equal(row.source,cycleSummary.source_path);
    for(const key of ['mean','p50','p95','max'])assert.equal(row[key],null,'Unrecorded timing must remain null: '+row.id+'.'+key);
  }
  if(row.id.startsWith('reconnect_'))assert.equal(row.valid_samples_total,0);
}
function htmlEscape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
const timingMarkup=[...structure.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].filter(match=>/\bdata-timing-id="/.test(match[1]));
assert.equal(timingMarkup.length,8);
const timingMarkupById=new Map(timingMarkup.map(match=>[match[1].match(/\bdata-timing-id="([^"]+)"/)[1],match]));
assert.equal(timingMarkupById.size,8);
for(const row of cycleSummary.first_frame_and_action_timing){
  const markup=timingMarkupById.get(row.id);assert.ok(markup,'Missing timing table row '+row.id);
  assert.equal(markup[1].match(/\bdata-availability-reason="([^"]+)"/)?.[1],row.availability_reason);
  assert.ok(markup[2].includes(htmlEscape(row.name))&&markup[2].includes(htmlEscape(row.reason)));
  assert.ok(markup[2].includes(htmlEscape(availabilityById.get(row.availability_reason).label)));
  const expectedSamples=row.availability_reason==='NOT_TRIGGERED'?'不适用（重连0次）':row.availability_reason==='DEFINITION_PENDING'?'未形成同口径样本':row.n+'/100'+(row.degraded_success_n?' 普通成功；'+row.degraded_success_n+'/100 降级成功':'');
  assert.ok(markup[2].includes(expectedSamples),'Timing sample applicability is incorrect: '+row.id);
  assert.ok(!/<td[^>]*>\s*(?:<strong>)?\s*0(?:\.0+)?\s*(?:<\/strong>)?\s*<\/td>/.test(markup[2]),'Unavailable latency rendered as zero: '+row.id);
  if(row.definition_id)assert.ok(markup[2].includes('#timing-definition-'+row.definition_id));
}
const formatTiming=value=>value.toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false});
for(const row of cycleSummary.recorded_timing_statistics){
  const matches=[...structure.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].filter(match=>match[1].includes('<th scope="row">'+htmlEscape(row.name)+'<'));
  assert.equal(matches.length,1,'Recorded timing bucket must appear once: '+row.id);
  const cells=[...matches[0][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1].replace(/<[^>]*>/g,''));
  assert.deepEqual(cells,[row.n+'/100',...[row.mean,row.p50,row.p95,row.max].map(formatTiming),'ms','原结果未给出数值门限']);
}
assert.ok(structure.includes('P50为中位数')&&structure.includes('P95为最近秩法'));
assert.ok(structure.includes('href="'+cycleSummary.timing_source_path+'"'));
checks.b14_recorded_timing_300_operations_and_cycle_coverage=true;
checks.b14_recorded_timing_three_actual_buckets_recomputed_and_rendered=true;
assert.ok(ids.includes('timing-measurement-definitions'));
function elementMarkup(id){
  assert.ok(ids.includes(id),'Missing timing anchor '+id);
  const opening=new RegExp('<([a-z][a-z0-9]*)\\b[^>]*\\bid="'+id+'"[^>]*>','i').exec(structure);assert.ok(opening);
  const tags=new RegExp('</?'+opening[1]+'\\b[^>]*>','gi');tags.lastIndex=opening.index;
  let depth=0,end=-1;
  for(let match; (match=tags.exec(structure));){depth+=match[0].startsWith('</')?-1:1;if(depth===0){end=tags.lastIndex;break;}}
  assert.ok(end>opening.index,'Unclosed timing definition '+id);
  return structure.slice(opening.index,end);
}
const timingDefinitionSection=elementMarkup('timing-measurement-definitions');
for(const value of [timingDefinitions.definition_version,timingDefinitions.applicability,...timingDefinitions.collection_policy])assert.ok(timingDefinitionSection.includes(htmlEscape(value)),'Timing collection policy not rendered: '+value);
for(const reason of timingDefinitions.availability_reasons)assert.ok(structure.includes(htmlEscape(reason.label))&&structure.includes(htmlEscape(reason.description)),'Timing availability legend missing '+reason.id);
for(const definition of timingDefinitions.definitions){
  const row=elementMarkup('timing-definition-'+definition.id);
  for(const value of [definition.name,definition.start,definition.end,definition.collection_status])assert.ok(row.includes(htmlEscape(value)),'Timing definition field not rendered: '+definition.id+' '+value);
  for(const value of [...definition.rules,...definition.evidence])assert.ok(timingDefinitionSection.includes(htmlEscape(value)),'Timing definition rule/evidence not rendered: '+definition.id+' '+value);
}
checks.timing_definitions_single_source_and_three_contracts=true;
checks.b14_timing_missing_reasons_separated=true;
checks.b14_timing_recorded_and_unknown_values_and_rendered_reasons=true;
if(b14FullPath&&(await fileExists(b14FullPath))){
  const b14Projection=JSON.parse((await fs.readFile(b14FullPath,'utf8')).replace(/^\uFEFF/,''));
  assert.equal(b14Projection.schema,'cohavora_b14_formal_completed_scoped_v1');
  const b14=b14Projection.external_review;
  assert.equal(data.highlights[0].metrics.find(x=>x.name.includes('Private Bytes')).value,b14.resource_growth.private_bytes.growth/1048576);
  assert.equal(data.highlights[0].status,'user_pass');
  assert.equal(data.highlights[0].metrics.find(x=>x.name==='运行时长').value,b14.duration_seconds);
  assert.equal(b14.cycles.length,100);
  assert.equal(cycleSummary.source_sha256,sha(await fs.readFile(b14FullPath)));
  const formal=JSON.parse(await fs.readFile(path.join(dest,'reports/b14/b14-clipboard-readmission-20261019-01.json'),'utf8')).formal;
  assert.equal(formal.run_id,cycleSummary.run_id);assert.equal(formal.status,'FAIL');
  assert.equal(formal.raw_verdict,'FAIL');assert.equal(formal.exception,null);
  assert.deepEqual(b14.cycle_counts,{PASS:100});assert.equal(b14.resource_growth.private_bytes.growth,100526080);assert.equal(b14.resource_growth.private_bytes.limit,67108864);assert.equal(b14.resource_growth.private_bytes.passed,false);
  assert.ok(Object.entries(b14.resource_growth).filter(([key])=>key!=='private_bytes').every(([,row])=>row.passed===true));
  assert.equal(b14Projection.failure_analysis.root_cause,'UNKNOWN');assert.equal(b14Projection.runner_exit.exit_code,1);assert.deepEqual(b14Projection.runner_exit.cleanup_errors,[]);
  assert.equal(b14Projection.owner_execution.state,'FORMAL');assert.equal(b14Projection.owner_execution.formal,'FAILED');assert.equal(b14Projection.owner_execution.exit_code,1);assert.equal(b14Projection.owner_execution.failure.stage,'FORMAL');
  assert.equal(b14Projection.cleanup.service.status,'PASS');assert.equal(b14Projection.cleanup.service.guard_run_id,b14Projection.owner_execution.guard_run_id);
  assert.equal(b14Projection.cleanup.guard_restored.status,'RESTORED');assert.equal(b14Projection.cleanup.guard_task_cleanup.status,'REMOVED_OR_ABSENT');
  assert.equal(b14Projection.cleanup.token_owner.status,'PASS');assert.equal(b14Projection.cleanup.token_owner.before_owner_sid,b14Projection.cleanup.token_owner.after_owner_sid);
  assert.equal(b14Projection.root_observation.owner_os_exit_code,'NOT_INDEPENDENTLY_OBSERVED');
  assert.equal(cycleSummary.process.product_live_seconds_before_close,formal.product_live_seconds);
  assert.ok(Object.values(formal.final_checks).every(value=>value===true));
  const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-10,label+': '+actual+' != '+expected);
  for(const metric of cycleSummary.metrics){
    const field=metric.source_field.replace(/^(?:external_review\.)?cycles\[\*\]\./,'').split('.');
    const values=b14.cycles.map(cycle=>{const raw=field.reduce((value,key)=>value?.[key],cycle);assert.ok(typeof raw==='number'&&Number.isFinite(raw),'Invalid scalar '+metric.id);return metric.id==='telemetry_queue_peak_mib'?raw/1048576:raw;});
    const sorted=[...values].sort((a,b)=>a-b);
    assert.equal(metric.n,100);
    close(metric.mean,values.reduce((a,b)=>a+b,0)/values.length,metric.id+' mean');
    close(metric.p50,sorted[Math.ceil(.50*values.length)-1],metric.id+' P50');
    close(metric.p95,sorted[Math.ceil(.95*values.length)-1],metric.id+' P95');
    close(metric.max,sorted.at(-1),metric.id+' max');
  }
  for(const cycle of b14.cycles){
    const native=cycle.details.revision_1_to_terminal.native_metric_summary;
    const episodes=native['reconnect.episodes'];
    assert.ok(Number.isInteger(episodes.valid_samples)&&episodes.valid_samples>0,'Reconnect episode coverage missing: '+cycle.cycle_id);
    assert.equal(episodes.maximum,0,'Reconnect episode actually triggered: '+cycle.cycle_id);
    for(const row of cycleSummary.first_frame_and_action_timing.filter(row=>row.id.startsWith('reconnect_'))){
      const key=row.source_field.split('native_metric_summary.')[1];
      assert.ok(key&&Object.hasOwn(native,key));assert.equal(native[key].valid_samples,0);
    }
  }
  checks.b14_reconnect_100_cycles_not_triggered_original_evidence=true;
  checks.b14_100_cycle_scalar_statistics_recomputed=cycleSummary.metrics.length;
}else{
  checks.b14_reconnect_100_cycles_not_triggered_original_evidence='DECOUPLED_REPORT_DATA_ONLY';
  checks.b14_100_cycle_scalar_statistics_recomputed='DECOUPLED_REPORT_DATA_ONLY';
}
assert.equal(cycleSummary.process.pid,38588);
assert.deepEqual(cycleSummary.process,derived.b14CycleSummary.process);
assert.ok(cycleSummary.process.product_live_seconds_before_close>=28800);
assert.ok(structure.includes('95.869140625')&&structure.includes('Private Bytes增长'));
assert.ok(structure.includes('根因UNKNOWN'));
assert.ok(!structure.slice(structure.indexOf('id="highlight-b14"'),structure.indexOf('</article>',structure.indexOf('id="highlight-b14"'))).includes('100 MB增长中约62~90 MB已定位为系统合理保留'));
assert.equal(cycleSummary.exception,null);assert.equal(data.highlights[0].status,'user_pass');
const b14Disposition=JSON.parse(await fs.readFile(path.join(dest,'data/b14-user-disposition-20261023.json'),'utf8'));
assert.equal(b14Disposition.status,'user_pass');assert.equal(b14Disposition.raw_verdict,'FAIL');
assert.equal(b14Disposition.run_id,cycleSummary.run_id);assert.equal(b14Disposition.frozen_private_growth_limit_mib,64);
assert.equal(b14Disposition.user_reference_limit_mib,68);assert.equal(b14Disposition.preserved.new_threshold,'NOT_FROZEN');
assert.deepEqual(data.highlights[0].user_disposition,b14Disposition);
assert.equal(cycleSummary.user_disposition.status,b14Disposition.status);
assert.ok(structure.includes('历史8小时长稳测试')&&structure.includes('暂定PASS'));
assert.ok(structure.includes('class="history-metrics-link" href="reports/b14/b14-historical-metrics.html">历史指标</a>'));
const b14History=JSON.parse(await fs.readFile(path.join(dest,'data/b14-historical-metrics.json'),'utf8'));
assert.equal(b14History.runs.length,5);assert.equal(new Set(b14History.runs.map(run=>run.run_id)).size,5);
assert.equal(b14History.totals.scalar_samples,10000);assert.equal(b14History.totals.metric_rows,100);
for(const run of b14History.runs){
  assert.equal(run.cycle_count,100);assert.equal(run.metrics.length,20);assert.equal(run.raw_verdict,'FAIL');
  assert.equal(run.per_cycle.length,100);
  assert.deepEqual(run.per_cycle.map(row=>row.cycle),Array.from({length:100},(_,index)=>index+1));
  for(const row of run.metrics){
    assert.equal(row.n,100);assert.ok(['mean','p50','p95','max'].every(key=>Number.isFinite(row[key])));assert.ok(row.unit);
    const values=run.per_cycle.map(cycle=>cycle[row.id]);assert.ok(values.every(Number.isFinite));
    const sorted=[...values].sort((left,right)=>left-right);
    const expected={mean:values.reduce((sum,value)=>sum+value,0)/100,p50:sorted[49],p95:sorted[94],max:sorted[99]};
    for(const [field,value] of Object.entries(expected))closeTiming(row[field],value,run.run_id+' '+row.id+' '+field);
  }
}
assert.equal(b14History.runs.filter(run=>run.original_private_bytes_growth.growth_mib>64).length,3);
assert.equal(b14History.runs.filter(run=>run.original_private_bytes_growth.growth_mib>68).length,3);
const historyMarkup=await fs.readFile(path.join(dest,'reports/b14/b14-historical-metrics.html'),'utf8');
assert.equal((historyMarkup.match(/<table class="history-statistics"/g)||[]).length,5);
assert.equal((historyMarkup.match(/<tr data-metric-id=/g)||[]).length,100);
assert.equal((historyMarkup.match(/<th scope="col">/g)||[]).length,35);
checks.b14_user_provisional_pass_preserves_raw_fail_and_original_gate=true;
checks.b14_five_historical_runs_six_statistics_and_no_retest=true;
checks.b14_first_frame_unknown_not_fabricated=true;
checks.b14_same_process_and_fixed_stages_documented=true;
checks.b14_complete_raw_fail_private_growth_without_inherited_exception=true;
const m5=data.highlights.find(x=>x.id==='highlight-whiteboard');assert.equal(m5.metrics[0].value,0.2652);
assert.ok(!data.highlights.some(x=>x.id==='highlight-e2e'));assert.ok(!ids.includes('highlight-e2e'));
checks.media_latency_highlight_removed=true;
checks.highlight_result_boundaries=true;
// New completed subgates remain separate from the original measurement windows and gates.
const stageClosure=JSON.parse(await fs.readFile(path.join(dest,'data/stage-closure-20261022.json'),'utf8'));
const stageReference=JSON.parse(await fs.readFile(path.join(dest,'reports/product/stage-closure-20261022.json'),'utf8'));
assert.equal(stageClosure.status,'STAGE_CLOSED_PARTIAL');
assert.equal(stageReference.status,'PARTIAL');
assert.equal(stageReference.task_status,'STAGE_CLOSED_BY_USER');
assert.equal(stageReference.draft,false);assert.equal(stageReference.final_snapshot,true);
assert.deepEqual(stageReference.active_runs,[]);
assert.equal(stageClosure.full_plan_gates_completed,0);assert.equal(stageReference.summary.full_plan_gates_completed,0);
assert.equal(stageClosure.formal_credit,0);assert.equal(stageClosure.p20_credit,0);
assert.equal(stageClosure.production_ready,false);assert.equal(stageReference.summary.production_ready,false);
assert.equal(stageClosure.source_artifact_final_freeze,false);assert.equal(stageClosure.full_goal_complete,false);
assert.equal(stageClosure.final_regression,'NOT_RUN');assert.equal(stageReference.summary.final_regression_status,'NOT_RUN');
assert.equal(stageReference.summary.completion_percentage,null);
assert.equal(stageClosure.groups.length,24);
assert.deepEqual(stageClosure.groups.map(row=>row.plan_code),testPlan.groups.map(row=>row.plan_code));
const decisionMarkup=structure.slice(structure.indexOf('id="decision"'),structure.indexOf('id="highlights"'));
assert.ok(decisionMarkup.includes('reports/product/stage-closure-20261022.html')&&decisionMarkup.includes('PARTIAL'),'Existing conclusion must link the closed partial stage');
assert.ok(decisionMarkup.includes(htmlEscape(data.stageReleaseDecision.statement)));
assert.ok(!decisionMarkup.includes('当前证据仍不足以签发项目正式验收通过'));
assert.equal(stageReference.current_revision_date,'2026-10-27');
assert.equal(stageReference.release_approval.status,'APPROVED_BY_USER');
assert.equal(stageReference.release_approval.version,'0.0.1');
assert.equal(stageReference.release_approval.publication_status,'NOT_EXECUTED');
assert.deepEqual(stageReference.current_groups,closureRecords.map(record=>({
  plan_code:record.plan_code,title:record.title,status:record.status,
  stage_status:record.stage_status,completed_results:record.completed_results||[]
})),'The current closure must include the latest P10 result and user disposition');
for(const disposition of data.stageReleaseDecision.deferred_groups){
  const current=beforeP10Records.find(record=>record.plan_code===disposition.plan_code);
  assert.equal(current.status,'DEFERRED');
  assert.equal(current.stage_status.original_status,disposition.original_status);
  assert.equal(stageClosure.groups.find(record=>record.plan_code===disposition.plan_code).stage_status.status,disposition.original_status);
  for(const gate of disposition.gate_dispositions){
    const projected=current.stage_status.gates.find(row=>row.index===gate.index);
    assert.equal(projected.status,'DEFERRED');assert.equal(projected.original_status,gate.original_status);
  }
}
assert.deepEqual(data.stageRefresh.current_group_status_counts,stageReference.current_group_status_counts);
checks.current_closure_matches_main_and_user_approved_release=true;
if(latestP10){
  assert.equal(closureRecords.find(record=>record.plan_code==='P10').status,'PASS_SCOPED');
  checks.current_20261027_closure_includes_p10_scoped_pass_under_revised_policy=true;
}
assert.ok(structure.includes('完整主门')&&structure.includes('NOT_RUN'));
assert.equal(data.stageRefresh.status,stageClosure.status);
assert.equal(data.stageRefresh.full_plan_gates_completed,0);assert.equal(data.stageRefresh.formal_credit,0);assert.equal(data.stageRefresh.p20_credit,0);
assert.equal(data.stageRefresh.final_regression,'NOT_RUN');assert.equal(data.stageRefresh.production_ready,false);
assert.deepEqual(data.stageRefresh.group_status_counts,stageClosure.group_status_counts);
const updatedStageGroups=['P02','P03','P05','P06','P07','P11','P12','P13','P14','P17','P21','A01'];
assert.deepEqual(data.stageRefresh.new_completed_group_codes,updatedStageGroups);
assert.deepEqual(data.stageRefresh.group_updates.map(row=>row.plan_code),updatedStageGroups);
assert.equal(new Set(data.stageRefresh.sources.map(row=>row.path)).size,data.stageRefresh.sources.length);
for(const receipt of data.stageRefresh.sources){
  const bytes=await fs.readFile(safePath(receipt.path));
  assert.equal(sha(bytes),receipt.sha256,'Stage source hash: '+receipt.path);assert.equal(bytes.length,receipt.bytes);
  assert.equal(data.portableFiles[norm(receipt.path)]?.sha256,receipt.sha256,'Stage source is not bound to the portable map: '+receipt.path);
}
for(const record of beforeP10Records){
  const original=beforeStage.retestRecords.find(row=>row.id===record.id);
  for(const key of ['status','gates','conditions','metrics','source_checks','originalIds','plan_code','plan_kind'])assert.deepEqual(record[key],original[key],'Stage notes changed a plan or execution field: '+record.id+'.'+key);
  const note=data.stageRefresh.group_updates.find(row=>row.plan_code===record.plan_code);
  assert.equal(record.boundaries.length,original.boundaries.length+(note?1:0));
  if(note){
    assert.equal(note.status,stageClosure.groups.find(row=>row.plan_code===record.plan_code).stage_status.status);
    assert.equal(note.full_gate_credit,0);assert.equal(record.boundaries.at(-1),note.note);
    assert.ok(record.limitations.includes(note.note));
  }
}
const readCompletedStage=async(name,expectedHash)=>{
  const bytes=await fs.readFile(path.join(dest,'data/completed-evidence',name));
  if(expectedHash)assert.equal(sha(bytes),expectedHash,'Completed stage receipt changed: '+name);
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
};
const firstPair=await readCompletedStage('telemetry-paired-first-20261021-index.json','271e7c548683b555ff02b3b6132e77328e9437f1a74ba4f5820f9ff8dddbe27e');
assert.equal(firstPair.status,'FAIL');assert.equal(firstPair.phase,'paired');assert.equal(firstPair.diagnostic_stage_timing,false);
assert.deepEqual(firstPair.windows.map(row=>row.name),['1-off','1-on']);
assert.ok(firstPair.windows.every(row=>row.status==='PASS'));
assert.equal(firstPair.pairs.length,1);
const failedPair=firstPair.pairs[0];
assert.equal(failedPair.status,'FAIL');
assert.equal(failedPair.cpu_increase_pp,0.35540558662087607);
assert.equal(failedPair.working_set_increase_bytes,-3411968);
assert.equal(failedPair.callback_p99_increase_upper_percent,7.014681892332786);
assert.equal(failedPair.limits.callback_p99_increase_percent,5);
assert.ok(failedPair.callback_p99_increase_upper_percent>failedPair.limits.callback_p99_increase_percent);
const currentTelemetry=data.highlights.find(row=>row.id==='highlight-b15');
assert.equal(currentTelemetry.status,'PASS（原配对范围／最新资源子门）','The telemetry badge must describe the displayed 180-second pairs and independent resource subgate');
const telemetryDescription=JSON.stringify({status:currentTelemetry.status,summary:currentTelemetry.summary,scope:currentTelemetry.scope,limitations:currentTelemetry.limitations});
assert.ok(telemetryDescription.includes('FAIL')&&telemetryDescription.includes('7.014681')&&telemetryDescription.includes('UNKNOWN'),'Formal first-pair failure and unresolved cause must stay visible');
assert.ok(currentTelemetry.sources.includes('data/completed-evidence/telemetry-paired-first-20261021-index.json'));
assert.deepEqual(currentTelemetry.metrics.slice(0,4),beforeStage.highlights.find(row=>row.id==='highlight-b15').metrics.slice(0,4),'One sixty-second pair must not replace three historical 180-second pairs');
const currentE2EE=[...data.highlights,...(data.retainedHighlights||[])].find(row=>row.id==='highlight-e2ee');
assert.equal(currentE2EE.status,'PASS（Native 限定性能负载）','The E2EE badge must describe the displayed Native performance subgate');
const e2eeDescription=JSON.stringify({summary:currentE2EE.summary,scope:currentE2EE.scope,limitations:currentE2EE.limitations});
assert.ok(e2eeDescription.includes('14 PASS')&&e2eeDescription.includes('2 FAIL')&&e2eeDescription.includes('Flutter'),'The independent Flutter failures must remain visible in their own scope');
for(const highlight of [currentTelemetry,...(latestP10?[]:[currentE2EE])]){
  const start=structure.indexOf('id="'+highlight.id+'"');
  const markup=structure.slice(start,structure.indexOf('</article>',start));
  assert.ok(markup.includes(htmlEscape(highlight.status)),'Visible card badge must match the displayed metric scope: '+highlight.id);
  assert.ok(markup.includes(htmlEscape(highlight.summary)),'The latest independent failure must remain in the card summary: '+highlight.id);
}
const boardLoad=await readCompletedStage('whiteboard-1800-fixed04-20261021-result.json','021c25321c4ec0ef4e3d00296ac691310af69d3711211c37190e0ec2d9e3dbe6');
assert.equal(boardLoad.status,'PASS');
assert.equal(boardLoad.contract.independent_product_processes,8);assert.equal(boardLoad.contract.writer_count,4);
assert.ok(Math.abs(boardLoad.measured_seconds-1802.609)<1e-8);
assert.equal(boardLoad.steady_window_processes.length,8);assert.equal(new Set(boardLoad.steady_window_processes).size,8);
assert.equal(Object.keys(boardLoad.writer_strokes).length,4);assert.ok(Object.values(boardLoad.writer_strokes).every(rows=>rows.length===361));
assert.equal(Object.values(boardLoad.cycle_counts).reduce((sum,value)=>sum+value,0),50);
assert.equal(Object.keys(boardLoad.lifecycle).length,8);assert.ok(Object.values(boardLoad.lifecycle).every(row=>row.exit_code===0));
assert.equal(boardLoad.peer_cleanup.status,'PASS');assert.deepEqual(boardLoad.peer_cleanup.forced_roles,[]);
assert.ok(Object.values(boardLoad.peer_cleanup.native_retirement).every(row=>row.status==='PASS'&&row.exit_code===0&&row.retirement.cleanup_pending===0&&row.retirement.rooms_alive===0));
assert.ok(boardLoad.network_clear.qdisc.every(row=>row.kind!=='netem'));
const boardHighlight=data.highlights.find(row=>row.id==='highlight-whiteboard');
const boardDescription=JSON.stringify({summary:boardHighlight.summary,scope:boardHighlight.scope,limitations:boardHighlight.limitations});
assert.ok(boardDescription.includes('1802.609')&&boardDescription.includes('361')&&boardDescription.includes('50'));
assert.ok(boardHighlight.sources.includes('data/completed-evidence/whiteboard-1800-fixed04-20261021-result.json'));
const qualityResult=await readCompletedStage('capture-quality-2k-20261021-result.json','2da4b1453628daebf6e8bf96d06d8b62187b3af266dd948a211d79e1616d96b8');
assert.equal(qualityResult.status,'PASS');assert.equal(qualityResult.run_id,'capture-1518e671257643deadef4041552867b9');
assert.equal(qualityResult.case,'complex-wgc-screen');assert.equal(qualityResult.quality.length,1);
const quality=qualityResult.quality[0];
assert.equal(quality.status,'PASS');assert.equal(quality.width,2560);assert.equal(quality.height,1440);assert.equal(quality.samples,30);
assert.deepEqual(quality.thresholds,{luma_ssim:.95,psnr_db:30,text_psnr_db:30});
assert.equal(quality.unmatched_or_stale,0);assert.equal(quality.warmup_seconds,15);
assert.equal(quality.min_i420_psnr_db,45.61952840220541);assert.equal(quality.min_luma_ssim,.9972994428578399);assert.equal(quality.min_text_luma_psnr_db,41.0715519452983);
assert.ok(quality.min_i420_psnr_db>=quality.thresholds.psnr_db&&quality.min_luma_ssim>=quality.thresholds.luma_ssim&&quality.min_text_luma_psnr_db>=quality.thresholds.text_psnr_db);
const screenHighlight=data.highlights.find(row=>row.id==='highlight-screen-share');
assert.ok(screenHighlight.sources.includes('data/completed-evidence/capture-quality-2k-20261021-result.json'));
assert.deepEqual(screenHighlight.metrics[7],beforeStage.highlights.find(row=>row.id==='highlight-screen-share').metrics[7],'Objective image quality is not a new CPU/network cost result');
for(const name of ['ui-smoke-export-observed15-20261021-scoped.json','ui-timing-theme-unblocked09-20261021-scoped.json','p21-meeting-theme04-20261022-scoped.json','p21-meeting-cpu05-20261022-scoped.json','p21-meeting-opengl05-20261022-scoped.json']){
  const receipt=await readCompletedStage(name);
  assert.equal(receipt.status,'PASS_SCOPED');assert.equal(receipt.full_plan_gate_credit,0);assert.equal(receipt.formal_credit,0);assert.equal(receipt.p20_credit,0);
}
checks.closed_stage_partial_without_full_gate_or_release_credit=true;
checks.completed_stage_sources_bound_and_hashed=data.stageRefresh.sources.length;
checks.completed_stage_notes_preserve_original_metric_windows_and_plan=true;
checks.new_formal_first_pair_failure_separate_from_old_three_pairs=true;
checks.whiteboard_1800_completed_scope_not_substituted_for_b12_or_m5=true;
checks.objective_2k_quality_does_not_replace_cpu_cost=true;
const completedSourceJSON=new Map();
for(const receipt of data.completedResultProjection.sources){
  const bytes=await fs.readFile(safePath(receipt.path));
  assert.equal(sha(bytes),receipt.sha256,'Completed-result source hash: '+receipt.path);
  assert.equal(bytes.length,receipt.bytes);
  assert.equal(data.portableFiles[norm(receipt.path)]?.portable_path,receipt.path);
  completedSourceJSON.set(receipt.path,JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
}
for(const record of data.retestRecords.filter(row=>row.plan_kind==='product'))for(const result of record.completed_results){
  assert.ok(result.id&&result.title&&result.scope&&result.date,'Completed results must retain their independent scope and date');
  if(latestP10&&record.plan_code==='P10'&&result.source_path===latestP10Source&&result.status==='INCONCLUSIVE'){
    assert.ok(latestP10.runs.some((run,index)=>run.status===result.status&&result.source_locator==='/runs/'+index+'/status'),'Only an explicitly terminal P10 run may project INCONCLUSIVE');
  }else assert.match(result.status,/^(?:PASS(?:_[A-Z0-9]+)*|FAIL(?:_[A-Z0-9]+)*|READY|OBSERVATION_ONLY|PASS_SCOPED \/ NOT_CLOSED)$/,'Unfinished or unexecuted attempts cannot be completed test results');
  assert.ok(completedSourceJSON.has(result.source_path),'Completed result source must have a checked receipt');
  assert.ok(result.source_locator.startsWith('/'),'Completed result needs an exact JSON Pointer to its original judgment');
  let value=completedSourceJSON.get(result.source_path);
  for(const token of result.source_locator.slice(1).split('/')){
    const key=token.replace(/~1/g,'/').replace(/~0/g,'~');
    assert.ok(value&&Object.hasOwn(value,key),'Invalid completed-result source locator: '+result.source_path+result.source_locator);
    value=value[key];
  }
  assert.equal(value,result.status,'Completed-result badge must equal the original source judgment');
  if(result.current_disposition){
    assert.equal(result.status,'FAIL');
    const disposition=result.current_disposition;
    const report=completedSourceJSON.get(disposition.source_path);
    if(record.plan_code==='P20'){
      assert.equal(result.id,'current-b14-latest-complete');
      assert.equal(report.schema,'cohavora-b14-user-provisional-disposition-v1');
      assert.equal(disposition.status,'user_pass');assert.equal(report.status,disposition.status);
      assert.equal(disposition.date,report.date);assert.equal(disposition.source_locator,'/status');
      assert.equal(disposition.report_path,disposition.source_path);
      assert.equal(report.raw_verdict,result.status);assert.equal(report.run_id,cycleSummary.run_id);
      assert.equal(report.preserved.runtime,'NOT_RUN');assert.equal(report.preserved.full_gate_credit,0);
      continue;
    }
    assert.ok(['P05','P06'].includes(record.plan_code));
    assert.equal(report.schema,'cohavora-p05-p06-deferred-bugs-v1');
    assert.equal(report.execution,'NOT_RUN');assert.equal(report.full_gate_credit,0);
    assert.equal(disposition.status,'DEFERRED');assert.equal(disposition.date,report.decision_at);
    const tokens=disposition.source_locator.split('/');
    assert.deepEqual([tokens[1],tokens[3]],['case_dispositions','status']);
    const decision=report.case_dispositions[Number(tokens[2])];
    assert.equal(decision.result_id,result.id);assert.equal(decision.status,disposition.status);
    assert.equal(decision.original_status,result.status);assert.equal(decision.bug_id,disposition.bug_id);
    assert.equal(decision.source_path,result.source_path);assert.equal(decision.source_locator,result.source_locator);
    assert.ok(report.bugs.some(bug=>bug.id===decision.bug_id&&bug.status==='DEFERRED'));
  }
}
const completedFor=code=>data.retestRecords.find(record=>record.plan_code===code).completed_results;
const latestP15=completedSourceJSON.get(data.completedP15Refresh.source);
assert.equal(data.completedP15Refresh.source,'reports/product/p15-lan-clock-20261022.json');
const p15Bytes=await fs.readFile(safePath(data.completedP15Refresh.source));
assert.equal(sha(p15Bytes),data.completedP15Refresh.sha256);assert.equal(p15Bytes.length,data.completedP15Refresh.bytes);
assert.equal(latestP15.schema,'cohavora-p15-clock-retest-v1');assert.equal(latestP15.status,'PASS');
assert.equal(latestP15.run_id,data.completedP15Refresh.run_id);assert.ok(latestP15.run_id);
assert.equal(data.completedP15Refresh.status,'PASS');assert.equal(data.completedP15Refresh.full_gate_credit,0);
assert.equal(data.completedP15Refresh.product_retest_executed_by_document_refresh,false);
assert.equal(latestP15.finished_utc,data.completedP15Refresh.finished_utc);
assert.equal(latestP15.finished_beijing,data.completedP15Refresh.finished_beijing);
assert.ok(Number.isFinite(Date.parse(latestP15.finished_utc))&&Number.isFinite(Date.parse(latestP15.finished_beijing)));
for(const [metric,expected] of Object.entries({requested_probes:30,marker_matched:30,accepted_clock_exchanges:55,valid_one_way_samples:30,uncertain_probes:0,gate_us:10000,clock_uncertainty_us:2898,best_rtt_us:1259}))assert.equal(latestP15.metrics[metric],expected,'P15 completed metric '+metric);
assert.ok(latestP15.metrics.clock_uncertainty_us<=latestP15.metrics.gate_us);
assert.equal(latestP15.clock_route,'lan_udp');assert.equal(latestP15.clock_configuration.model,'affine_interval_v1');
assert.equal(latestP15.clock_configuration.shared_clock_ground_truth,false);
for(const artifact of Object.values(latestP15.artifacts)){
  const bytes=await fs.readFile(safePath(artifact.path));assert.equal(sha(bytes),artifact.sha256);assert.equal(bytes.length,artifact.bytes);
}
const p15Run=JSON.parse(await fs.readFile(safePath(latestP15.artifacts['report.json'].path),'utf8'));
const p15Clock=p15Run.software_validation.clock_evidence;
assert.equal(p15Run.status,'PASS');assert.equal(p15Run.run_id,latestP15.run_id);
assert.equal(p15Clock.status,'PASS');assert.equal(p15Clock.model,'affine_interval_v1');
assert.equal(p15Clock.accepted_exchanges,55);assert.equal(p15Clock.probes.length,30);assert.deepEqual(p15Clock.resets,[]);
assert.equal(Math.max(...p15Clock.probes.map(probe=>probe.reproduced_uncertainty_us)),latestP15.metrics.clock_uncertainty_us);
assert.ok(p15Clock.probes.every(probe=>probe.calibration_span_us>=3000000&&probe.reproduced_uncertainty_us<=10000));
assert.equal(p15Run.clock_configuration.endpoints.publisher.local,'192.168.31.17:57990');
assert.equal(p15Run.clock_configuration.endpoints.publisher.remote,'192.168.31.151:57991');
assert.equal(p15Run.server_endpoint,'ws://123.56.225.164:17980');
assert.equal(p15Run.remote_clock_firewall.finish.status,'REMOVED_OWNED_RULE');
assert.equal(latestP15.validation.publisher_process_exit_code,0);assert.equal(latestP15.validation.receiver_process_exit_code,0);
assert.equal(latestP15.validation.independent_recalculation_status,'PASS');
for(const field of ['cleanup_confirmed','evidence_complete','binary_unchanged'])assert.equal(latestP15.validation[field],true);
assert.equal(latestP15.validation.environment_cleanup_status,'PASS');assert.equal(latestP15.full_gate_credit,0);
assert.equal(latestP15.historical.status,'FAIL');assert.equal(latestP15.historical.uncertainty_us,41258);
assert.equal(latestP15.historical.retained,true);assert.equal(latestP15.historical.root_cause,'UNKNOWN');
assert.equal(latestP15.previous_aliyun.status,'FAIL');assert.equal(latestP15.previous_aliyun.uncertainty_us,26496);
assert.equal(latestP15.previous_aliyun.retained,true);
for(const archived of latestP15.previous_aliyun.archived_files){
  const bytes=await fs.readFile(path.join(latestP15.previous_aliyun.archive_root,archived.path));
  assert.equal(sha(bytes),archived.sha256);assert.equal(bytes.length,archived.bytes);
}
assert.equal(latestP15.group_status,'PARTIAL');assert.equal(latestP15.physical_measurement,'NOT_RUN');
assert.equal(latestP15.cross_host_media_latency,'NOT_RUN_REAL_PRODUCT_PATH');
const historicalP15=baseline.historicalRecords.find(record=>record.id==='H122');
assert.equal(historicalP15.status,'FAIL');assert.equal(historicalP15.metrics.find(metric=>metric.name==='校时不确定度').value,41.258);
assert.equal(historicalP15.metrics.find(metric=>metric.name==='有效单程样本').value,0);
const p15Results=completedFor('P15');assert.equal(p15Results.length,1);
const p15Result=p15Results[0];assert.equal(p15Result.id,'p15-aliyun-software-clock');
assert.equal(p15Result.status,'PASS');assert.equal(p15Result.source_path,data.completedP15Refresh.source);assert.equal(p15Result.source_locator,'/status');
assert.equal(p15Result.date,latestP15.finished_beijing);
for(const detail of ['阿里云','LAN UDP','2898','10000us','30/30','26.496ms','历史H122','未执行'])assert.ok(p15Result.scope.includes(detail));
const p15Projection=data.completedResultProjection.groups.find(group=>group.plan_code==='P15');
assert.deepEqual(p15Projection.status_counts,{PASS:1});assert.deepEqual(p15Projection.current_status_counts,{PASS:1});
assert.ok(data.retestRecords.find(record=>record.plan_code==='P15').sources.includes(data.completedP15Refresh.source));
assert.ok(!data.stageRefresh.group_updates.some(update=>update.plan_code==='P15'),'P15 later evidence must not rewrite frozen stage notes');
checks.latest_p15_lan_clock_pass_and_historical_failures_retained=true;
const deferredReport=completedSourceJSON.get(data.deferredFlutterBugs.source);
assert.equal(deferredReport.bugs.length,2);assert.equal(deferredReport.case_dispositions.length,3);
assert.equal(deferredReport.acceptance_credit,0);assert.equal(deferredReport.summary.diagnostic_runs_counted_as_product_results,0);
for(const receipt of deferredReport.sources){
  const bytes=await fs.readFile(safePath(receipt.path));
  assert.equal(sha(bytes),receipt.sha256,'Original evidence in deferred bug record must retain its fingerprint');
  assert.equal(bytes.length,receipt.bytes);
}
const deferredReportBytes=await fs.readFile(safePath(data.deferredFlutterBugs.report));
assert.equal(sha(deferredReportBytes),data.deferredFlutterBugs.report_sha256);
for(const [code,gateIndex] of [['P05',0],['P06',1]]){
  const record=data.retestRecords.find(row=>row.plan_code===code);
  assert.equal(record.status,'DEFERRED');assert.equal(record.stage_status.previous_assessment.status,'FAIL');
  assert.equal(record.stage_status.gates[gateIndex].status,'DEFERRED');
  assert.equal(record.stage_status.gates[gateIndex].previous_status,'FAIL');
  assert.deepEqual(completedFor(code).filter(result=>result.current_disposition).map(result=>result.id).sort(),deferredReport.case_dispositions.map(row=>row.result_id).sort());
  assert.ok(completedFor(code).filter(result=>result.status==='FAIL').every(result=>result.current_disposition?.status==='DEFERRED'));
  const projection=data.completedResultProjection.groups.find(row=>row.plan_code===code);
  assert.equal(projection.status_counts.FAIL,3);assert.equal(projection.current_status_counts.DEFERRED,3);
  assert.equal(projection.current_status_counts.FAIL,undefined);
}
checks.p05_p06_user_deferred_without_rewriting_original_failures=true;
const latestNetwork=completedSourceJSON.get(data.completedNetworkRefresh.source);
const p09=data.retestRecords.find(record=>record.plan_code==='P09');
assert.equal(p09.status,'PARTIAL');
assert.equal(new Date(p09.date).getTime(),new Date(latestNetwork.closed_utc).getTime());
assert.deepEqual(p09.stage_status.retained_failures,[],'Superseded network failures remain historical, not current FAIL');
assert.equal(completedFor('P09').length,11,'The batch summary is not a twelfth case');
assert.ok(completedFor('P09').every(result=>result.status==='PASS'&&result.source_path===data.completedNetworkRefresh.source));
assert.deepEqual(completedFor('P09').map(result=>result.id).sort(),latestNetwork.cases.map(row=>'network-'+row.case).sort());
for(const field of ['case_status','cleanup_status','input_identity_status','environment_restore_status','security_group_restore_status'])assert.equal(latestNetwork[field],'PASS');
assert.ok(latestNetwork.cases.every(row=>row.status==='PASS'&&row.persistence_close_status==='PASS'&&row.exit_codes.receiver===0&&row.exit_codes.publisher===0&&Object.values(row.native_retirement).every(peer=>peer.rooms_alive===0&&peer.cleanup_pending===0)));
assert.equal(latestNetwork.cases.find(row=>row.case==='turn-relay').local_candidate,'relay');
assert.equal(latestNetwork.cases.find(row=>row.case==='path-switch').protocol,'tcp');
assert.equal(latestNetwork.full_P09_gate_credit,0);
assert.equal(latestNetwork.history.original_ten_case_batch,'FAIL');
assert.equal(latestNetwork.history.original_terminal_input_identity,'UNKNOWN');
assert.ok(latestNetwork.not_covered.includes('actual audio recovery')&&latestNetwork.not_covered.includes('fault live-current/UI export'));
assert.equal(data.stageRefresh.group_status_counts.FAIL,stageClosure.group_status_counts.FAIL,'The frozen-stage history must remain unchanged');
assert.ok(completedFor('P02').some(result=>result.id==='network-eleven-store-close'&&result.status==='PASS'));
assert.equal(data.retestRecords.find(record=>record.plan_code==='P02').date,p09.date,'Updated snapshot/store-close scope must use the latest closeout date');
assert.ok(!vm.runInContext('recordMarkup('+JSON.stringify(p09)+',"retest")',actual.context).includes('冻结时整组状态'),'Latest completed scope must not be labeled as the old frozen state');
assert.ok(!completedFor('P12').some(result=>result.source_path===data.completedNetworkRefresh.source)&&!completedFor('P17').some(result=>result.source_path===data.completedNetworkRefresh.source),'Runtime receipt must not supersede independent export or review evidence');
checks.latest_network_eleven_passes_replace_superseded_current_failures=true;
assert.equal(completedFor('P04').filter(result=>result.source_path==='reports/product/functional-media-retest-20261020-01.json'&&result.status==='PASS').length,22,'Codec and recovery cases must be counted once despite mappings to several broad gates');
for(const file of ['wgc-3600-100-20261021-result.json','wgc-1800-20261021-resource-analysis.json','gdi-hot-50-20261021-summary.json'])assert.ok(completedFor('P07').some(result=>result.source_path.endsWith(file)&&result.status==='PASS'),'Completed screen-sharing PASS must be visible: '+file);
assert.ok(completedFor('P11').some(result=>result.source_path.endsWith('whiteboard-1800-fixed04-20261021-result.json')&&result.status==='PASS'),'Completed whiteboard load PASS must be visible');
assert.ok(!completedFor('P11').some(result=>result.id==='desktop-whiteboard-functional')&&!completedFor('P07').some(result=>result.id==='desktop-capture-quality-fullscreen'),'Raw B12 and complex-wgc-screen receipts must not be counted again through their parent summaries');
// These independently completed subgates retain their original result dates and scopes.
for(const [code,index,resultIds] of [
  ['P06',3,['native-abba-performance','native-common-600']],
  ['P07',2,['gdi-hot-50-20261021-summary','wgc-1800-20261021-resource-analysis','wgc-3600-100-20261021-result']],
  ['P09',2,['network-service-restart','network-auth-recovery']],
  ['P09',3,['network-path-switch','network-turn-relay']],
  ['P11',0,['whiteboard-b12-20261021-index']],
  ['P13',1,['telemetry-uia-interference']],
  ['P13',2,['telemetry-residual-growth']],
  ['P13',3,['telemetry-9000s-20261021-result']]
]){
  const record=data.retestRecords.find(row=>row.plan_code===code);
  assert.equal(record.stage_status.gates.find(gate=>gate.index===index).status,'PASS_SCOPED','Completed scoped subgate must not retain an obsolete PARTIAL: '+code+'.'+index);
  for(const id of resultIds)assert.ok(completedFor(code).some(result=>result.id===id&&result.status==='PASS'),'Scoped subgate requires its original completed PASS: '+id);
  assert.equal(record.status,code==='P06'?'DEFERRED':'PARTIAL');
  assert.equal(record.full_gate_credit,0);
}
checks.completed_scoped_subgates_synced_without_full_group_promotion=true;
const updateOnlineSource='data/completed-evidence/p21-update-online-20261027-scoped.json';
const updateOnline=completedSourceJSON.get(updateOnlineSource);
assert.equal(updateOnline.status,'PASS_SCOPED');
assert.equal(updateOnline.install_or_upgrade,'NOT_RUN');assert.equal(updateOnline.installer_launched,false);
assert.equal(updateOnline.full_P21_gate_credit,0);
assert.deepEqual(updateOnline.cases.map(row=>[row.case,row.status,row.download_verified,row.up_to_date]),[
  ['primary-upgrade','PASS',true,false],['github-check','PASS',false,false],['same-version','PASS',false,true]
]);
assert.ok(updateOnline.cases.every(row=>row.installer_launched===false));
const updateOnlineResults=completedFor('P21').filter(result=>result.source_path===updateOnlineSource);
assert.equal(updateOnlineResults.length,4,'Three protocol cases and independent public verification are separate completed scopes');
assert.ok(updateOnlineResults.every(result=>result.status==='PASS'));
assert.ok(updateOnlineResults.filter(result=>result.id!=='update-public-release-identity').every(result=>result.date.includes(updateOnline.completed_date)),'Protocol cases must retain their original batch receipt time');
assert.equal(updateOnlineResults.find(result=>result.id==='update-public-release-identity').date,updateOnline.public_verification.checked_at_utc);
assert.equal(updateOnline.public_verification.ed25519_and_installer_verification,'PASS');
const updatePlan=data.retestRecords.find(record=>record.plan_code==='P21');
assert.equal(updatePlan.status,'PARTIAL');assert.equal(updatePlan.stage_status.gates[0].status,'PARTIAL');assert.equal(updatePlan.full_gate_credit,0);
assert.ok(updatePlan.stage_status.remaining.some(text=>text.includes('安装／覆盖升级仍NOT_RUN')));
checks.p21_completed_online_update_scopes_preserve_dates_inputs_and_install_not_run=true;
const latestTelemetry=completedSourceJSON.get(data.completedTelemetryRefresh.source);
const latestTelemetryResults=completedFor('P13').filter(result=>result.source_path===data.completedTelemetryRefresh.source);
assert.equal(latestTelemetry.requested_seconds,60);
assert.equal(latestTelemetry.requested_pairs,3);
assert.equal(latestTelemetryResults.length,latestTelemetry.completed_pairs,'Only completed formal pairs count; window and batch summaries are not additional cases');
assert.deepEqual(latestTelemetryResults.map(result=>result.status),latestTelemetry.pairs.map(pair=>pair.status));
assert.deepEqual(latestTelemetryResults.map(result=>result.source_locator),latestTelemetry.pairs.map((_,index)=>'/pairs/'+index+'/status'));
assert.equal(latestTelemetry.remaining_pairs,latestTelemetry.requested_pairs-latestTelemetry.completed_pairs);
assert.equal(latestTelemetry.windows.length,latestTelemetry.completed_pairs*2);
for(const window of latestTelemetry.windows){
  assert.equal(window.status,'PASS');assert.equal(window.requested_seconds,60);
  assert.equal(window.stage_timing_enabled,false);assert.equal(window.diagnostic_artifacts_absent,true);
  assert.ok(window.callback_p99.samples>=500);
  assert.ok(window.ui_batch_maximum_ms<=4&&window.telemetry_refresh_samples>=48);
  assert.ok(window.persistence_close.history_completed&&window.persistence_close.diagnostic_completed&&!window.persistence_close.disk_unknown);
  assert.ok(Object.values(window.lifecycle).every(peer=>peer.exit_code===0&&peer.retirement.rooms_alive===0&&peer.retirement.cleanup_pending===0));
}
for(const pair of latestTelemetry.pairs){
  assert.deepEqual(pair.limits,failedPair.limits,'Latest formal pairs retain the original thresholds');
  if(pair.status==='PASS')assert.ok(pair.callback_p99_increase_upper_percent<=5&&pair.cpu_increase_pp<=1&&pair.working_set_increase_bytes<=33554432);
}
if(latestTelemetry.paired_status==='PASS'){
  assert.equal(latestTelemetry.completed_pairs,3);assert.ok(latestTelemetryResults.every(result=>result.status==='PASS'));
  assert.equal(latestTelemetry.remaining_pairs_status,'NOT_APPLICABLE');
}else assert.equal(latestTelemetry.pairs.at(-1).status,'FAIL');
for(const field of ['cleanup_status','input_identity_status','environment_restore_status','security_group_restore_status'])assert.equal(latestTelemetry[field],'PASS');
assert.equal(latestTelemetry.full_P13_gate_credit,0);assert.equal(data.completedTelemetryRefresh.full_gate_credit,0);
assert.ok(latestTelemetry.historical_failures.some(row=>row.callback_p99_increase_upper_percent===failedPair.callback_p99_increase_upper_percent&&row.original_verdict_preserved===true));
assert.ok(!completedFor('P13').some(result=>result.source_path.endsWith('telemetry-paired-first-20261021-index.json')),'The historical first pair must not count again as the latest matching completed result');
const p13=data.retestRecords.find(record=>record.plan_code==='P13');
assert.equal(p13.status,'PARTIAL');assert.equal(data.completedTelemetryRefresh.group_status,p13.status);
assert.equal(new Date(p13.stage_status.as_of).toISOString(),new Date(latestTelemetry.closed_utc).toISOString());
assert.equal(p13.stage_status.stage_execution,'COMPLETED_SCOPED_BATCH');
assert.equal(completedFor('P13').filter(result=>result.status==='PASS').length,6);
assert.ok(!completedFor('P13').some(result=>result.status.startsWith('FAIL')));
assert.deepEqual(p13.stage_status.retained_failures,[],'Superseded performance failures remain historical, not current failures');
assert.ok(!p13.stage_status.remaining.some(value=>value.includes('后两对NOT_RUN')),'Completed pairs must leave the current remaining scope');
assert.equal(p13.stage_status.gates[0].status,'PASS_SCOPED');
assert.equal(p13.full_gate_credit,0);
assert.ok(currentTelemetry.sources.includes(data.completedTelemetryRefresh.source));
assert.ok(telemetryDescription.includes(latestTelemetry.paired_status)&&latestTelemetry.pairs.every(pair=>telemetryDescription.includes(pair.callback_p99_increase_upper_percent.toFixed(10))));
checks.latest_60s_telemetry_pairs_preserve_history_and_zero_full_gate_credit=true;
const flutterDiagnosis=data.completedFlutterDiagnosis;
const diagnosisBytes=await fs.readFile(safePath(flutterDiagnosis.source));
const executionBytes=await fs.readFile(safePath(flutterDiagnosis.execution_source));
assert.equal(sha(diagnosisBytes),flutterDiagnosis.sha256);assert.equal(sha(executionBytes),flutterDiagnosis.execution_sha256);
const flutterDiagnostic=JSON.parse(diagnosisBytes.toString('utf8'));
const flutterExecution=JSON.parse(executionBytes.toString('utf8'));
assert.equal(flutterDiagnostic.evidence_sha256['execution.json'],sha(executionBytes));
assert.equal(flutterDiagnostic.video_frames,508);assert.equal(flutterDiagnostic.valid_frames,502);
assert.equal(flutterDiagnostic.invalid_frames,6);assert.equal(flutterDiagnostic.matched_frames,6);
assert.equal(flutterDiagnostic.peer_verdict,'FAIL');assert.equal(flutterDiagnostic.passed_checks,69);assert.equal(flutterDiagnostic.total_checks,70);
assert.equal(flutterDiagnostic.root_cause,'SFU_CLOSE_WITH_FLUSH_VP8_BLANK_FRAMES_DELIVERED_BY_NATIVE_SIF_COMPATIBILITY_AS_VIDEO');
assert.equal(flutterExecution.original_acceptance_unchanged,true);assert.equal(flutterExecution.cleanup_confirmed,true);
assert.equal(flutterDiagnosis.acceptance_credit,0);assert.equal(flutterDiagnosis.full_gate_credit,0);
assert.equal(flutterDiagnosis.counted_as_product_result,false);assert.equal(flutterDiagnosis.replaces_shared_retest,false);
assert.equal(flutterDiagnostic.historical_run_0770_attribution,'STRONG_CANDIDATE_NOT_RETROSPECTIVELY_CONFIRMED');
for(const code of ['P05','P06']){
  assert.ok(!completedFor(code).some(result=>[flutterDiagnosis.source,flutterDiagnosis.execution_source].includes(result.source_path)),'Isolated diagnostics must not become another product result');
  const record=data.retestRecords.find(row=>row.plan_code===code);
  assert.ok(record.sources.includes(flutterDiagnosis.source)&&record.limitations.includes(flutterDiagnosis.peer_run_id));
  const sharedResults=completedFor(code).filter(result=>result.source_path.endsWith('flutter-original-failures-retest-20261022-scoped.json'));
  assert.deepEqual(sharedResults.map(result=>result.status),['PASS','FAIL'],'Isolated diagnosis must not replace either completed shared-service repair scenario');
}
checks.completed_flutter_diagnosis_not_counted_or_attributed_to_historical_frames=true;
assert.ok(completedFor('P13').some(result=>result.source_path.endsWith('telemetry-9000s-20261021-result.json')&&result.status==='PASS'),'Independent resource PASS must remain visible beside latest paired performance results');
assert.ok(completedFor('P20').some(result=>result.status==='FAIL'&&result.id==='current-b14-latest-complete'&&result.current_disposition?.status==='user_pass'),'Latest complete Formal must retain raw FAIL and show current user_pass');
assert.equal(data.retestRecords.find(record=>record.plan_code==='P20').status,'user_pass');
const p20Projection=data.completedResultProjection.groups.find(group=>group.plan_code==='P20');
assert.deepEqual(p20Projection.status_counts,{FAIL:1});assert.deepEqual(p20Projection.current_status_counts,{user_pass:1});
const p20Markup=vm.runInContext('recordMarkup(D.retestRecords.find(record=>record.plan_code==="P20"),"retest")',actual.context);
const p20Header=p20Markup.slice(0,p20Markup.indexOf('</summary>'));
assert.ok(p20Header.includes('user_pass 1')&&!p20Header.includes('FAIL 1')&&!p20Header.includes('USER_PASS'));
const p20ResultRow=p20Markup.split('<tr data-result-id="current-b14-latest-complete">')[1]?.split('</tr>')[0];
assert.ok(p20ResultRow?.includes('<span class="badge good">user_pass</span>')&&p20ResultRow.includes('原实测 FAIL'));
checks.b14_user_pass_group_detail_and_current_counts_consistent=true;
assert.ok(completedFor('P06').some(result=>result.id==='native-clear-direct-runtime'&&result.status==='PASS_SCOPED_NATIVE_RUNTIME_ONLY'));
assert.ok(completedFor('P14').some(result=>result.id==='artifact-current-staged-pairs'&&result.status==='PASS_SCOPED_STAGED_PAIR_IDENTITY'));
assert.ok(!completedFor('P14').some(result=>['artifact-old_deployment','artifact-current_renderer_build'].includes(result.id)),'The latest staged-pair and runtime-copy result replaces the previous deployment and renderer identity display; original evidence stays historical');
assert.ok(completedFor('P18').some(result=>result.id==='remote-output-focused-contract'&&result.status==='PASS'));
assert.equal(data.retestRecords.find(record=>record.plan_code==='P20').stage_status.retained_failures.length,1);assert.ok(data.retestRecords.find(record=>record.plan_code==='P20').stage_status.retained_failures[0].includes('resource_growth.private_bytes FAIL'));
assert.equal(data.completedRepairRefresh.full_gate_credit,0);
assert.equal(data.completedRepairRefresh.product_retest_executed_by_document_refresh,false);
const repairJSON=async name=>JSON.parse(await fs.readFile(path.join(dest,'data/completed-evidence',name),'utf8'));
const repairedNative=await repairJSON('repair-native-clear-20261022-runtime.json');
const repairCloseout=await repairJSON('repair-native-clear-20261022-closeout.json');
assert.equal(repairCloseout.acceptance_credit,0);
assert.equal(repairedNative.end_to_end_epoch,'NOT_RUN');
assert.equal(repairedNative.formal_task7,'FAIL_69_OF_70_UNCHANGED');
assert.equal(repairedNative.fixtures.length,3);
assert.ok(repairedNative.fixtures.every(fixture=>fixture.status==='PASS'&&fixture.exit_code===0));
assert.ok(data.completedRepairRefresh.sources.some(receipt=>receipt.path.endsWith('repair-native-clear-20261022-runtime.json')&&Object.values(repairCloseout.evidence_sha256).includes(receipt.sha256)),'Native direct results must be bound by the closeout hash');
for(const receipt of data.completedRepairRefresh.sources){
  const bytes=await fs.readFile(safePath(receipt.path));
  assert.equal(sha(bytes),receipt.sha256,'Repair source hash: '+receipt.path);
  assert.equal(bytes.length,receipt.bytes);
}
checks.completed_repair_scopes_bound_without_formal_promotion=true;
checks.completed_test_badges_match_exact_source_judgments=true;
checks.completed_cases_deduplicated_and_independent_failures_retained=true;
checks.completed_result_source_hashes=data.completedResultProjection.sources.length;
const p19SourceBytes=await fs.readFile(safePath(data.completedP19Refresh.source));
assert.equal(sha(p19SourceBytes),data.completedP19Refresh.sha256);
assert.equal(p19SourceBytes.length,data.completedP19Refresh.bytes);
const latestP19=JSON.parse(p19SourceBytes.toString('utf8'));
const p19Record=data.retestRecords.find(record=>record.plan_code==='P19');
assert.equal(latestP19.status,'READY');assert.equal(latestP19.full_media_gpu_ready,true);
assert.equal(latestP19.controller_id,'e4b0a73762e84cb9ace03afc5fcb22f3');
assert.equal(latestP19.completed_pilots.length,3);
assert.equal(new Set(latestP19.completed_pilots.map(row=>row.run_id)).size,3);
for(const pilot of latestP19.completed_pilots){
  assert.equal(pilot.verdict,'PILOT_PASS');assert.deepEqual(pilot.check_counts,{PASS:78});
  assert.equal(pilot.cycles_pass,2);assert.ok(pilot.duration_seconds>0);
  assert.ok(pilot.check_names.includes('collector_local_route_complete'));
  assert.ok(pilot.check_names.includes('normal_exit_and_no_windows_crash'));
}
assert.equal(p19Record.status,'PARTIAL');assert.equal(p19Record.full_gate_credit,0);
const p19FormalCondition=p19Record.conditions[1];
for(const detail of [cycleSummary.run_id,String(cycleSummary.process.uia_duration_seconds),'P20','95.869140625','user_pass','UNKNOWN'])assert.ok(p19FormalCondition.includes(detail),'P19 conditions must point to the latest independent Formal: '+detail);
assert.ok(!p19FormalCondition.includes('28819.79')&&!p19FormalCondition.includes('无剩余失败'),'Historical Formal completion must not remain the current P19 execution condition');
checks.p19_formal_condition_matches_current_independent_result=true;
const cameraSourceBytes=await fs.readFile(safePath(data.completedP19CameraRefresh.source));
assert.equal(sha(cameraSourceBytes),data.completedP19CameraRefresh.sha256);
const cameraScope=JSON.parse(cameraSourceBytes.toString('utf8'));
assert.equal(cameraScope.status,'PASS_SCOPED');assert.equal(cameraScope.original_verdict,'PASS');
assert.deepEqual(cameraScope.checks,{PASS:33,FAIL:0});
for(const receipt of cameraScope.sources){
  const bytes=await fs.readFile(safePath(receipt.path));
  assert.equal(sha(bytes),receipt.sha256);assert.equal(bytes.length,receipt.bytes);
}
const expectedP19Stage=structuredClone(latestP19.plan_update.stage_status);
expectedP19Stage.completed_scope[2]=cameraScope.completed_scope;
expectedP19Stage.remaining.splice(1,1);
expectedP19Stage.remaining[1]='本机READY仅表示冻结环境资格就绪，不外推其他host或最终发行工件；后续100周期／8小时Formal结果独立见P20，原机器FAIL与用户user_pass分别保留。';
expectedP19Stage.gates[4].interpretation='READY仅适用于本机冻结环境；后续完整Formal结果及用户处置独立见P20，资格整组信用0。';
expectedP19Stage.gates[2].status=cameraScope.status;
expectedP19Stage.gates[2].interpretation=cameraScope.interpretation;
expectedP19Stage.evidence_refs.push(data.completedP19CameraRefresh.source);
assert.deepEqual(p19Record.stage_status,expectedP19Stage,'Camera interpretation and the later independent Formal reference change; qualification fields retain their original scope');
assert.deepEqual(p19Record.stage_status.gates.map(row=>row.status),['PASS_SCOPED','PASS_SCOPED','PASS_SCOPED','PASS_SCOPED','READY']);
assert.equal(latestP19.camera.status,'PARTIAL');assert.equal(latestP19.other_hosts[0].status,'PARTIAL');
assert.equal(data.completedP19Refresh.camera_status,'PASS_SCOPED');
assert.equal(data.completedP19CameraRefresh.original_qualification_receipt_changed,false);
assert.equal(sha(p19SourceBytes),'1e25d0e5605887c58dcd762c0b435f601c77098be43d40b8bed379ae5086a26b','The prior qualification receipt must remain byte-identical');
const cameraResults=completedFor('P19').filter(result=>result.id==='historical-camera-two-cycle-scoped');
assert.equal(cameraResults.length,1);assert.equal(cameraResults[0].status,'PASS_SCOPED');
assert.equal(cameraResults[0].date,cameraScope.test_date);assert.ok(cameraResults[0].title.includes('33 PASS／0 FAIL'));
assert.equal(p19Record.stage_status.as_of,latestP19.plan_update.stage_status.as_of,'Old camera evidence does not change the latest qualification completion date');
for(const field of ['qualification_credit','formal_credit','full_gate_credit'])assert.equal(cameraScope[field],0);
assert.equal(cameraScope.new_test_execution,'NOT_RUN');
assert.ok(!p19Record.stage_status.remaining.some(text=>text.includes('摄像头二次入会独立专项仍PARTIAL')));
assert.equal(latestP19.validation.qualification_credit,0);assert.equal(latestP19.validation.formal_credit,0);
assert.equal(latestP19.validation.historical_crash_review,'NOT_REVIEWED');
assert.equal(latestP19.formal,'NOT_RUN');assert.equal(latestP19.thresholds_changed,false);
assert.deepEqual(latestP19.exceptions,[]);
assert.ok(completedFor('P19').some(result=>result.id==='current-local-b14-three-pilots'&&result.status==='READY'));
assert.ok(!completedFor('P19').some(result=>result.id==='historical-b14-three-pilots'));
const qualificationCycleSnapshot=completedFormal.history_replacements.find(row=>row.path==='data/b14-100-cycle-summary.json');
assert.equal(qualificationCycleSnapshot.sha256,latestP19.preserved.b14_cycle_summary_sha256);
assert.equal(sha(await fs.readFile(path.resolve(dest,'../../out/acceptance-history-20261021-latest-only',qualificationCycleSnapshot.snapshot))),latestP19.preserved.b14_cycle_summary_sha256);
const currentP19Report=JSON.parse(await fs.readFile(safePath('reports/b14/b14-full-standard-20261020-01.json'),'utf8'));
assert.equal(currentP19Report.status,'READY');assert.equal(currentP19Report.qualification_passes,3);
assert.equal(currentP19Report.controller_id,latestP19.controller_id);assert.equal(currentP19Report.formal,'FAILED');assert.equal(currentP19Report.latest_attempt.run_id,cycleSummary.run_id);assert.equal(currentP19Report.latest_attempt.verdict,'FAIL');
assert.equal(currentP19Report.completed_source,data.completedP19Refresh.source);
assert.equal(currentP19Report.completed_source_sha256,data.completedP19Refresh.sha256);
assert.equal(currentP19Report.camera.status,'PASS_SCOPED');
assert.equal(currentP19Report.camera.source,data.completedP19CameraRefresh.source);
checks.current_local_p19_three_pilots_scoped_ready_without_formal_credit=true;
checks.p19_camera_original_33_passes_separate_from_qualification_and_unmeasured_scope=true;
const b14CardMarkup=structure.slice(structure.indexOf('id="highlight-b14"'),structure.indexOf('</article>',structure.indexOf('id="highlight-b14"')));
assert.ok(b14CardMarkup.includes('UIA 全程')&&b14CardMarkup.includes('产品进程存活')&&b14CardMarkup.includes('28824.411051')&&b14CardMarkup.includes('28820.990211'),'B14 card must distinguish UIA duration and product process live seconds');
assert.ok(!b14CardMarkup.includes('共享计划保持60秒，日志OFF/ON计划每侧35秒；本次共享观测后端为dxgi。'),'B14 procedure must not repeat share/log/backend parameters twice');
const historyHTML=actual.elements.get('history-body').innerHTML;
assert.ok(historyHTML.includes('原始机器判定')&&historyHTML.includes('href="#highlight-b14"')&&historyHTML.includes('href="#retest-T020"')&&historyHTML.includes('href="data/b14-user-disposition-20261023.json"'),'H181 must cross-reference raw FAIL and current user_pass disposition');
assert.ok(historyHTML.includes('100 轮（PASS）')&&!historyHTML.includes('PASS: 100 轮'),'H181 status-count object must be formatted as 100 轮（PASS）');
assert.ok(!structure.includes('。；')&&!historyHTML.includes('。；'),'Display-time joins in static structure and history table must not produce duplicate punctuation 。；');
assert.ok(!structure.includes('（原来源缺失，见封存摘要）')&&!script.includes('（原来源缺失，见封存摘要）'),'Missing-source prompt must be unified');
assert.ok(environmentTable.indexOf('id="env-b14-formal-20261023"')<environmentTable.indexOf('id="env-b14-retry07"'),'Latest B14 Formal environment must precede historical retry07 within the B14 theme');
for(const tag of ['最新完成运行','历史同口径归档','历史保留（独立负载）','基准日工具门'])assert.ok(environmentTable.includes(tag),'Environment overview must distinguish recency and workload boundaries: '+tag);
for(const record of data.retestRecords){
  const markup=vm.runInContext('recordMarkup('+JSON.stringify(record)+',"retest")',actual.context);
  const boundarySection=markup.match(/<div class="boundary"><b>边界：<\/b><ul class="coverage-list">([\s\S]*?)<\/ul><\/div>/)?.[1]||'';
  if(record.boundaries.length>1)assert.equal((boundarySection.match(/<li>/g)||[]).length,record.boundaries.length,'Boundary items must render as separate list items without splitting on semicolons: '+record.plan_code);
}
const p21Markup=vm.runInContext('recordMarkup(D.retestRecords.find(r=>r.plan_code==="P21"),"retest")',actual.context);
assert.ok(p21Markup.includes('href="data/completed-evidence/theme-restart04-20261021-scoped.json"')&&!p21Markup.includes('href="reports/product/theme-settings-20261016.html"'),'Boundary prose must link registered package sources only');
checks.ten_presentation_optimizations_verified=true;
const manifestPath=path.join(dest,'evidence-manifest.json');
Object.assign(checks,await validateReportLayout(dest,{verifyMigration:process.argv.includes('--verify-migration')}));
if(await fileExists(manifestPath)){
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const outputPaths=new Set(manifest.outputs.map(entry=>entry.path));
  assert.equal(outputPaths.size,manifest.outputs.length,'Duplicate package manifest entries');
  for(const name of ['index.html','README.md','reports/index.html','data/report-catalog.json','data/report-migrations.json','data/report-data.json','data/report-input.json','data/test-plan.json','scripts/consolidate-tests.mjs','scripts/validate.mjs','scripts/report-catalog.mjs','scripts/validate-report-layout.mjs','assets/report.js','assets/report-style.css'])assert.ok(outputPaths.has(name),'Required output missing from manifest: '+name);
  let verifiedOutputs=0,decoupledOutputs=0,normalizedTextOutputs=0;
  for(const entry of manifest.outputs){
    assert.ok(!/(^|\/)\.git(?:\/|$)/i.test(entry.path),'Git internals leaked into package manifest: '+entry.path);
    const full=safePath(entry.path);
    if(await fileExists(full)){
      const b=await fs.readFile(full);
      if(!isFull&&entry.text_lf_sha256&&sha(b)!==entry.sha256){
        assert.ok(/^(?:assets\/|data\/|scripts\/)|^reports\/.*\.html$|^(?:index\.html|README\.md|package-info\.json|validation\.json|\.gitignore)$/.test(entry.path),'Text normalization outside report outputs');
        const lf=Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'));
        assert.equal(sha(lf),entry.text_lf_sha256,'Package LF text hash '+entry.path);
        assert.equal(lf.length,entry.text_lf_bytes);
        normalizedTextOutputs++;
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
  checks.report_text_checkout_line_endings=normalizedTextOutputs;
  checks.manifest_excludes_git_internals=true;
  const validation={status:isFull?'PASS_STATIC_FULL':'PASS_STATIC_LIGHTWEIGHT',checked_at:new Date().toISOString(),validation_mode:isFull?'FULL_OFFLINE':'LIGHTWEIGHT_REPO',method:'Node vm structure/synthetic DOM, relative links, lightweight report data consistency; heavy offline evidence decoupled',checks,counts:{...data.curationSummary,highlights:data.highlights.length},source_availability:data.packageAvailability,visual_rendering:'NOT_RUN',product_build_runtime:'NOT_RUN; documentation revision only',live_product_acceptance:'NOT_RUN; frozen package verification grants no current product PASS',evidence_baseline:data.meta.evidenceBaselineAt};
  await fs.writeFile(path.join(dest,'validation.json'),JSON.stringify(validation,null,2));
  const vb=await fs.readFile(path.join(dest,'validation.json'));const vlf=Buffer.from(vb.toString('utf8').replace(/\r\n/g,'\n'));manifest.outputs=manifest.outputs.filter(x=>x.path!=='validation.json');manifest.outputs.push({path:'validation.json',sha256:sha(vb),bytes:vb.length,text_lf_sha256:sha(vlf),text_lf_bytes:vlf.length});await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(validation,null,2));
}
