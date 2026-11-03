// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 실습 페이지: Oxigraph(WebAssembly)로 브라우저 안에서 SPARQL 실행 + Cytoscape로 지식 그래프 표시
import init, { Store } from './vendor/oxigraph/web.js';

const CIM = 'http://iec.ch/TC57/CIM100#';
const PREFIXES = `PREFIX cim:  <${CIM}>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ex:   <http://example.org/grid#>
`;
const SHORT = [[CIM, 'cim:'], ['http://example.org/grid#', 'ex:'], ['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf:'],
               ['http://www.w3.org/2000/01/rdf-schema#', 'rdfs:'], ['http://www.w3.org/2001/XMLSchema#', 'xsd:'],
               ['http://www.w3.org/2002/07/owl#', 'owl:']];

const DATASETS = {
  full:   { file: 'examples/sample_grid_full.ttl', ko: '예제 변전소 – pycim 출력 (매핑 · TP · SV 포함)', en: 'Sample substation – pycim output (mapping · TP · SV)' },
  sample: { file: 'examples/power-grid-sample.ttl', ko: '예제 변전소 (손으로 작성한 TTL)', en: 'Sample substation (hand-written TTL)' },
  cigre:  { file: 'examples/cgmes/cigre_mv.ttl', ko: 'CIGRE MV 배전망 (CGMES → pycim)', en: 'CIGRE MV network (CGMES → pycim)' },
  korea:  { file: 'examples/twin/korea_virtual_grid.ttl', ko: '가상 대한민국 전력망 (디지털 트윈, 가상 데이터)', en: 'Virtual Korean grid (digital twin, virtual data)' },
  broken: { file: 'examples/broken-sample.ttl', ko: '규칙 위반 예제 (SHACL 실습용)', en: 'Rule-breaking sample (for SHACL)' }
};

const QUERIES = [
  { ko: '클래스별 개수', en: 'Count by class', q:
`SELECT ?class (COUNT(?s) AS ?count) WHERE {
  ?s a ?c .
  FILTER(STRSTARTS(STR(?c), STR(cim:)))
  BIND(STRAFTER(STR(?c), "#") AS ?class)
} GROUP BY ?class ORDER BY DESC(?count)` },
  { ko: '도전성 설비 전체 (하위 클래스 추론)', en: 'All conducting equipment (subclass reasoning)', q:
`# rdfs:subClassOf* 경로로 Breaker, ACLineSegment 등 하위 클래스까지 찾습니다
SELECT ?name ?class WHERE {
  ?eq a ?c ; cim:IdentifiedObject.name ?name .
  ?c rdfs:subClassOf* cim:ConductingEquipment .
  BIND(STRAFTER(STR(?c), "#") AS ?class)
} ORDER BY ?class ?name` },
  { ko: '인접 설비 (Terminal–ConnectivityNode)', en: 'Adjacent equipment (Terminal–ConnectivityNode)', q:
`SELECT DISTINCT ?a ?b ?node WHERE {
  ?t1 cim:Terminal.ConductingEquipment ?e1 ; cim:Terminal.ConnectivityNode ?cn .
  ?t2 cim:Terminal.ConductingEquipment ?e2 ; cim:Terminal.ConnectivityNode ?cn .
  FILTER(STR(?e1) < STR(?e2))
  ?e1 cim:IdentifiedObject.name ?a .
  ?e2 cim:IdentifiedObject.name ?b .
  ?cn cim:IdentifiedObject.name ?node .
} ORDER BY ?node` },
  { ko: '변전소 → 전압계급 → 설비', en: 'Substation → voltage level → equipment', q:
`SELECT ?substation ?voltageLevel ?kV ?equipment WHERE {
  ?vl cim:VoltageLevel.Substation/cim:IdentifiedObject.name ?substation ;
      cim:IdentifiedObject.name ?voltageLevel ;
      cim:VoltageLevel.BaseVoltage/cim:BaseVoltage.nominalVoltage ?kV .
  OPTIONAL { ?eq cim:Equipment.EquipmentContainer ?vl ; cim:IdentifiedObject.name ?equipment }
} ORDER BY ?substation ?voltageLevel ?equipment` },
  { ko: '매핑 테이블 (Name / NameType)', en: 'Mapping table (Name / NameType)', q:
`SELECT ?object ?authority ?nameType ?code ?mRID WHERE {
  ?n a cim:Name ; cim:Name.name ?code ;
     cim:Name.IdentifiedObject ?o ;
     cim:Name.NameType ?nt .
  ?o cim:IdentifiedObject.name ?object ; cim:IdentifiedObject.mRID ?mRID .
  ?nt cim:NameType.name ?nameType .
  OPTIONAL { ?nt cim:NameType.NameTypeAuthority/cim:NameTypeAuthority.name ?authority }
} ORDER BY ?object ?authority` },
  { ko: 'SV 전압 (조류계산 결과)', en: 'SV voltages (power flow results)', q:
`SELECT ?node ?kV ?angle WHERE {
  ?sv a cim:SvVoltage ; cim:SvVoltage.v ?kV ; cim:SvVoltage.angle ?angle ;
      cim:SvVoltage.TopologicalNode/cim:IdentifiedObject.name ?node .
} ORDER BY ?node` },
  { ko: '부하 합계', en: 'Total load', q:
`SELECT (COUNT(?l) AS ?loads) (SUM(?p) AS ?totalMW) (SUM(?q) AS ?totalMVAr) WHERE {
  ?l a ?c ; cim:EnergyConsumer.p ?p ; cim:EnergyConsumer.q ?q .
  ?c rdfs:subClassOf* cim:EnergyConsumer .
}` }
];

const $ = (id) => document.getElementById(id);
let store, cy, current = 'full', ready = false;

function short(v) {
  for (const [ns, p] of SHORT) if (v.startsWith(ns)) return p + v.slice(ns.length);
  return v;
}

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
}

async function loadDataset(key) {
  current = key;
  $('status').textContent = t({ ko: '데이터 불러오는 중…', en: 'Loading data…' });
  store = new Store();
  const [data, tbox] = await Promise.all([fetchText(DATASETS[key].file), fetchText('shapes/cim-classes.ttl')]);
  store.load(data, { format: 'text/turtle', base_iri: location.href });
  store.load(tbox, { format: 'text/turtle' });   // 클래스 계층 (하위 클래스 추론용)
  const n = store.query('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }')[0].get('n').value;
  $('status').textContent = t({ ko: `불러옴: 트리플 ${n}개 (클래스 계층 포함)`, en: `Loaded: ${n} triples (incl. class hierarchy)` });
  runQuery();
  drawGraph();
}

function runQuery() {
  const out = $('results');
  const t0 = performance.now();
  try {
    const res = store.query(PREFIXES + $('query').value);
    const ms = (performance.now() - t0).toFixed(1);
    if (typeof res === 'boolean') { out.innerHTML = `<p><b>ASK</b>: ${res}</p>`; return; }
    if (!Array.isArray(res) || !res.length) { out.innerHTML = `<p>${t({ ko: '결과 없음', en: 'No results' })} (${ms} ms)</p>`; return; }
    if (!(res[0] instanceof Map)) { out.innerHTML = `<pre>${res.map(q => q.toString()).join('\n')}</pre>`; return; }
    const vars = [...new Set(res.flatMap(r => [...r.keys()]))];
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const cell = term => {
      if (!term) return '';
      if (term.termType === 'NamedNode') return `<a href="#" class="iri" data-iri="${esc(term.value)}">${esc(short(term.value))}</a>`;
      return esc(term.value);
    };
    out.innerHTML = `<p class="meta">${res.length} ${t({ ko: '행', en: 'rows' })} · ${ms} ms</p><div class="tbl"><table><tr>${vars.map(v => `<th>?${v}</th>`).join('')}</tr>` +
      res.slice(0, 500).map(r => `<tr>${vars.map(v => `<td>${cell(r.get(v))}</td>`).join('')}</tr>`).join('') + '</table></div>';
    out.querySelectorAll('.iri').forEach(a => a.addEventListener('click', e => { e.preventDefault(); focusNode(a.dataset.iri); }));
  } catch (e) {
    out.innerHTML = `<p class="err">⚠ ${String(e.message || e)}</p>`;
  }
}

// ---- 지식 그래프 --------------------------------------------------------------
const GROUPS = [
  { key: 'container', classes: ['Substation', 'VoltageLevel', 'Bay', 'Line'], color: '#8b5cf6', ko: '컨테이너', en: 'Container' },
  { key: 'equipment', classes: ['ACLineSegment', 'PowerTransformer', 'Breaker', 'Disconnector', 'LoadBreakSwitch', 'Switch', 'BusbarSection',
      'EnergyConsumer', 'ConformLoad', 'NonConformLoad', 'ExternalNetworkInjection', 'SynchronousMachine'], color: '#b42318', ko: '설비', en: 'Equipment' },
  { key: 'node', classes: ['ConnectivityNode', 'TopologicalNode'], color: '#1f6feb', ko: '노드', en: 'Node' },
  { key: 'terminal', classes: ['Terminal', 'PowerTransformerEnd'], color: '#c2410c', ko: '단자 · 권선단', en: 'Terminal · End' },
  { key: 'naming', classes: ['Name', 'NameType', 'NameTypeAuthority'], color: '#15803d', ko: '매핑 (Name)', en: 'Mapping (Name)' },
  { key: 'sv', classes: ['SvVoltage', 'SvPowerFlow'], color: '#0891b2', ko: 'SV 결과', en: 'SV results' },
  { key: 'other', classes: ['BaseVoltage'], color: '#6b7280', ko: '기타', en: 'Other' }
];
const groupOf = cls => GROUPS.find(g => g.classes.includes(cls)) || GROUPS[GROUPS.length - 1];

function drawGraph() {
  if (!window.cytoscape) return;
  const show = new Set([...document.querySelectorAll('#layers input:checked')].map(i => i.value));
  // 인스턴스 사이의 관계(cim: 속성)만 가져온다. 이름은 IdentifiedObject.name, Name.name, NameType.name 중 있는 것
  const rows = store.query(PREFIXES + `
    SELECT ?s ?p ?o ?sc ?oc (COALESCE(?a1, ?a2, ?a3) AS ?sn) (COALESCE(?b1, ?b2, ?b3) AS ?on) WHERE {
      ?s ?p ?o . FILTER(isIRI(?o) && STRSTARTS(STR(?p), STR(cim:)))
      ?s a ?sc . ?o a ?oc .
      FILTER(STRSTARTS(STR(?sc), STR(cim:)) && STRSTARTS(STR(?oc), STR(cim:)))
      OPTIONAL { ?s cim:IdentifiedObject.name ?a1 } OPTIONAL { ?s cim:Name.name ?a2 } OPTIONAL { ?s cim:NameType.name ?a3 }
      OPTIONAL { ?o cim:IdentifiedObject.name ?b1 } OPTIONAL { ?o cim:Name.name ?b2 } OPTIONAL { ?o cim:NameType.name ?b3 }
    }`);
  const nodes = new Map(), edges = [];
  const cls = term => term.value.split('#')[1];
  const label = (iri, name, c) => name ? name.value : c;   // 이름이 없으면 클래스 이름
  // Terminal을 숨기면 설비 —(Terminal)— 노드를 직접 연결
  const termEq = new Map(), termCn = new Map();
  for (const r of rows) {
    const sc = cls(r.get('sc'));
    if (sc === 'Terminal') {
      const p = r.get('p').value.split('#')[1];
      if (p === 'Terminal.ConductingEquipment') termEq.set(r.get('s').value, r.get('o').value);
      if (p === 'Terminal.ConnectivityNode') termCn.set(r.get('s').value, r.get('o').value);
    }
  }
  const visible = c => show.has(groupOf(c).key);
  const addNode = (iri, c, name) => {
    if (!nodes.has(iri)) nodes.set(iri, { data: { id: iri, label: label(iri, name, c), cls: c, color: groupOf(c).color } });
  };
  for (const r of rows) {
    const s = r.get('s').value, o = r.get('o').value, sc = cls(r.get('sc')), oc = cls(r.get('oc'));
    if (!visible(sc) || !visible(oc)) continue;
    addNode(s, sc, r.get('sn')); addNode(o, oc, r.get('on'));
    edges.push({ data: { id: s + '|' + r.get('p').value + '|' + o, source: s, target: o, label: r.get('p').value.split('#')[1].split('.')[1] } });
  }
  if (!show.has('terminal')) {
    const names = new Map(rows.map(r => [r.get('s').value, r.get('sn')]).concat(rows.map(r => [r.get('o').value, r.get('on')])));
    const clsOf = new Map(rows.map(r => [r.get('s').value, cls(r.get('sc'))]).concat(rows.map(r => [r.get('o').value, cls(r.get('oc'))])));
    for (const [term, eq] of termEq) {
      const cn = termCn.get(term);
      if (!cn || !visible(clsOf.get(eq)) || !visible(clsOf.get(cn))) continue;
      addNode(eq, clsOf.get(eq), names.get(eq)); addNode(cn, clsOf.get(cn), names.get(cn));
      edges.push({ data: { id: term, source: eq, target: cn, label: 'Terminal', dashed: 1 } });
    }
  }
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text').trim(), line = css.getPropertyValue('--muted').trim(), bg = css.getPropertyValue('--surface').trim();
  if (cy) cy.destroy();
  cy = cytoscape({
    container: $('graph'),
    elements: [...nodes.values(), ...edges],
    wheelSensitivity: 0.3,
    style: [
      { selector: 'node', style: { 'background-color': 'data(color)', label: 'data(label)', color: text, 'font-size': 9,
          'text-valign': 'bottom', 'text-margin-y': 3, width: 14, height: 14, 'text-outline-color': bg, 'text-outline-width': 2,
          'min-zoomed-font-size': nodes.size > 60 ? 9 : 0 } },   // 노드가 많으면 확대했을 때만 이름 표시
      { selector: 'edge', style: { width: 1, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle',
          'arrow-scale': 0.6, 'curve-style': 'bezier', opacity: 0.6, label: 'data(label)', 'font-size': 7, color: line,
          'text-rotation': 'autorotate', 'text-opacity': 0 } },
      { selector: 'edge[dashed]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none' } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f59e0b', width: 20, height: 20 } },
      { selector: '.hl', style: { opacity: 1, width: 2, 'text-opacity': 1 } }
    ],
    layout: { name: 'cose', animate: false, nodeRepulsion: 9000, idealEdgeLength: 50, randomize: true, padding: 20 }
  });
  cy.on('tap', 'node', e => showNode(e.target.id()));
  $('graphInfo').textContent = t({ ko: `노드 ${nodes.size}개 · 관계 ${edges.length}개. 노드를 누르면 트리플을 볼 수 있습니다.`,
                                   en: `${nodes.size} nodes · ${edges.length} edges. Click a node to see its triples.` });
}

function focusNode(iri) {
  if (!cy) return;
  const n = cy.getElementById(iri);
  document.getElementById('graph').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (n.nonempty()) { cy.elements().unselect(); n.select(); cy.animate({ center: { eles: n }, zoom: 1.6 }, { duration: 300 }); }
  showNode(iri);
}

function showNode(iri) {
  cy.edges().removeClass('hl');
  const n = cy.getElementById(iri);
  if (n.nonempty()) n.connectedEdges().addClass('hl');
  const out = store.query(`SELECT ?p ?o WHERE { <${iri}> ?p ?o }`);
  const inc = store.query(`SELECT ?s ?p WHERE { ?s ?p <${iri}> }`);
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  $('nodeInfo').innerHTML = `<p><code>${esc(short(iri))}</code></p><div class="tbl"><table>` +
    out.map(r => `<tr><td>${esc(short(r.get('p').value))}</td><td>${esc(short(r.get('o').value))}</td></tr>`).join('') +
    inc.map(r => `<tr><td>← ${esc(short(r.get('p').value))}</td><td>${esc(short(r.get('s').value))}</td></tr>`).join('') + '</table></div>';
}

// ---- SHACL 보고서 ---------------------------------------------------------------
async function shaclReport() {
  const box = $('shaclReport');
  let data;
  try { data = JSON.parse(await fetchText('assets/data/shacl-report.json')); }
  catch (e) { box.textContent = t({ ko: '보고서를 불러오지 못했습니다.', en: 'Could not load the report.' }); return; }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const render = () => {
    box.innerHTML = '<div class="grid">' + data.map(d => `<div class="card"><h4>${d.conforms ? '✅' : '❌'} ${esc(d.dataset)}</h4>
      <p>${esc(t(d))}</p><div class="ex">${d.triples} triples · ${d.conforms ? t({ ko: '통과', en: 'conforms' }) : t({ ko: `위반 ${d.violations.length}건`, en: `${d.violations.length} violations` })}</div></div>`).join('') + '</div>' +
      data.filter(d => !d.conforms).map(d => `<h3>${esc(d.dataset)}</h3><div class="tbl"><table>
        <tr><th>${t({ ko: '대상', en: 'Focus' })}</th><th>${t({ ko: '클래스', en: 'Class' })}</th><th>${t({ ko: '속성', en: 'Path' })}</th><th>${t({ ko: '값', en: 'Value' })}</th><th>${t({ ko: '메시지', en: 'Message' })}</th></tr>` +
        d.violations.map(v => `<tr><td>${esc(v.name || v.focus)}</td><td>${esc(v.class)}</td><td><code>${esc(v.path)}</code></td><td>${esc(v.value)}</td><td>${esc(t(v))}</td></tr>`).join('') +
        '</table></div>').join('');
  };
  render();
  document.addEventListener('langchange', render);
}

// ---- 초기화 ---------------------------------------------------------------------
function fillControls() {
  const ds = $('dataset'), qs = $('presets');
  ds.innerHTML = Object.entries(DATASETS).map(([k, d]) => `<option value="${k}"${k === current ? ' selected' : ''}>${t(d)}</option>`).join('');
  qs.innerHTML = QUERIES.map((q, i) => `<button data-i="${i}">${t(q)}</button>`).join('');
  qs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { $('query').value = QUERIES[b.dataset.i].q; if (ready) runQuery(); }));
  $('legend').innerHTML = GROUPS.map(g => `<label><input type="checkbox" value="${g.key}"${['terminal', 'sv', 'naming'].includes(g.key) ? '' : ' checked'}> <i style="background:${g.color}"></i>${t(g)}</label>`).join('');
}

async function main() {
  fillControls();
  $('query').value = QUERIES[0].q;
  shaclReport();
  document.addEventListener('langchange', () => {
    const checked = new Set([...document.querySelectorAll('#layers input:checked')].map(i => i.value));
    fillControls();
    document.querySelectorAll('#layers input').forEach(i => i.checked = checked.has(i.value));
  });
  $('dataset').addEventListener('change', e => loadDataset(e.target.value));
  $('run').addEventListener('click', runQuery);
  $('query').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); });
  $('layers').addEventListener('change', () => ready && drawGraph());
  $('relayout').addEventListener('click', () => ready && drawGraph());
  try {
    await init({ module_or_path: new URL('./vendor/oxigraph/web_bg.wasm', import.meta.url) });
    ready = true;
    await loadDataset(current);
  } catch (e) {
    $('status').textContent = '⚠ ' + (e.message || e);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
