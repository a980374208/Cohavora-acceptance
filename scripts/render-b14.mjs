const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false}):v==null?'未提供':String(v);
const limit=v=>v==null?'原结果未给出数值门限':typeof v==='number'?(v===0?'=0':'≤'+num(v)):String(v);

export function renderB14Procedure(highlight,summary){
  if(highlight.id!=='highlight-b14')return '';
  const process=summary.process,params=summary.procedure_parameters;
  return '<div class="b14-procedure"><h4>同一进程八小时／一百轮固定操作</h4><p>同一个产品进程连续运行八小时，重复执行100轮会议生命周期操作。产品PID为 <b>'+esc(process.pid)+'</b>，关闭前实际存活 <b>'+esc(num(process.product_live_seconds_before_close))+' 秒</b>，达到28800秒要求；全部100轮使用同一启动身份。</p><ol>'+params.steps_supported_by_final_evidence.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol><p class="note">每轮阶段依据同次运行的冻结计划和32类最终检查归纳。共享计划保持60秒，日志OFF/ON计划每侧35秒；本次共享观测后端为DXGI。原执行脚本现有副本的指纹与冻结记录不同，未补造未封存的具体点击时序、画质切换或故障重连动作。</p></div>';
}

function statisticRows(rows,total){
  return rows.map(row=>'<tr><th scope="row">'+esc(row.name)+(row.note?'<small class="stat-note">'+esc(row.note)+'</small>':'')+'</th><td>'+esc(row.n+'/'+total)+'</td><td><strong>'+esc(num(row.mean))+'</strong></td><td>'+esc(num(row.p50))+'</td><td>'+esc(num(row.p95))+'</td><td>'+esc(num(row.max))+'</td><td>'+esc(row.unit)+'</td><td>'+esc(limit(row.original_limit))+'</td></tr>').join('');
}

function statisticTable(rows,total){
  return '<div class="table-wrap"><table class="b14-statistics"><thead><tr><th>指标</th><th>有效样本／轮</th><th>平均值</th><th>P50</th><th>P95</th><th>最大值</th><th>单位</th><th>原门限／条件</th></tr></thead><tbody>'+statisticRows(rows,total)+'</tbody></table></div>';
}

function renderTimingAvailability(summary,timing){
  const reasons=new Map(timing.availability_reasons.map(reason=>[reason.id,reason]));
  const rows=summary.first_frame_and_action_timing.map(row=>{
    const reason=reasons.get(row.availability_reason);
    const samples=row.availability_reason==='NOT_TRIGGERED'?'不适用（重连0次）':row.availability_reason==='DEFINITION_PENDING'?'未形成同口径样本':row.n+'/'+summary.cycle_count;
    const definition=row.definition_id?'<br><a href="#timing-definition-'+esc(row.definition_id)+'">查看后续统一口径</a>':'';
    return '<tr data-timing-id="'+esc(row.id)+'" data-availability-reason="'+esc(row.availability_reason)+'"><th scope="row">'+esc(row.name)+'</th><td><span class="timing-state" data-reason="'+esc(reason.id)+'">'+esc(reason.label)+'</span></td><td>'+esc(samples)+'</td><td>'+esc(row.reason)+definition+'</td></tr>';
  }).join('');
  const legend=timing.availability_reasons.map(reason=>'<li><b>'+esc(reason.label)+'：</b>'+esc(reason.description)+'</li>').join('');
  return '<p class="boundary"><b>历史计时数据：区分未触发、未留存和口径待明确。</b>下表描述本次100轮运行保留的数据，缺失项不计算平均值、P50、P95或最大值，也不记作0毫秒。“口径待明确”指旧运行的测量边界；<a href="#timing-measurement-definitions">后续三项操作口径</a>已在本次修订中明确，尚无按新口径取得的实测结果。</p><ul class="timing-legend">'+legend+'</ul><div class="table-wrap"><table class="timing-availability"><thead><tr><th>指标</th><th>数据状态</th><th>样本情况</th><th>原因与适用范围</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="note">原结果未给出这组耗时的数值门限；缺少门限不妨碍记录耗时。当前仅明确后续采集口径，历史数值保持UNKNOWN，原Formal FAIL不变。</p>';
}

export function renderTimingDefinitions(timing){
  const rows=timing.definitions.map(definition=>'<tr id="timing-definition-'+esc(definition.id)+'"><th scope="row">'+esc(definition.name)+'<small class="stat-note">采集状态：'+esc(definition.collection_status)+'</small></th><td>'+esc(definition.start)+'</td><td>'+esc(definition.end)+'</td></tr>').join('');
  const rules=timing.definitions.map(definition=>'<h4>'+esc(definition.name)+'</h4><ul>'+definition.rules.map(rule=>'<li>'+esc(rule)+'</li>').join('')+'</ul><p><b>逐次证据：</b>'+esc(definition.evidence.join('；'))+'</p>').join('');
  return '<section class="timing-definitions" id="timing-measurement-definitions"><h3>三项操作计时边界</h3><p>口径版本 <code>'+esc(timing.definition_version)+'</code>。'+esc(timing.applicability)+'。本次只明确边界与留存要求，采集验证为NOT_RUN；未给旧运行回填耗时或新增独立验收项。统一维护于 <a href="data/test-plan.json">test-plan.json</a>。</p><div class="table-wrap"><table class="timing-contracts"><thead><tr><th>指标</th><th>计时起点</th><th>计时终点</th></tr></thead><tbody>'+rows+'</tbody></table></div><details><summary>采集、统计与逐次证据规则</summary><ul>'+timing.collection_policy.map(rule=>'<li>'+esc(rule)+'</li>').join('')+'</ul>'+rules+'</details></section>';
}

export function renderB14Measured(highlight,summary,timing){
  if(highlight.id!=='highlight-b14')return '';
  const failure=highlight.failureAnalysis;
  return '<div class="b14-failure"><h4>'+esc(failure.title)+'</h4><p><b>'+esc(failure.summary)+'</b></p><p>'+esc(failure.explanation)+'</p><p><b>'+esc(failure.conclusion)+'</b></p><p class="note">'+esc(failure.basis)+'。'+esc(failure.details)+' <a href="'+esc(failure.receipt)+'">当前定位说明</a></p></div><div id="b14-cycle-statistics"><h4>100轮首帧与操作耗时</h4>'+renderTimingAvailability(summary,timing)+'<h4>100轮其他重要实测指标</h4><p class="note">本次B14未保留常态／会议状态的绝对平均内存占用采样。<a href="#memory-usage">内存占用区</a>列出数据可用性与另一独立B11会议样本；没有将该样本拼入B14。</p><p>下表对同一run的100个逐轮数值等权统计：平均值为总和除以100；P50、P95采用最近秩法（排序后第ceil(p×100)项）。每轮最大值的分位数只描述这100个最大值，逐轮P95分桶上界的分位数也保留原有语义。所有结果均未混入其他运行。</p>'+statisticTable(summary.metrics,summary.cycle_count)+'<p class="note">日志CPU负增量按测量波动解释；日志窗口的CPU均值不代表全八小时平均CPU。停止共享后的逐轮Private Bytes增量也不同于正式门使用的首末各十个room-release窗口中位数差。本统计不改变Formal FAIL。</p><details><summary>100轮聚合方法、字段与结果数据</summary><p><a href="data/b14-100-cycle-summary.json">包内100轮实测汇总JSON</a></p><ul class="sources">'+summary.metrics.map(row=>'<li><b>'+esc(row.name)+'</b><br><code>'+esc(row.source_field)+'</code></li>').join('')+'</ul></details></div>';
}
