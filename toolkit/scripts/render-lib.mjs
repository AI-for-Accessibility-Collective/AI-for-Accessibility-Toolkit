// toolkit/scripts/render-lib.mjs — Markdown rendering helpers shared by
// generate-api-docs.mjs and generate-skill.mjs, so the method/ports/surfaces/
// protocol tables are byte-identical wherever they appear (API.md and
// SKILL.md render the SAME tables from the SAME model — see the mission in
// the commit that added this directory). Pure string functions, no I/O.

export function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

export function mdTable(headers, rows) {
  if (!rows.length) return '_(none)_';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function methodSignature(m) {
  return `${m.owner}.${m.name}(${m.params.join(', ')})`;
}

/** One table per concern group: Method | Async | Description. */
export function renderMethodGroups(methodGroups) {
  return methodGroups.map((g) => {
    const rows = g.methods.map((m) => [
      `\`${methodSignature(m)}\``,
      m.async ? 'async' : '',
      m.description || '(no doc comment)',
    ]);
    return `### ${g.concern}\n\n${mdTable(['Method', 'Async', 'Description'], rows)}`;
  }).join('\n\n');
}

/** Ports section: one subsection per port typedef, then a collapsed section
 *  for supporting (non-port) types. */
export function renderPorts(ports) {
  const portDefs = ports.typedefs.filter((t) => t.kind === 'port');
  const typeDefs = ports.typedefs.filter((t) => t.kind === 'type');

  const portSections = portDefs.map((t) => {
    const rows = t.properties.map((p) => [
      `\`${p.name}\`${p.optional ? ' (optional)' : ''}`,
      `\`${p.type}\``,
      p.description || '(no doc comment)',
    ]);
    return `### ${t.name} (\`${t.file}\`)\n\n${t.description ? t.description + '\n\n' : ''}${mdTable(['Property', 'Type', 'Description'], rows)}`;
  }).join('\n\n');

  const typeSections = typeDefs.map((t) => {
    const rows = t.properties.map((p) => [
      `\`${p.name}\`${p.optional ? ' (optional)' : ''}`,
      `\`${p.type}\``,
      p.description || '(no doc comment)',
    ]);
    return `#### ${t.name}\n\n${mdTable(['Property', 'Type', 'Description'], rows)}`;
  }).join('\n\n');

  const defaultsRow = ports.defaults.map((d) => `\`${d.name}\` (${d.file})`).join(', ');

  return [
    portSections,
    `**Provided default/no-op implementations:** ${defaultsRow}.`,
    typeDefs.length ? `### Supporting types (referenced by \`ActuationPort\`)\n\n${typeSections}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Surfaces table: Module | Export | Params | Async | Description. */
export function renderSurfaces(surfaces) {
  const rows = surfaces.map((s) => [
    `\`${s.module}\``,
    `\`${s.name}\` (${s.kind})`,
    `\`(${s.params.join(', ')})\``,
    s.async ? 'async' : '',
    s.description || '(no doc comment)',
  ]);
  const input = surfaces[0]?.input || 'needs AbilityModel';
  return `Every surface renderer takes the SAME input — the ${input}.\n\n`
    + mdTable(['Module', 'Export', 'Params', 'Async', 'Description'], rows);
}

/** Protocol table: File | kind | v | Required fields. */
export function renderProtocol(protocol) {
  const rows = protocol.map((p) => [
    `[\`${p.file}\`](../${p.file})`,
    p.kind ? `\`${p.kind}\`` : '_(version-only handshake)_',
    p.version != null ? String(p.version) : '',
    p.required.map((r) => `\`${r}\``).join(', '),
  ]);
  return `${mdTable(['Schema', 'kind', 'v', 'Required top-level fields'], rows)}\n\n`
    + 'See [`protocol/README.md`](../protocol/README.md) for the full wire-format writeup, versioning rules, and fixtures.';
}

/** Barrel exports table: Export | Kind | From. */
export function renderBarrel(barrelExports) {
  const rows = barrelExports.map((e) => [
    `\`${e.name}\``,
    e.kind,
    e.from,
  ]);
  return mdTable(['Export', 'Kind', 'From'], rows);
}
