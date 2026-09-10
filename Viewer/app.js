(() => {
'use strict';

const ENTITY_KINDS=['project','module','class','function','method','parameter','variable','field','type','external'];
const RELATION_KINDS=['contains','imports','inherits','calls','reads','writes','accepts','returns','uses_type','decorated_by'];
const COLORS={project:'#d0a85c',module:'#477d9b',class:'#7060a8',function:'#477c61',method:'#3f7b7b',parameter:'#696b8b',variable:'#686d7a',field:'#8a7350',type:'#9b5368',external:'#596273'};
const SOCKET_COLORS={contains:'#8593a5',imports:'#55a6d9',inherits:'#a88ee8',calls:'#66c49a',reads:'#70b5df',writes:'#df7185',accepts:'#79cfd0',returns:'#e4b96c',uses_type:'#df995c',decorated_by:'#bd8fe2',dependency:'#63a6ca'};
const $=id=>document.getElementById(id);
const els={
 fileInput:$('fileInput'),projectMeta:$('projectMeta'),canvas:$('graphCanvas'),graphPanel:$('graphPanel'),emptyState:$('emptyState'),dropOverlay:$('dropOverlay'),graphStatus:$('graphStatus'),legend:$('legend'),
 projectionButtons:$('projectionButtons'),searchInput:$('searchInput'),searchResults:$('searchResults'),scopeSelect:$('scopeSelect'),depthInput:$('depthInput'),depthOutput:$('depthOutput'),limitInput:$('limitInput'),
 entityFilters:$('entityFilters'),relationFilters:$('relationFilters'),selectAllFilters:$('selectAllFilters'),selectionEmpty:$('selectionEmpty'),selectionDetails:$('selectionDetails'),entityKind:$('entityKind'),entityName:$('entityName'),entityQualified:$('entityQualified'),entityMeta:$('entityMeta'),focusBtn:$('focusBtn'),moduleBtn:$('moduleBtn'),relationList:$('relationList'),relationCountBadge:$('relationCountBadge'),relationHeading:$('relationHeading'),fitBtn:$('fitBtn'),resetBtn:$('resetBtn'),backBtn:$('backBtn'),breadcrumb:$('breadcrumb')
};

const state={graph:null,entityById:new Map(),outgoing:new Map(),incoming:new Map(),children:new Map(),moduleOf:new Map(),projection:'architecture',scope:'overview',depth:1,limit:180,selectedId:null,contextId:null,selectedModuleId:null,entityKinds:new Set(['project','module','class','function','method','field','type','external']),relationKinds:new Set(RELATION_KINDS),viewNodes:[],viewEdges:[],nodeMap:new Map(),camera:{x:0,y:0,scale:1},interaction:null,hoverId:null,dpr:window.devicePixelRatio||1,expandedGroups:new Set(),hierarchyFrames:[],navigationHistory:[],restoringHistory:false};

function validateGraph(data){if(!data||typeof data!=='object')throw Error('JSON root must be an object.');if(!Array.isArray(data.entities)||!Array.isArray(data.relations))throw Error('Expected entities[] and relations[].');if(!String(data.schema||'').startsWith('pycodegraph/'))throw Error(`Unsupported schema: ${data.schema||'missing'}`);}
function loadGraph(data,label='artifact'){
 validateGraph(data);state.graph=data;state.entityById=new Map(data.entities.map(e=>[e.id,e]));state.outgoing=new Map();state.incoming=new Map();state.children=new Map();state.moduleOf=new Map();
 for(const r of data.relations){pushMap(state.outgoing,r.source,r);pushMap(state.incoming,r.target,r);if(r.kind==='contains')pushMap(state.children,r.source,r.target);}
 for(const e of data.entities)state.moduleOf.set(e.id,findModuleId(e.id));
 const name=data.project?.name||data.entities.find(e=>e.kind==='project')?.name||label;els.projectMeta.textContent=`${name} · ${data.entities.length.toLocaleString()} entities · ${data.relations.length.toLocaleString()} relations · ${data.schema}`;els.emptyState.style.display='none';
 state.selectedId=null;state.contextId=null;state.selectedModuleId=null;state.navigationHistory=[];buildFilters();selectProjection('architecture');updateSelectionPanel();
}
function pushMap(map,key,v){if(!map.has(key))map.set(key,[]);map.get(key).push(v);}
function findModuleId(id){let e=state.entityById.get(id),guard=0;while(e&&guard++<60){if(e.kind==='module')return e.id;e=e.parent?state.entityById.get(e.parent):null;}return null;}

function buildFilters(){els.entityFilters.innerHTML='';els.relationFilters.innerHTML='';for(const k of ENTITY_KINDS)els.entityFilters.appendChild(filterCheckbox(k,'entity',state.entityKinds.has(k)));for(const k of RELATION_KINDS)els.relationFilters.appendChild(filterCheckbox(k,'relation',state.relationKinds.has(k)));}
function filterCheckbox(kind,group,checked){const l=document.createElement('label');l.className='filter-item';const cb=document.createElement('input');cb.type='checkbox';cb.checked=checked;cb.addEventListener('change',()=>{const s=group==='entity'?state.entityKinds:state.relationKinds;cb.checked?s.add(kind):s.delete(kind);rebuildProjection();});const t=document.createElement('span');t.textContent=kind;l.append(cb,t);return l;}
function navigationSnapshot(){const contextId=state.contextId;const inNeighborhood=state.projection==='neighborhood'&&contextId;const selectedId=inNeighborhood?contextId:state.selectedId;const selectedModuleId=inNeighborhood?(state.moduleOf.get(contextId)||state.selectedModuleId):state.selectedModuleId;return{projection:state.projection,scope:state.scope,selectedId,contextId,selectedModuleId,camera:{...state.camera}};}
function pushNavigationHistory(){
 if(!state.graph||state.restoringHistory)return;
 const snap=navigationSnapshot(),prev=state.navigationHistory[state.navigationHistory.length-1];
 if(prev&&prev.projection===snap.projection&&prev.scope===snap.scope&&prev.selectedId===snap.selectedId&&prev.contextId===snap.contextId&&prev.selectedModuleId===snap.selectedModuleId)return;
 state.navigationHistory.push(snap);
 if(state.navigationHistory.length>40)state.navigationHistory.splice(0,state.navigationHistory.length-40);
 updateNavigationUI();
}
function restoreNavigationSnapshot(snap){
 if(!snap||!state.graph)return;
 state.restoringHistory=true;
 state.projection=snap.projection;state.scope=snap.scope;state.selectedId=snap.selectedId;state.contextId=snap.contextId??snap.selectedId;state.selectedModuleId=snap.selectedModuleId;
 els.scopeSelect.value=state.scope;
 els.projectionButtons.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.projection===state.projection));
 rebuildProjection();
 state.camera={...snap.camera};
 updateSelectionPanel();updateNavigationUI();draw();
 state.restoringHistory=false;
}
function goBack(){const snap=state.navigationHistory.pop();if(snap)restoreNavigationSnapshot(snap);else updateNavigationUI();}
function entityPath(id){
 const out=[],seen=new Set();let e=id?state.entityById.get(id):null;
 while(e&&!seen.has(e.id)&&out.length<12){seen.add(e.id);if(!['project','parameter','variable','field'].includes(e.kind))out.push(e);e=e.parent?state.entityById.get(e.parent):null;}
 return out.reverse();
}
function updateNavigationUI(){
 if(!els.backBtn||!els.breadcrumb)return;
 els.backBtn.disabled=!state.navigationHistory.length;
 const labels={architecture:'Architecture',structure:'Structure',classes:'Classes',types:'Types',calls:'Call graph',neighborhood:'Neighborhood',custom:'Custom'};
 let parts=[];
 if(state.projection==='structure'&&state.selectedModuleId){const m=state.entityById.get(state.selectedModuleId);if(m)parts=[m.qualified_name||m.name];}
 else if(state.projection==='neighborhood'&&(state.contextId||state.selectedId)){parts=entityPath(state.contextId||state.selectedId).map(e=>e.name||e.qualified_name||e.id);}
 else if(state.scope==='selection'&&state.selectedId){parts=entityPath(state.selectedId).map(e=>e.name||e.qualified_name||e.id);}
 if(!parts.length)parts=[labels[state.projection]||state.projection];
 els.breadcrumb.innerHTML=parts.map((p,i)=>`${i?'<span class="breadcrumb-sep">›</span>':''}<span class="breadcrumb-part">${esc(p)}</span>`).join('');
}
function selectProjection(name){state.projection=name;els.projectionButtons.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.projection===name));if(name==='architecture'){state.scope='overview';els.scopeSelect.value='overview';}if(name==='neighborhood'&&!state.contextId){const e=state.selectedId?state.entityById.get(state.selectedId):(state.graph?.entities.find(x=>x.kind==='module')||state.graph?.entities[0]);if(e){state.contextId=e.id;if(!state.selectedId)state.selectedId=e.id;}}rebuildProjection();updateNavigationUI();}
function rebuildProjection(){if(!state.graph)return;const p=buildProjection(state.projection);state.viewNodes=p.nodes.map(makeVisualNode);state.viewEdges=p.edges.map((e,i)=>({...e,_key:`${e.source}|${e.target}|${e.kind}|${i}`}));state.nodeMap=new Map(state.viewNodes.map(n=>[n.id,n]));attachPorts();layoutGraph();fitToView();updateLegend();updateStatus();draw();}

function buildProjection(k){if(k==='architecture')return architectureProjection();if(k==='structure')return structureProjection();if(k==='classes')return classProjection();if(k==='types')return relationProjection(new Set(['class','type','external']),new Set(['inherits','uses_type']));if(k==='calls')return relationProjection(new Set(['class','function','method','external']),new Set(['calls']));if(k==='neighborhood')return neighborhoodProjection();return customProjection();}
function architectureProjection(){const modules=state.graph.entities.filter(e=>e.kind==='module'&&state.entityKinds.has('module'));const ms=new Set(modules.map(e=>e.id)),agg=new Map(),allowed=new Set(['imports','calls','uses_type','inherits']);for(const r of state.graph.relations){if(!allowed.has(r.kind)||!state.relationKinds.has(r.kind))continue;const a=state.moduleOf.get(r.source),b=state.moduleOf.get(r.target);if(!a||!b||a===b||!ms.has(a)||!ms.has(b))continue;const key=a+'\0'+b;let e=agg.get(key)||{source:a,target:b,kind:'dependency',count:0,kinds:{}};e.count++;e.kinds[r.kind]=(e.kinds[r.kind]||0)+1;agg.set(key,e);}return{nodes:modules,edges:[...agg.values()]};}
function enclosingClassId(id){
 let e=state.entityById.get(id),guard=0;
 while(e&&guard++<60){if(e.kind==='class')return e.id;e=e.parent?state.entityById.get(e.parent):null;}
 return null;
}
function classProjection(){
 const classes=state.graph.entities.filter(e=>e.kind==='class'&&state.entityKinds.has('class'));
 const classIds=new Set(classes.map(e=>e.id)),allowed=new Set(['inherits','uses_type','calls','reads','writes']),agg=new Map();
 for(const r of state.graph.relations){
  if(!allowed.has(r.kind)||!state.relationKinds.has(r.kind))continue;
  const a=enclosingClassId(r.source),b=enclosingClassId(r.target);
  if(!a||!b||a===b||!classIds.has(a)||!classIds.has(b))continue;
  const key=`${a}\0${b}\0${r.kind}`;
  let edge=agg.get(key);if(!edge){edge={source:a,target:b,kind:r.kind,count:0,attributes:{class_projection:true}};agg.set(key,edge);}
  edge.count+=r.count||1;
 }
 return{nodes:classes,edges:[...agg.values()]};
}
function hasMeaningfulStructureSignature(e){
 if(!['function','method'].includes(e.kind))return false;
 const params=(state.children.get(e.id)||[]).map(id=>state.entityById.get(id)).filter(x=>x?.kind==='parameter'&&!['self','cls'].includes(x.name));
 if(params.length)return true;
 const declared=e.attributes?.returns;
 if(declared&&declared!=='None')return true;
 return e.attributes?.return_status==='value';
}
function structureProjection(){let mid=state.selectedModuleId;if(!mid&&state.selectedId)mid=state.moduleOf.get(state.selectedId);if(!mid)mid=state.graph.entities.find(e=>e.kind==='module')?.id;if(!mid)return{nodes:[],edges:[]};state.selectedModuleId=mid;const ids=new Set([mid]),q=[{id:mid,d:0}],max=Math.max(1,state.depth+1);while(q.length&&ids.size<state.limit){const {id,d}=q.shift();if(d>=max)continue;for(const c of state.children.get(id)||[]){const e=state.entityById.get(c);if(!e||!state.entityKinds.has(e.kind)||['parameter','variable'].includes(e.kind))continue;if(!ids.has(c)){ids.add(c);q.push({id:c,d:d+1});if(ids.size>=state.limit)break;}}}let edges=state.graph.relations.filter(r=>r.kind!=='contains'&&state.relationKinds.has(r.kind)&&ids.has(r.source)&&ids.has(r.target)&&!(r.kind==='reads'&&r.attributes?.role==='parameter'));
 /* Leaf members that only exist because CONTAINS was indexed add large empty grids to class frames. Keep them only when they participate in a visible semantic relation or expose a useful callable signature. */
 const incident=new Set();for(const r of edges){incident.add(r.source);incident.add(r.target);}
 for(const id of [...ids]){const e=state.entityById.get(id);if(!e||id===mid||e.kind==='class')continue;if(e.kind==='field'&&!incident.has(id))ids.delete(id);else if(['method','function'].includes(e.kind)&&!incident.has(id)&&!hasMeaningfulStructureSignature(e))ids.delete(id);}
 edges=edges.filter(r=>ids.has(r.source)&&ids.has(r.target));
 /* A module is useful as a node only when it participates in a visible semantic relation (not merely CONTAINS). Otherwise the selected module is already the context of this view and a disconnected module box is misleading. */if(ids.size>1&&!edges.some(r=>r.source===mid||r.target===mid))ids.delete(mid);edges=edges.filter(r=>ids.has(r.source)&&ids.has(r.target));return{nodes:[...ids].map(id=>state.entityById.get(id)).filter(Boolean),edges};}
function relationProjection(kinds,rels){const ak=new Set([...kinds].filter(k=>state.entityKinds.has(k))),ar=new Set([...rels].filter(k=>state.relationKinds.has(k)));let ids=new Set();if(state.scope==='module'&&state.selectedModuleId){for(const e of state.graph.entities)if(state.moduleOf.get(e.id)===state.selectedModuleId&&ak.has(e.kind))ids.add(e.id);}else if(state.scope==='selection'&&state.selectedId)return neighborhoodProjection(ak,ar);else{const degree=new Map();for(const r of state.graph.relations)if(ar.has(r.kind)){const a=state.entityById.get(r.source),b=state.entityById.get(r.target);if(!a||!b||!ak.has(a.kind)||!ak.has(b.kind))continue;degree.set(a.id,(degree.get(a.id)||0)+1);degree.set(b.id,(degree.get(b.id)||0)+1);}[...degree.entries()].sort((a,b)=>b[1]-a[1]).slice(0,state.limit).forEach(([id])=>ids.add(id));}const edges=state.graph.relations.filter(r=>ar.has(r.kind)&&ids.has(r.source)&&ids.has(r.target));return{nodes:[...ids].map(id=>state.entityById.get(id)).filter(Boolean),edges};}
function neighborhoodProjection(kindOverride=null,relOverride=null){const rootId=state.contextId||state.selectedId;if(!rootId)return{nodes:[],edges:[]};const kinds=kindOverride||state.entityKinds,rels=relOverride||state.relationKinds,hiddenStructural=new Set(['contains','accepts','returns']),ids=new Set([rootId]);let front=new Set([rootId]);for(let d=0;d<state.depth&&ids.size<state.limit;d++){const next=new Set();for(const id of front){for(const r of [...(state.outgoing.get(id)||[]),...(state.incoming.get(id)||[])]){if(!rels.has(r.kind)||hiddenStructural.has(r.kind))continue;const other=r.source===id?r.target:r.source,e=state.entityById.get(other);if(!e||!kinds.has(e.kind))continue;if(!ids.has(other)){ids.add(other);next.add(other);if(ids.size>=state.limit)break;}}}front=next;if(!front.size)break;}const edges=state.graph.relations.filter(r=>rels.has(r.kind)&&!hiddenStructural.has(r.kind)&&ids.has(r.source)&&ids.has(r.target));return{nodes:[...ids].map(id=>state.entityById.get(id)).filter(Boolean),edges};}
function customProjection(){if(state.scope==='selection'&&state.selectedId)return neighborhoodProjection();let ids=new Set();if(state.scope==='module'&&state.selectedModuleId){for(const e of state.graph.entities)if(state.moduleOf.get(e.id)===state.selectedModuleId&&state.entityKinds.has(e.kind)&&!['parameter','variable'].includes(e.kind))ids.add(e.id);}else{const deg=new Map();for(const r of state.graph.relations)if(state.relationKinds.has(r.kind)){for(const id of [r.source,r.target]){const e=state.entityById.get(id);if(e&&state.entityKinds.has(e.kind)&&!['parameter','variable'].includes(e.kind))deg.set(id,(deg.get(id)||0)+1);}}[...deg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,state.limit).forEach(([id])=>ids.add(id));}const edges=state.graph.relations.filter(r=>state.relationKinds.has(r.kind)&&ids.has(r.source)&&ids.has(r.target));return{nodes:[...ids].map(id=>state.entityById.get(id)).filter(Boolean),edges};}

function entityDisplayName(e){if(!e)return'';return e.kind==='external'?(e.qualified_name||e.name||e.id):(e.name||e.qualified_name||e.id);}
function makeVisualNode(e){return{...e,name:entityDisplayName(e),x:0,y:0,w:240,h:80,inputPorts:[],outputPorts:[],relationGroups:[],rows:[],portMap:new Map(),_manual:false};}
function intrinsicParameters(n){if(!['function','method'].includes(n.kind))return[];return (state.children.get(n.id)||[]).map(id=>state.entityById.get(id)).filter(e=>e?.kind==='parameter').sort(sourceOrder).map(e=>({label:e.name,type:e.attributes?.annotation||'?',entityId:e.id}));}
function intrinsicOutputs(n){return[];}
function returnSummary(n){if(!['function','method'].includes(n.kind))return null;const declared=n.attributes?.returns,status=n.attributes?.return_status;if(declared)return `returns : ${declared}`;if(status==='value')return 'returns value : ?';if(status==='none')return 'returns : None';if(status==='implicit_none')return 'returns : None (implicit)';return 'returns : ?';}
function sourceOrder(a,b){const A=a.span||{},B=b.span||{};return(A.start_line||0)-(B.start_line||0)||(A.start_col||0)-(B.start_col||0)||(a.name||'').localeCompare(b.name||'');}
function groupKey(id,dir,kind){return `${id}|${dir}|${kind}`;}
function relationLabel(k,dir,count){const incoming=dir==='in';if(k==='dependency')return incoming?`used by · ${count}`:`uses · ${count}`;const base={calls:incoming?'called by':'calls',imports:incoming?'imported by':'imports',inherits:incoming?'base of':'inherits',reads:incoming?'read by':'reads',writes:incoming?'written by':'writes',uses_type:incoming?'used by':'uses type',decorated_by:incoming?'decorates':'decorated by',accepts:incoming?'parameter':'accepts',returns:incoming?'return from':'returns'}[k]||k;return `${base} · ${count}`;}
function relationEndpointId(edge,dir){return dir==='out'?edge.target:edge.source;}
function relationOtherName(edge,dir){const id=relationEndpointId(edge,dir),e=state.entityById.get(id);return e?.name||e?.qualified_name||id;}
function relationBucket(edge){
 const role=edge?.attributes?.role;
 if(edge.kind==='reads'&&role)return `reads:${role}`;
 if(edge.kind==='writes'&&role)return `writes:${role}`;
 return edge.kind;
}
function relationBucketForNode(edge,dir,nodeId){
 if(edge.kind==='calls'){
  const caller=state.entityById.get(edge.source);
  if(caller?.kind==='module')return 'calls:module';
 }
 return relationBucket(edge);
}
function relationGroupLabel(kind,role,dir,count){
 const incoming=dir==='in';
 if(kind==='calls'&&role==='module')return `${incoming?'called at module level':'top-level calls'} · ${count}`;
 if(kind==='reads'){
  if(role==='field')return `${incoming?'state read by':'reads state'} · ${count}`;
  if(role==='global')return `${incoming?'global used by':'uses globals'} · ${count}`;
  if(role==='parameter')return `${incoming?'parameter used by':'uses parameters'} · ${count}`;
  if(role==='local')return `${incoming?'local read by':'reads locals'} · ${count}`;
 }
 if(kind==='writes'){
  if(role==='field')return `${incoming?'state written by':'writes state'} · ${count}`;
  if(role==='global')return `${incoming?'global written by':'writes globals'} · ${count}`;
  if(role==='local')return `${incoming?'local written by':'writes locals'} · ${count}`;
 }
 return relationLabel(kind,dir,count);
}
function aggregateRelationEndpoints(edges,dir){
 const byId=new Map();
 for(const edge of edges){
  const id=relationEndpointId(edge,dir),entity=state.entityById.get(id);
  let item=byId.get(id);
  if(!item){item={id,entity,name:entity?.name||entity?.qualified_name||id,qualified:entity?.qualified_name||'',count:0,edges:[]};byId.set(id,item);}
  item.count+=edge.count||1;item.edges.push(edge);
 }
 const items=[...byId.values()];
 const nameCounts=new Map();for(const item of items)nameCounts.set(item.name,(nameCounts.get(item.name)||0)+1);
 for(const item of items){const base=nameCounts.get(item.name)>1&&item.qualified?item.qualified:item.name;item.label=item.count>1?`${base} ×${item.count}`:base;}
 return items.sort((a,b)=>a.label.localeCompare(b.label));
}
function endpointPortKey(group,endpointId){return `endpoint:${group.key}:${endpointId}`;}
function attachPorts(){
 const incident=new Map();for(const n of state.viewNodes)incident.set(n.id,{in:new Map(),out:new Map()});
 for(const e of state.viewEdges){e._bucket=relationBucket(e);const a=incident.get(e.source),b=incident.get(e.target);if(a)pushMap(a.out,relationBucketForNode(e,'out',e.source),e);if(b)pushMap(b.in,relationBucketForNode(e,'in',e.target),e);}
 for(const n of state.viewNodes){
  n.inputPorts=[];n.outputPorts=[];n.relationGroups=[];n.rows=[];n.portMap=new Map();
  const params=intrinsicParameters(n);
  for(const p of params)n.rows.push({type:'parameter',parameter:p});
  const vouts=intrinsicOutputs(n);
  for(const p of vouts){const row={type:'value',in:null,out:p};n.rows.push(row);p.side='out';p.row=n.rows.length-1;n.portMap.set(p.key,p);n.outputPorts.push(p);}
  const ret=returnSummary(n);if(ret)n.rows.push({type:'meta',label:ret});
  const inc=incident.get(n.id);
  for(const dir of ['in','out'])for(const [bucket,edges] of inc[dir]){
    const kind=edges[0]?.kind||bucket.split(':')[0],role=bucket==='calls:module'?'module':(edges[0]?.attributes?.role||null);
    if(kind==='contains')continue;
    if(['function','method'].includes(n.kind)&&((dir==='in'&&kind==='accepts')||(dir==='out'&&kind==='returns')))continue;
    const key=groupKey(n.id,dir,bucket),expanded=state.expandedGroups.has(key),g={key,dir,kind,role,bucket,count:edges.reduce((a,e)=>a+(e.count||1),0),edges,expanded,endpointPortById:new Map(),endpointEntries:[]};n.relationGroups.push(g);
  }
  n.relationGroups.sort((a,b)=>a.dir.localeCompare(b.dir)||a.kind.localeCompare(b.kind));
  if(n.relationGroups.length&&n.rows.length)n.rows.push({type:'separator'});
  for(const g of n.relationGroups){
    const gp={key:'group:'+g.key,label:relationGroupLabel(g.kind,g.role,g.dir,g.count),kind:g.kind,shape:'diamond',relationGroup:g,side:g.dir,row:n.rows.length};g.port=gp;n.portMap.set(gp.key,gp);(g.dir==='in'?n.inputPorts:n.outputPorts).push(gp);n.rows.push({type:'relation-group',group:g,port:gp});
    if(g.expanded){
      g.endpointEntries=aggregateRelationEndpoints(g.edges,g.dir);
      const shown=g.endpointEntries.slice(0,18);
      for(const entry of shown){const ip={key:endpointPortKey(g,entry.id),label:entry.label,kind:g.kind,shape:'diamond-small',endpointId:entry.id,edges:entry.edges,side:g.dir,row:n.rows.length};g.endpointPortById.set(entry.id,ip);n.portMap.set(ip.key,ip);(g.dir==='in'?n.inputPorts:n.outputPorts).push(ip);n.rows.push({type:'relation-item',group:g,port:ip,endpoint:entry});}
      if(g.endpointEntries.length>shown.length)n.rows.push({type:'more',label:`… ${g.endpointEntries.length-shown.length} more endpoints`});
    }
  }
  if(!n.rows.length)n.rows.push({type:'empty',label:'no exposed interface'});
  n.w=computeNodeWidth(n);n.h=34+n.rows.length*22+10;
 }
 for(const e of state.viewEdges){const s=state.nodeMap.get(e.source),t=state.nodeMap.get(e.target),sourceBucket=relationBucketForNode(e,'out',e.source),targetBucket=relationBucketForNode(e,'in',e.target);const sg=s?.relationGroups.find(g=>g.dir==='out'&&g.bucket===sourceBucket),tg=t?.relationGroups.find(g=>g.dir==='in'&&g.bucket===targetBucket);e.visible=e.kind!=='contains'&&e.kind!=='accepts'&&e.kind!=='returns';e.sourcePort=sg?.expanded?(sg.endpointPortById.get(e.target)||sg.port):sg?.port||null;e.targetPort=tg?.expanded?(tg.endpointPortById.get(e.source)||tg.port):tg?.port||null;}
}
function computeNodeWidth(n){let chars=Math.min(40,Math.max(14,(n.name||'').length));for(const row of n.rows){if(row.type==='parameter'){const p=row.parameter;chars=Math.max(chars,Math.min(40,(p.label||'').length+(p.type?(' : '+p.type).length:0)));}else if(row.type==='value'){for(const p of [row.in,row.out])if(p)chars=Math.max(chars,Math.min(40,(p.label||'').length+(p.type?(' : '+p.type).length:0)));}else if(row.type==='relation-group')chars=Math.max(chars,Math.min(40,row.port.label.length));else if(row.type==='relation-item')chars=Math.max(chars,Math.min(40,row.port.label.length));else if(row.type==='meta')chars=Math.max(chars,Math.min(40,(row.label||'').length));}return Math.max(210,Math.min(360,95+chars*7));}
function layoutGraph(){if(state.projection==='structure'){layoutStructureGraph();return;}const nodes=state.viewNodes,edges=state.viewEdges;if(!nodes.length)return;const {rank,order}=layeredRanks(nodes,edges);const levels=new Map();for(const n of nodes){const r=rank.get(n.id)||0;pushMap(levels,r,n);}for(const [r,list] of levels)list.sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));const ranks=[...levels.keys()].sort((a,b)=>a-b);const rankWidths=new Map();for(const r of ranks)rankWidths.set(r,Math.max(...levels.get(r).map(n=>n.w)));let x=0;const xPos=new Map();for(const r of ranks){xPos.set(r,x);x+=rankWidths.get(r)+190;}for(const r of ranks){const list=levels.get(r);let y=0;for(const n of list){n.x=xPos.get(r);n.y=y;y+=n.h+70;}const total=y-70;for(const n of list)n.y-=total/2;}centerLayout(nodes);}
function hierarchyDepthFrom(id,root){let d=0,e=state.entityById.get(id),guard=0;while(e?.parent&&guard++<50){if(e.parent===root)return d+1;e=state.entityById.get(e.parent);d++;}return null;}
function visibleDescendants(rootId){return state.viewNodes.filter(n=>n.id!==rootId&&isDescendantOf(n.id,rootId));}
function layoutStructureGraph(){
 const nodes=state.viewNodes,edges=state.viewEdges;if(!nodes.length)return;
 /* Compound layout: classes are compact layout blocks.  We first lay out each
    block internally, then lay out the blocks by inter-block semantic edges.
    This keeps frames disjoint without turning the graph into a vertical strip. */
 const visible=new Set(nodes.map(n=>n.id));
 const topClasses=nodes.filter(n=>n.kind==='class'&&!hasVisibleClassAncestor(n.id,visible));
 const owner=new Map();
 for(const n of nodes){let best=null,e=state.entityById.get(n.id),guard=0;while(e&&guard++<50){if(topClasses.some(c=>c.id===e.id)){best=e.id;break;}e=e.parent?state.entityById.get(e.parent):null;}owner.set(n.id,best);}
 const blocks=[];
 const grouped=new Set();
 for(const c of topClasses){const members=nodes.filter(n=>owner.get(n.id)===c.id);if(members.length<2)continue;members.forEach(n=>grouped.add(n.id));const memberIds=new Set(members.map(n=>n.id));const internal=edges.filter(e=>memberIds.has(e.source)&&memberIds.has(e.target));layoutLocalBlock(members,internal);const box=nodeBounds(members);blocks.push({id:'group:'+c.id,classId:c.id,members,w:box.w+96,h:box.h+96,localMinX:box.minX,localMinY:box.minY});}
 for(const n of nodes)if(!grouped.has(n.id))blocks.push({id:'node:'+n.id,node:n,members:[n],w:n.w,h:n.h,localMinX:n.x,localMinY:n.y});
 const blockOf=new Map();for(const b of blocks)for(const n of b.members)blockOf.set(n.id,b.id);
 const metaEdges=[];const seen=new Set();for(const e of edges){const a=blockOf.get(e.source),b=blockOf.get(e.target);if(!a||!b||a===b)continue;const k=a+'\0'+b;if(seen.has(k))continue;seen.add(k);metaEdges.push({source:a,target:b,kind:e.kind});}
 layoutBlocks(blocks,metaEdges);
 for(const b of blocks){if(b.node){b.node.x=b.x;b.node.y=b.y;continue;}const dx=b.x+48-b.localMinX,dy=b.y+48-b.localMinY;for(const n of b.members){n.x+=dx;n.y+=dy;}}
 centerLayout(nodes);
}
function hasVisibleClassAncestor(id,visible){let e=state.entityById.get(id),guard=0;while(e?.parent&&guard++<50){const p=state.entityById.get(e.parent);if(p?.kind==='class'&&visible.has(p.id))return true;e=p;}return false;}
function layoutLocalBlock(nodes,edges){
 if(nodes.length===1){nodes[0].x=0;nodes[0].y=0;return;}
 const connected=new Set();for(const e of edges){connected.add(e.source);connected.add(e.target);}
 const {rank,order}=layeredRanks(nodes,edges),rankCount=new Set(nodes.map(n=>rank.get(n.id)||0)).size;
 if(rankCount<=1||edges.length<Math.max(2,nodes.length*.28)){
   const cols=Math.max(2,Math.min(4,Math.ceil(Math.sqrt(nodes.length))));const colW=[];for(let c=0;c<cols;c++)colW[c]=0;
   nodes.forEach((n,i)=>colW[i%cols]=Math.max(colW[i%cols],n.w));const xPos=[];let x=0;for(let c=0;c<cols;c++){xPos[c]=x;x+=colW[c]+72;}
   const rowY=[];for(let i=0;i<nodes.length;i++){const c=i%cols,r=Math.floor(i/cols);rowY[r]=Math.max(rowY[r]||0,nodes[i].h);}
   const yPos=[];let y=0;for(let r=0;r<rowY.length;r++){yPos[r]=y;y+=rowY[r]+58;}
   nodes.sort((a,b)=>(connected.has(b.id)?1:0)-(connected.has(a.id)?1:0)||sourceOrder(a,b));nodes.forEach((n,i)=>{const c=i%cols,r=Math.floor(i/cols);n.x=xPos[c];n.y=yPos[r];});return;
 }
 const levels=new Map();for(const n of nodes)pushMap(levels,rank.get(n.id)||0,n);for(const list of levels.values())list.sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0)||sourceOrder(a,b));
 const ranks=[...levels.keys()].sort((a,b)=>a-b),widths=new Map();for(const r of ranks)widths.set(r,Math.max(...levels.get(r).map(n=>n.w)));let x=0;const xp=new Map();for(const r of ranks){xp.set(r,x);x+=widths.get(r)+96;}
 for(const r of ranks){let y=0;for(const n of levels.get(r)){n.x=xp.get(r);n.y=y;y+=n.h+58;}}
}
function nodeBounds(nodes){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const n of nodes){minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h);}return{minX,minY,maxX,maxY,w:maxX-minX,h:maxY-minY};}
function layoutBlocks(blocks,edges){
 const pseudo=blocks.map(b=>({id:b.id})),{rank,order}=layeredRanks(pseudo,edges),levels=new Map();for(const b of blocks)pushMap(levels,rank.get(b.id)||0,b);
 for(const list of levels.values())list.sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));const ranks=[...levels.keys()].sort((a,b)=>a-b),widths=new Map();for(const r of ranks)widths.set(r,Math.max(...levels.get(r).map(b=>b.w)));
 let x=0;const xp=new Map();for(const r of ranks){xp.set(r,x);x+=widths.get(r)+150;}
 for(const r of ranks){const list=levels.get(r);let y=0;for(const b of list){b.x=xp.get(r);b.y=y;y+=b.h+110;}const total=Math.max(0,y-110);for(const b of list)b.y-=total/2;}
}
function layeredRanks(nodes,edges){const ids=new Set(nodes.map(n=>n.id)),adj=new Map(nodes.map(n=>[n.id,[]]));for(const e of edges)if(ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target)adj.get(e.source).push(e.target);const comps=tarjan(nodes.map(n=>n.id),adj),ci=new Map();comps.forEach((c,i)=>c.forEach(id=>ci.set(id,i)));const dag=comps.map(()=>new Set()),indeg=comps.map(()=>0);for(const [a,outs] of adj)for(const b of outs){const ca=ci.get(a),cb=ci.get(b);if(ca!==cb&&!dag[ca].has(cb)){dag[ca].add(cb);indeg[cb]++;}}const q=[];indeg.forEach((d,i)=>{if(d===0)q.push(i);});const cr=new Array(comps.length).fill(0);while(q.length){const c=q.shift();for(const d of dag[c]){cr[d]=Math.max(cr[d],cr[c]+1);if(--indeg[d]===0)q.push(d);}}const rank=new Map(),order=new Map();comps.forEach((c,i)=>c.forEach((id,j)=>{rank.set(id,cr[i]);order.set(id,j);}));for(let pass=0;pass<5;pass++){const levels=new Map();for(const id of ids)pushMap(levels,rank.get(id)||0,id);const rev=pass%2===1;const rs=[...levels.keys()].sort((a,b)=>rev?b-a:a-b);for(const r of rs){const list=levels.get(r);list.sort((a,b)=>neighborScore(a,rank,order,adj,rev)-neighborScore(b,rank,order,adj,rev));list.forEach((id,i)=>order.set(id,i));}}return{rank,order};}
function neighborScore(id,rank,order,adj,reverse){const vals=[];if(reverse){for(const t of adj.get(id)||[])if((rank.get(t)||0)!==(rank.get(id)||0))vals.push(order.get(t)||0);}else{for(const [s,outs] of adj)if(outs.includes(id)&&(rank.get(s)||0)!==(rank.get(id)||0))vals.push(order.get(s)||0);}if(!vals.length)return order.get(id)||0;return vals.reduce((a,b)=>a+b,0)/vals.length;}
function tarjan(ids,adj){let idx=0;const stack=[],on=new Set(),index=new Map(),low=new Map(),out=[];function visit(v){index.set(v,idx);low.set(v,idx++);stack.push(v);on.add(v);for(const w of adj.get(v)||[]){if(!index.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(on.has(w))low.set(v,Math.min(low.get(v),index.get(w)));}if(low.get(v)===index.get(v)){const c=[];let w;do{w=stack.pop();on.delete(w);c.push(w);}while(w!==v);out.push(c);}}for(const id of ids)if(!index.has(id))visit(id);return out;}
function centerLayout(nodes){let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const n of nodes){minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x+n.w);minY=Math.min(minY,n.y);maxY=Math.max(maxY,n.y+n.h);}const cx=(minX+maxX)/2,cy=(minY+maxY)/2;for(const n of nodes){n.x-=cx;n.y-=cy;}}

function resizeCanvas(){const r=els.graphPanel.getBoundingClientRect();state.dpr=window.devicePixelRatio||1;els.canvas.width=Math.max(1,Math.floor(r.width*state.dpr));els.canvas.height=Math.max(1,Math.floor(r.height*state.dpr));draw();}
function worldToScreen(x,y){const r=els.graphPanel.getBoundingClientRect();return{x:r.width/2+(x+state.camera.x)*state.camera.scale,y:r.height/2+(y+state.camera.y)*state.camera.scale};}
function screenToWorld(x,y){const r=els.graphPanel.getBoundingClientRect();return{x:(x-r.width/2)/state.camera.scale-state.camera.x,y:(y-r.height/2)/state.camera.scale-state.camera.y};}
function portPos(n,p,side){const row=p?.row??0,y=n.y+34+row*22+11;return{x:side==='in'?n.x:n.x+n.w,y};}
function draw(){const ctx=els.canvas.getContext('2d'),r=els.graphPanel.getBoundingClientRect();ctx.setTransform(state.dpr,0,0,state.dpr,0,0);ctx.clearRect(0,0,r.width,r.height);if(!state.graph)return;drawGrid(ctx,r);drawHierarchyFrames(ctx);drawEdges(ctx);for(const n of state.viewNodes)drawNode(ctx,n);}
function drawGrid(ctx,r){const s=state.camera.scale,step=40*s;if(step<10)return;const ox=(r.width/2+state.camera.x*s)%step,oy=(r.height/2+state.camera.y*s)%step;ctx.strokeStyle='rgba(140,150,160,.055)';ctx.lineWidth=1;ctx.beginPath();for(let x=ox;x<r.width;x+=step){ctx.moveTo(x,0);ctx.lineTo(x,r.height);}for(let y=oy;y<r.height;y+=step){ctx.moveTo(0,y);ctx.lineTo(r.width,y);}ctx.stroke();}
function computeHierarchyFrames(){if(state.projection!=='structure')return[];const frames=[],visible=new Set(state.viewNodes.map(n=>n.id));/* Only top-level visible classes get frames. Nested class frames created confusing overlap; their class nodes still remain visible. */const groups=state.viewNodes.filter(n=>n.kind==='class'&&!hasVisibleClassAncestor(n.id,visible));for(const g of groups){const members=state.viewNodes.filter(n=>n.id===g.id||isDescendantOf(n.id,g.id));if(members.length<2)continue;const b=nodeBounds(members),padX=24,padBottom=24,titleH=26,padTop=38;frames.push({id:g.id,name:g.name,minX:b.minX-padX,minY:b.minY-padTop,maxX:b.maxX+padX,maxY:b.maxY+padBottom,titleH,descendantIds:members.filter(n=>n.id!==g.id).map(n=>n.id)});}frames.sort((a,b)=>a.minY-b.minY||a.minX-b.minX);return frames;}
function drawHierarchyFrames(ctx){state.hierarchyFrames=computeHierarchyFrames();for(const f of state.hierarchyFrames){const p1=worldToScreen(f.minX,f.minY),p2=worldToScreen(f.maxX,f.maxY),w=p2.x-p1.x,h=p2.y-p1.y;if(w<40||h<30)continue;ctx.fillStyle='rgba(80,90,100,.075)';ctx.strokeStyle='rgba(170,185,200,.28)';ctx.lineWidth=Math.max(1,state.camera.scale);roundRect(ctx,p1.x,p1.y,w,h,8*state.camera.scale);ctx.fill();ctx.stroke();const th=f.titleH*state.camera.scale;ctx.fillStyle='rgba(95,110,125,.18)';roundTopRect(ctx,p1.x,p1.y,w,th,8*state.camera.scale);ctx.fill();if(state.camera.scale>.28){ctx.fillStyle='rgba(225,232,238,.78)';ctx.font=`600 ${Math.max(8,10*state.camera.scale)}px ui-sans-serif,system-ui`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(f.name,p1.x+10*state.camera.scale,p1.y+th/2);}}}
function isDescendantOf(id,parent){let e=state.entityById.get(id),guard=0;while(e?.parent&&guard++<50){if(e.parent===parent)return true;e=state.entityById.get(e.parent);}return false;}
function drawEdges(ctx){for(const e of state.viewEdges){if(!e.visible)continue;const a=state.nodeMap.get(e.source),b=state.nodeMap.get(e.target);if(!a||!b||!e.sourcePort||!e.targetPort)continue;const wp1=portPos(a,e.sourcePort,'out'),wp2=portPos(b,e.targetPort,'in'),p1=worldToScreen(wp1.x,wp1.y),p2=worldToScreen(wp2.x,wp2.y),dx=Math.max(55,Math.abs(p2.x-p1.x)*.45);const focused=!!(state.hoverId||state.selectedId),active=e.source===state.hoverId||e.target===state.hoverId||e.source===state.selectedId||e.target===state.selectedId;const dense=state.viewEdges.length>450;ctx.globalAlpha=focused?(active?.88:(dense?.035:.08)):(dense?.10:.34);ctx.strokeStyle=SOCKET_COLORS[e.kind]||'#8794a3';ctx.lineWidth=Math.max(1,Math.min(3,(e.count?1+Math.log2(e.count+1)*.25:1.15)*Math.sqrt(Math.max(.6,state.camera.scale))));ctx.beginPath();ctx.moveTo(p1.x,p1.y);if(p2.x>=p1.x)ctx.bezierCurveTo(p1.x+dx,p1.y,p2.x-dx,p2.y,p2.x,p2.y);else{const bend=Math.max(80,Math.abs(p2.y-p1.y)*.3);ctx.bezierCurveTo(p1.x+dx,p1.y,p1.x+dx,p1.y+bend,(p1.x+p2.x)/2,p1.y+bend);ctx.bezierCurveTo(p2.x-dx,p2.y-bend,p2.x-dx,p2.y,p2.x,p2.y);}ctx.stroke();}ctx.globalAlpha=1;}
function drawNode(ctx,n){const p=worldToScreen(n.x,n.y),w=n.w*state.camera.scale,h=n.h*state.camera.scale;if(w<10||h<8)return;const selected=n.id===state.selectedId,hovered=n.id===state.hoverId;ctx.globalAlpha=state.hoverId&&!hovered&&!selected?.65:1;roundRect(ctx,p.x,p.y,w,h,6*state.camera.scale);ctx.fillStyle='#45484b';ctx.fill();ctx.strokeStyle=selected?'#f0f3f7':hovered?'#bac6d2':'#2a2c2e';ctx.lineWidth=selected?2:1;ctx.stroke();roundTopRect(ctx,p.x,p.y,w,30*state.camera.scale,6*state.camera.scale);ctx.fillStyle=COLORS[n.kind]||'#626b76';ctx.fill();if(state.camera.scale>.28){ctx.fillStyle='#f4f5f6';ctx.font=`600 ${Math.max(8,12*state.camera.scale)}px ui-sans-serif,system-ui`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(trimText(ctx,n.name,w-20*state.camera.scale),p.x+10*state.camera.scale,p.y+15*state.camera.scale);if(state.camera.scale>.55){ctx.fillStyle='rgba(235,240,244,.72)';ctx.font=`${Math.max(7,9*state.camera.scale)}px ui-monospace,monospace`;ctx.textAlign='right';ctx.fillText(n.kind,p.x+w-8*state.camera.scale,p.y+15*state.camera.scale);}}
 for(let i=0;i<n.rows.length;i++){const row=n.rows[i],y=p.y+(34+i*22+11)*state.camera.scale;if(row.type==='parameter'){drawParameterRow(ctx,row.parameter,p.x,y,w);}else if(row.type==='value'){if(row.in)drawValuePort(ctx,row.in,'in',p.x,y,w);if(row.out)drawValuePort(ctx,row.out,'out',p.x,y,w);}else if(row.type==='separator'){ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x+8*state.camera.scale,y);ctx.lineTo(p.x+w-8*state.camera.scale,y);ctx.stroke();}else if(row.type==='relation-group')drawRelationGroup(ctx,row.group,p.x,y,w);else if(row.type==='relation-item')drawRelationItem(ctx,row.port,row.group,p.x,y,w);else if(row.type==='meta'){if(state.camera.scale>.38){ctx.fillStyle='rgba(225,230,235,.62)';ctx.font=`${Math.max(7,9.5*state.camera.scale)}px ui-sans-serif,system-ui`;ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(trimText(ctx,row.label,w*.78),p.x+w-10*state.camera.scale,y);}}else if(row.type==='more'||row.type==='empty'){if(state.camera.scale>.45){ctx.fillStyle='rgba(225,230,235,.48)';ctx.font=`${Math.max(7,9*state.camera.scale)}px ui-sans-serif,system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(row.label||'no exposed interface',p.x+w/2,y);}}}ctx.globalAlpha=1;}
function drawParameterRow(ctx,param,x,y,w){const s=state.camera.scale;if(s<.38)return;const type=param.type?` : ${param.type}`:'';ctx.font=`${Math.max(7,10*s)}px ui-sans-serif,system-ui`;ctx.fillStyle='rgba(224,227,230,.86)';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(trimText(ctx,param.label+type,w*.88),x+10*s,y);}
function drawValuePort(ctx,port,side,x,y,w){const s=state.camera.scale,c=port.kind==='returns'?'#e4b96c':'#84cfd2',cx=side==='in'?x:x+w;ctx.fillStyle=c;ctx.strokeStyle='#27292b';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,y,Math.max(2.2,4*s),0,Math.PI*2);ctx.fill();ctx.stroke();if(s<.38)return;const type=port.type?` : ${port.type}`:'';ctx.font=`${Math.max(7,10*s)}px ui-sans-serif,system-ui`;ctx.fillStyle='#e0e3e6';ctx.textBaseline='middle';ctx.textAlign=side==='in'?'left':'right';ctx.fillText(trimText(ctx,port.label+type,w*.46),side==='in'?cx+8*s:cx-8*s,y);}
function diamond(ctx,cx,cy,r,color){ctx.fillStyle=color;ctx.strokeStyle='#27292b';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r,cy);ctx.lineTo(cx,cy+r);ctx.lineTo(cx-r,cy);ctx.closePath();ctx.fill();ctx.stroke();}
function drawRelationGroup(ctx,g,x,y,w){const s=state.camera.scale,c=SOCKET_COLORS[g.kind]||'#9aa5b1',side=g.dir,cx=side==='in'?x:x+w;diamond(ctx,cx,y,Math.max(2.8,4.2*s),c);if(s<.38)return;ctx.font=`600 ${Math.max(7,9.5*s)}px ui-sans-serif,system-ui`;ctx.fillStyle='#cbd2d9';ctx.textBaseline='middle';ctx.textAlign=side==='in'?'left':'right';const chevron=g.expanded?'▾':'▸',txt=`${chevron} ${g.port.label}`;ctx.fillText(trimText(ctx,txt,w*.68),side==='in'?cx+9*s:cx-9*s,y);}
function drawRelationItem(ctx,port,g,x,y,w){const s=state.camera.scale,c=SOCKET_COLORS[g.kind]||'#9aa5b1',side=g.dir,cx=side==='in'?x:x+w;diamond(ctx,cx,y,Math.max(2.2,3.2*s),c);if(s<.42)return;ctx.font=`${Math.max(7,9*s)}px ui-sans-serif,system-ui`;ctx.fillStyle='rgba(230,235,240,.72)';ctx.textBaseline='middle';ctx.textAlign=side==='in'?'left':'right';ctx.fillText(trimText(ctx,port.label,w*.72),side==='in'?cx+8*s:cx-8*s,y);}
function trimText(ctx,text,max){if(ctx.measureText(text).width<=max)return text;let s=text;while(s.length>4&&ctx.measureText(s+'…').width>max)s=s.slice(0,-1);return s+'…';}
function roundRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function roundTopRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
function hitTest(clientX,clientY){const rect=els.canvas.getBoundingClientRect(),w=screenToWorld(clientX-rect.left,clientY-rect.top);for(let i=state.viewNodes.length-1;i>=0;i--){const n=state.viewNodes[i];if(w.x>=n.x&&w.x<=n.x+n.w&&w.y>=n.y&&w.y<=n.y+n.h)return n;}return null;}
function hitHierarchyFrame(clientX,clientY){if(state.projection!=='structure')return null;const rect=els.canvas.getBoundingClientRect(),w=screenToWorld(clientX-rect.left,clientY-rect.top);for(let i=state.hierarchyFrames.length-1;i>=0;i--){const f=state.hierarchyFrames[i];/* Blender-style frame dragging: only the frame header is a drag handle. The empty body remains ordinary canvas/pan space. */if(w.x>=f.minX&&w.x<=f.maxX&&w.y>=f.minY&&w.y<=f.minY+f.titleH)return f;}return null;}
function hitRelationGroup(clientX,clientY){const rect=els.canvas.getBoundingClientRect(),w=screenToWorld(clientX-rect.left,clientY-rect.top);for(let i=state.viewNodes.length-1;i>=0;i--){const n=state.viewNodes[i];if(w.x<n.x||w.x>n.x+n.w||w.y<n.y+34||w.y>n.y+n.h)continue;const row=Math.floor((w.y-(n.y+34))/22),r=n.rows[row];if(r?.type==='relation-group')return r.group;}return null;}
function hitRelationRow(clientX,clientY){const rect=els.canvas.getBoundingClientRect(),w=screenToWorld(clientX-rect.left,clientY-rect.top);for(let i=state.viewNodes.length-1;i>=0;i--){const n=state.viewNodes[i];if(w.x<n.x||w.x>n.x+n.w||w.y<n.y+34||w.y>n.y+n.h)continue;const row=Math.floor((w.y-(n.y+34))/22),r=n.rows[row];if(r?.type==='relation-group'||r?.type==='relation-item')return r;}return null;}
function toggleRelationGroup(g){if(state.expandedGroups.has(g.key))state.expandedGroups.delete(g.key);else state.expandedGroups.add(g.key);const manual=new Map(state.viewNodes.filter(n=>n._manual).map(n=>[n.id,{x:n.x,y:n.y}]));const p=buildProjection(state.projection);state.viewNodes=p.nodes.map(makeVisualNode);state.viewEdges=p.edges.map((e,i)=>({...e,_key:`${e.source}|${e.target}|${e.kind}|${i}`}));state.nodeMap=new Map(state.viewNodes.map(n=>[n.id,n]));attachPorts();layoutGraph();for(const [id,pos] of manual){const n=state.nodeMap.get(id);if(n){n.x=pos.x;n.y=pos.y;n._manual=true;}}updateLegend();updateStatus();draw();}
function fitToView(){if(!state.viewNodes.length){state.camera={x:0,y:0,scale:1};draw();return;}let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const n of state.viewNodes){minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x+n.w);minY=Math.min(minY,n.y);maxY=Math.max(maxY,n.y+n.h);}const r=els.graphPanel.getBoundingClientRect(),w=Math.max(100,maxX-minX+100),h=Math.max(100,maxY-minY+100);state.camera.scale=Math.max(.07,Math.min(1.35,Math.min(r.width/w,r.height/h)*.94));state.camera.x=-(minX+maxX)/2;state.camera.y=-(minY+maxY)/2;draw();}

function selectNode(id){if(!id||!state.entityById.has(id))return;state.selectedId=id;const m=state.moduleOf.get(id);if(m)state.selectedModuleId=m;updateSelectionPanel();updateNavigationUI();draw();}
function relationPanelGroups(entity){
 const groups=[];
 const add=(title,relations,dir)=>{if(!relations.length)return;const items=aggregateRelationEndpoints(relations,dir);groups.push({title,items});};
 const outgoing=state.outgoing.get(entity.id)||[],incoming=state.incoming.get(entity.id)||[];
 const incomingCalls=incoming.filter(r=>r.kind==='calls');
 add('Called at module level',incomingCalls.filter(r=>state.entityById.get(r.source)?.kind==='module'),'in');
 add('Called by',incomingCalls.filter(r=>state.entityById.get(r.source)?.kind!=='module'),'in');
 add(entity.kind==='module'?'Top-level calls':'Calls',outgoing.filter(r=>r.kind==='calls'),'out');
 add('Reads state',outgoing.filter(r=>r.kind==='reads'&&r.attributes?.role==='field'),'out');
 add('Uses globals',outgoing.filter(r=>r.kind==='reads'&&r.attributes?.role==='global'),'out');
 add('Reads',outgoing.filter(r=>r.kind==='reads'&&!['field','global','parameter'].includes(r.attributes?.role)),'out');
 add('Writes state',outgoing.filter(r=>r.kind==='writes'&&r.attributes?.role==='field'),'out');
 add('Writes globals',outgoing.filter(r=>r.kind==='writes'&&r.attributes?.role==='global'),'out');
 add('Writes',outgoing.filter(r=>r.kind==='writes'&&!['field','global','parameter'].includes(r.attributes?.role)),'out');
 add('Uses type',outgoing.filter(r=>r.kind==='uses_type'),'out');
 add('Imports',outgoing.filter(r=>r.kind==='imports'),'out');
 add('Inherits',outgoing.filter(r=>r.kind==='inherits'),'out');
 add('Decorated by',outgoing.filter(r=>r.kind==='decorated_by'),'out');
 return groups;
}
const MODULE_DEPENDENCY_KINDS=new Set(['imports','calls','uses_type','inherits']);
function moduleDependencyRelations(moduleId,dir){
 const out=[];
 for(const r of state.graph.relations){
  if(!MODULE_DEPENDENCY_KINDS.has(r.kind))continue;
  const sourceModule=state.moduleOf.get(r.source),targetModule=state.moduleOf.get(r.target);
  if(!sourceModule||!targetModule||sourceModule===targetModule)continue;
  if((dir==='out'&&sourceModule===moduleId)||(dir==='in'&&targetModule===moduleId))out.push(r);
 }
 return out;
}
function moduleRelationGroups(moduleId,dir){
 const relations=moduleDependencyRelations(moduleId,dir),byModule=new Map();
 for(const r of relations){
  const otherModuleId=dir==='out'?state.moduleOf.get(r.target):state.moduleOf.get(r.source);
  if(!otherModuleId)continue;
  let g=byModule.get(otherModuleId);if(!g){const m=state.entityById.get(otherModuleId);g={moduleId:otherModuleId,moduleName:m?.qualified_name||m?.name||otherModuleId,relations:[]};byModule.set(otherModuleId,g);}g.relations.push(r);
 }
 return [...byModule.values()].sort((a,b)=>a.moduleName.localeCompare(b.moduleName));
}
function relationKindLabel(kind){return({imports:'imports',calls:'calls',uses_type:'uses type',inherits:'inherits'})[kind]||kind;}
function renderModuleUsage(moduleEntity){
 const sections=[['Uses',moduleRelationGroups(moduleEntity.id,'out'),'out'],['Used by',moduleRelationGroups(moduleEntity.id,'in'),'in']];
 let total=0;
 const html=sections.map(([title,groups,dir])=>{
  const sectionCount=groups.reduce((n,g)=>n+g.relations.length,0);total+=sectionCount;
  const body=groups.map(g=>{
   const byEndpoint=new Map();
   for(const r of g.relations){
    const source=state.entityById.get(r.source),target=state.entityById.get(r.target);
    const focus=dir==='out'?target:source;
    const counterpart=dir==='out'?source:target;
    const key=`${r.source}\0${r.target}`;
    let item=byEndpoint.get(key);if(!item){item={focus,counterpart,kinds:new Map(),count:0};byEndpoint.set(key,item);}item.count++;item.kinds.set(r.kind,(item.kinds.get(r.kind)||0)+1);
   }
   const items=[...byEndpoint.values()].sort((a,b)=>(a.focus?.qualified_name||a.focus?.name||'').localeCompare(b.focus?.qualified_name||b.focus?.name||''));
   return `<div class="module-usage-group"><div class="module-usage-module" data-id="${attr(g.moduleId)}"><span>${esc(g.moduleName)}</span><span>${g.relations.length}</span></div>${items.map(item=>{
    const focusName=item.focus?.qualified_name||item.focus?.name||item.focus?.id||'?';
    const localName=item.counterpart?.qualified_name||item.counterpart?.name||item.counterpart?.id||'?';
    const kinds=[...item.kinds.entries()].map(([k,c])=>`${relationKindLabel(k)}${c>1?` ×${c}`:''}`).join(' · ');
    const arrow=dir==='out'?'→':'←';
    return `<div class="module-usage-row" data-id="${attr(item.focus?.id||'')}"><div class="module-usage-target"><span class="module-usage-kind">${esc(item.focus?.kind||'entity')}</span>${esc(focusName)}</div><div class="module-usage-context">${esc(localName)} ${arrow} ${esc(focusName)} · ${esc(kinds)}</div></div>`;
   }).join('')}</div>`;
  }).join('')||'<div class="muted module-usage-empty">None</div>';
  return `<div class="module-usage-section"><div class="relation-section-title"><span>${esc(title)}</span><span>${sectionCount}</span></div>${body}</div>`;
 }).join('');
 els.relationCountBadge.textContent=total.toLocaleString();
 els.relationList.innerHTML=html;
 els.relationList.querySelectorAll('.module-usage-module').forEach(row=>row.onclick=()=>selectNode(row.dataset.id));
 els.relationList.querySelectorAll('.module-usage-row').forEach(row=>row.onclick=()=>{if(row.dataset.id)selectNode(row.dataset.id);});
}
function updateSelectionPanel(){
 const e=state.selectedId?state.entityById.get(state.selectedId):null;
 els.selectionEmpty.hidden=!!e;els.selectionDetails.hidden=!e;
 if(!e){els.relationHeading.textContent='Usage';els.relationList.textContent='No selection.';els.relationCountBadge.textContent='0';return;}
 els.entityKind.textContent=e.kind;els.entityKind.style.borderColor=COLORS[e.kind]||'#678';els.entityName.textContent=e.name;els.entityQualified.textContent=e.qualified_name||e.id;
 const rows=[];
 if(e.parent)rows.push(['parent',state.entityById.get(e.parent)?.qualified_name||e.parent]);
 els.entityMeta.innerHTML=rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
 if(e.kind==='module'){els.relationHeading.textContent='Module usage';renderModuleUsage(e);return;}
 els.relationHeading.textContent='Usage';
 const groups=relationPanelGroups(e),total=groups.reduce((n,g)=>n+g.items.reduce((m,x)=>m+x.count,0),0);
 els.relationCountBadge.textContent=total.toLocaleString();
 els.relationList.innerHTML=groups.map(g=>`<div class="relation-section"><div class="relation-section-title">${esc(g.title)} <span>${g.items.reduce((n,x)=>n+x.count,0)}</span></div>${g.items.map(item=>`<div class="relation-row" data-id="${attr(item.id)}"><span class="relation-target">${esc(item.qualified||item.name)}</span>${item.count>1?`<span class="relation-multiplicity">×${item.count}</span>`:''}</div>`).join('')}</div>`).join('')||'<span class="muted">No semantic relations.</span>';
 els.relationList.querySelectorAll('.relation-row').forEach(row=>row.onclick=()=>selectNode(row.dataset.id));
}

function updateLegend(){const visible=[...new Set(state.viewEdges.filter(e=>e.visible).map(e=>e.kind))];els.legend.innerHTML=`<span class="legend-item"><span class="legend-diamond"></span>relation port (expand for endpoint names)</span><span class="legend-item">▣ class frame (does not control auto-layout)</span>`+(visible.length?visible.map(k=>`<span class="legend-item"><span class="legend-socket" style="background:${SOCKET_COLORS[k]||'#899'}"></span>${esc(k)}</span>`).join(''):'');}
function updateStatus(){const shown=state.viewEdges.filter(e=>e.visible).length;els.graphStatus.textContent=`${state.projection} · ${state.viewNodes.length.toLocaleString()} nodes · ${shown.toLocaleString()} links · ${state.projection==='structure'?'drag a class frame to move that class group · ':''}select/hover a node to focus · expand ◇ to name endpoints`;}
function performSearch(q){if(!state.graph||!q.trim()){els.searchResults.innerHTML='';return;}const t=q.trim().toLowerCase(),rs=state.graph.entities.filter(e=>(e.name||'').toLowerCase().includes(t)||(e.qualified_name||'').toLowerCase().includes(t)).slice(0,30);els.searchResults.innerHTML=rs.map(e=>`<div class="search-item" data-id="${attr(e.id)}"><div class="name">${esc(e.name)} <span class="pill">${esc(e.kind)}</span></div><div class="qualified">${esc(e.qualified_name||'')}</div></div>`).join('');els.searchResults.querySelectorAll('.search-item').forEach(row=>row.onclick=()=>{pushNavigationHistory();selectNode(row.dataset.id);state.contextId=row.dataset.id;state.scope='selection';els.scopeSelect.value='selection';selectProjection('neighborhood');els.searchResults.innerHTML='';});}
function openFile(file){if(!file)return;const r=new FileReader();r.onload=()=>{try{loadGraph(JSON.parse(r.result),file.name);}catch(e){alert(`Could not load CodeGraph JSON:\n${e.message}`);}};r.onerror=()=>alert('Could not read file.');r.readAsText(file);}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function attr(v){return esc(v).replace(/`/g,'&#96;');}

els.fileInput.onchange=e=>openFile(e.target.files?.[0]);els.projectionButtons.onclick=e=>{const b=e.target.closest('button[data-projection]');if(b&&state.graph&&b.dataset.projection!==state.projection){pushNavigationHistory();selectProjection(b.dataset.projection);}};els.searchInput.oninput=e=>performSearch(e.target.value);els.depthInput.oninput=e=>{state.depth=Number(e.target.value);els.depthOutput.value=state.depth;rebuildProjection();};els.limitInput.value=state.limit;els.limitInput.onchange=e=>{state.limit=Math.max(20,Math.min(800,Number(e.target.value)||180));e.target.value=state.limit;rebuildProjection();};els.scopeSelect.onchange=e=>{state.scope=e.target.value;rebuildProjection();};els.selectAllFilters.onclick=()=>{state.entityKinds=new Set(ENTITY_KINDS);state.relationKinds=new Set(RELATION_KINDS);buildFilters();rebuildProjection();};els.focusBtn.onclick=()=>{if(!state.selectedId)return;pushNavigationHistory();state.contextId=state.selectedId;state.scope='selection';els.scopeSelect.value='selection';selectProjection('neighborhood');};els.moduleBtn.onclick=()=>{if(!state.selectedId)return;const mid=state.moduleOf.get(state.selectedId);if(mid){pushNavigationHistory();state.selectedModuleId=mid;state.scope='module';els.scopeSelect.value='module';selectProjection('structure');}};els.fitBtn.onclick=fitToView;els.resetBtn.onclick=()=>{state.expandedGroups.clear();state.navigationHistory=[];state.selectedId=null;state.contextId=null;state.selectedModuleId=null;state.scope='overview';els.scopeSelect.value='overview';selectProjection('architecture');updateSelectionPanel();updateNavigationUI();};

els.backBtn.onclick=goBack;

els.canvas.addEventListener('mousedown',e=>{const g=hitRelationGroup(e.clientX,e.clientY);if(g&&e.button===0){toggleRelationGroup(g);return;}const n=hitTest(e.clientX,e.clientY);if(n&&e.button===0){const r=els.canvas.getBoundingClientRect(),w=screenToWorld(e.clientX-r.left,e.clientY-r.top);state.interaction={kind:'node',id:n.id,dx:w.x-n.x,dy:w.y-n.y,startX:e.clientX,startY:e.clientY};selectNode(n.id);els.canvas.classList.add('dragging-node');return;}const f=hitHierarchyFrame(e.clientX,e.clientY);if(f&&e.button===0){const ids=[f.id,...f.descendantIds].filter(id=>state.nodeMap.has(id)),start=new Map(ids.map(id=>{const q=state.nodeMap.get(id);return[id,{x:q.x,y:q.y}];}));state.interaction={kind:'frame',frameId:f.id,startX:e.clientX,startY:e.clientY,start};selectNode(f.id);els.canvas.classList.add('dragging-node');return;}state.interaction={kind:'pan',startX:e.clientX,startY:e.clientY,cx:state.camera.x,cy:state.camera.y};els.canvas.classList.add('dragging');});
window.addEventListener('mousemove',e=>{if(state.interaction?.kind==='node'){const r=els.canvas.getBoundingClientRect(),w=screenToWorld(e.clientX-r.left,e.clientY-r.top),n=state.nodeMap.get(state.interaction.id);if(n){n.x=w.x-state.interaction.dx;n.y=w.y-state.interaction.dy;n._manual=true;draw();}return;}if(state.interaction?.kind==='frame'){const dx=(e.clientX-state.interaction.startX)/state.camera.scale,dy=(e.clientY-state.interaction.startY)/state.camera.scale;for(const[id,pos]of state.interaction.start){const n=state.nodeMap.get(id);if(n){n.x=pos.x+dx;n.y=pos.y+dy;n._manual=true;}}draw();return;}if(state.interaction?.kind==='pan'){state.camera.x=state.interaction.cx+(e.clientX-state.interaction.startX)/state.camera.scale;state.camera.y=state.interaction.cy+(e.clientY-state.interaction.startY)/state.camera.scale;draw();return;}const n=hitTest(e.clientX,e.clientY),id=n?.id||null;if(id!==state.hoverId){state.hoverId=id;draw();}});
window.addEventListener('mouseup',()=>{state.interaction=null;els.canvas.classList.remove('dragging','dragging-node');});
els.canvas.addEventListener('wheel',e=>{e.preventDefault();const r=els.canvas.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,before=screenToWorld(sx,sy),f=Math.exp(-e.deltaY*.001);state.camera.scale=Math.max(.05,Math.min(3,state.camera.scale*f));const after=screenToWorld(sx,sy);state.camera.x+=after.x-before.x;state.camera.y+=after.y-before.y;draw();},{passive:false});
els.canvas.addEventListener('dblclick',e=>{if(hitRelationRow(e.clientX,e.clientY)){e.preventDefault();return;}const n=hitTest(e.clientX,e.clientY);if(!n)return;pushNavigationHistory();selectNode(n.id);if(['module','class'].includes(n.kind)){state.contextId=null;state.selectedModuleId=state.moduleOf.get(n.id)||n.id;state.scope='module';els.scopeSelect.value='module';selectProjection('structure');}else{state.contextId=n.id;state.scope='selection';els.scopeSelect.value='selection';selectProjection('neighborhood');}});
['dragenter','dragover'].forEach(t=>window.addEventListener(t,e=>{e.preventDefault();els.dropOverlay.classList.add('visible');}));['dragleave','drop'].forEach(t=>window.addEventListener(t,e=>{e.preventDefault();if(t==='drop'){els.dropOverlay.classList.remove('visible');openFile(e.dataTransfer.files?.[0]);}else if(e.target===document.documentElement||e.target===document.body)els.dropOverlay.classList.remove('visible');}));window.addEventListener('resize',resizeCanvas);resizeCanvas();buildFilters();updateNavigationUI();
})();
