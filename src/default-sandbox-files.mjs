function joinLines(lines) {
  return lines.join('\n');
}

export function createDefaultWorkspaceFiles(noteContextText) {
  const files = {
    '/workspace/README.md': joinLines([
      '# QNotes Sandbox',
      '',
      'This is a browser sandbox block backed by OpenWebContainer.',
      '',
      'Try typing directly in the terminal:',
      '- ls',
      '- pwd',
      '- cat README.md',
      '- cat note-context.md',
      '- node hello.js',
      '- node qnotes-demo.js',
      '- node qnotes-current-note.js',
      '- node qnotes-search-notes.js keyword',
      '- node qnotes-blocks-query.js milestone projectName Demo',
      '- node qnotes-append-paragraph.js "Sandbox generated note"',
      '- node qnotes-append-search-summary.js keyword',
      '- node qnotes-selftest.js keyword'
    ]),
    '/workspace/hello.js': joinLines([
      "console.log('Hello from QNotes sandbox');",
      "console.log('Terminal input is now connected directly to the shell process.');"
    ]),
    '/workspace/qnotes-demo.js': joinLines([
      "var methods = qnotes.help().methods || [];",
      "var tree = qnotes.notesListTree();",
      "var roots = tree && Array.isArray(tree.tree) ? tree.tree : [];",
      "console.log('Current note id:', qnotes.getCurrentNoteId());",
      "console.log('Current user:', JSON.stringify(qnotes.getCurrentUser(), null, 2));",
      "console.log('Available methods:', methods.join(', '));",
      "console.log('Visible root count:', roots.length);",
      "console.log('Example scripts:');",
      "console.log('- node qnotes-current-note.js');",
      "console.log('- node qnotes-search-notes.js keyword');",
      "console.log('- node qnotes-blocks-query.js milestone projectName Demo');",
      "console.log('- node qnotes-append-paragraph.js \"Sandbox generated note\"');",
      "console.log('- node qnotes-append-search-summary.js keyword');",
      "console.log('- node qnotes-selftest.js keyword');"
    ]),
    '/workspace/qnotes-current-note.js': joinLines([
      "var note = qnotes.currentNote();",
      "if (!note || !note.note) {",
      "  console.log('No current note is available.');",
      "} else {",
      "  var blocks = note.note.content && Array.isArray(note.note.content.blocks) ? note.note.content.blocks : [];",
      "  console.log('Current note id:', note.note.id);",
      "  console.log('Current note title:', note.note.title);",
      "  console.log('Block count:', blocks.length);",
      "  console.log('Readonly:', note.readonly);",
      "}",
      "var contextText = qnotes.getCurrentNoteContext();",
      "console.log('Context preview:');",
      "console.log(String(contextText || '').slice(0, 400));"
    ]),
    '/workspace/qnotes-search-notes.js': joinLines([
      "var keyword = String(process.argv[2] || '').trim();",
      "if (!keyword) {",
      "  console.log('Usage: node qnotes-search-notes.js <keyword>');",
      "} else {",
      "  var result = qnotes.searchNotes(keyword, { limit: 5 });",
      "  var items = result && Array.isArray(result.items) ? result.items : [];",
      "  console.log('Total:', result && result.total ? result.total : 0);",
      "  items.forEach(function (item, index) {",
      "    console.log('---');",
      "    console.log('#' + (index + 1), item.id, item.title);",
      "    console.log('Match fields:', Array.isArray(item.matchFields) ? item.matchFields.join(', ') : '');",
      "    console.log('Snippet:', item.snippet || '');",
      "  });",
      "}"
    ]),
    '/workspace/qnotes-blocks-query.js': joinLines([
      "var type = String(process.argv[2] || 'milestone').trim();",
      "var field = String(process.argv[3] || '').trim();",
      "var keyword = String(process.argv[4] || '').trim();",
      "if (!field) {",
      "  console.log('Usage: node qnotes-blocks-query.js <type> <field> [keyword]');",
      "  console.log('Example: node qnotes-blocks-query.js milestone projectName Demo');",
      "} else {",
      "  var result = qnotes.blocksQuery({",
      "    type: type,",
      "    field: field,",
      "    q: keyword,",
      "    match: keyword ? 'contains' : 'prefix',",
      "    case_insensitive: true,",
      "    limit: 5",
      "  });",
      "  var items = result && Array.isArray(result.items) ? result.items : [];",
      "  console.log('Matched blocks:', items.length);",
      "  items.forEach(function (item, index) {",
      "    console.log('---');",
      "    console.log('#' + (index + 1), 'note', item.note_id, 'block', item.block_index);",
      "    console.log('Preview:', item.data_preview || '');",
      "    console.log('Data keys:', Object.keys(item.data || {}).join(', '));",
      "  });",
      "}"
    ]),
    '/workspace/qnotes-append-paragraph.js': joinLines([
      "var text = String(process.argv.slice(2).join(' ') || '').trim();",
      "if (!text) {",
      "  console.log('Usage: node qnotes-append-paragraph.js <text>');",
      "} else {",
      "  var result = qnotes.appendParagraph(text);",
      "  console.log('Append result:');",
      "  console.log(JSON.stringify(result, null, 2));",
      "}"
    ]),
    '/workspace/qnotes-append-search-summary.js': joinLines([
      "var keyword = String(process.argv[2] || '').trim();",
      "if (!keyword) {",
      "  console.log('Usage: node qnotes-append-search-summary.js <keyword>');",
      "} else {",
      "  var result = qnotes.searchNotes(keyword, { limit: 3 });",
      "  var items = result && Array.isArray(result.items) ? result.items : [];",
      "  var lines = [];",
      "  var blocks;",
      "  var appendResult;",
      "  lines.push('Sandbox summary for keyword: ' + keyword);",
      "  lines.push('Matched notes: ' + (result && result.total ? result.total : 0));",
      "  items.forEach(function (item, index) {",
      "    lines.push((index + 1) + '. [' + item.id + '] ' + item.title);",
      "  });",
      "  blocks = lines.map(function (line) {",
      "    return { type: 'paragraph', data: { text: line } };",
      "  });",
      "  appendResult = qnotes.appendBlocks(blocks);",
      "  console.log('Search total:', result && result.total ? result.total : 0);",
      "  console.log('Append result:');",
      "  console.log(JSON.stringify(appendResult, null, 2));",
      "}"
    ]),
    '/workspace/qnotes-selftest.js': joinLines([
      "var keyword = String(process.argv[2] || 'QNotes').trim();",
      "var report = [];",
      "var currentNote = qnotes.currentNote();",
      "var currentNoteId = qnotes.getCurrentNoteId();",
      "var searchResult = qnotes.searchNotes(keyword, { limit: 2 });",
      "var blockResult = qnotes.blocksQuery({ type: 'milestone', limit: 1 });",
      "var blockItems = blockResult && Array.isArray(blockResult.items) ? blockResult.items : [];",
      "var appendResult;",
      "report.push('Sandbox selftest at ' + new Date().toISOString());",
      "report.push('Current note id: ' + currentNoteId);",
      "report.push('Current note title: ' + (currentNote && currentNote.note ? currentNote.note.title : ''));",
      "report.push('Search keyword: ' + keyword);",
      "report.push('Search total: ' + (searchResult && searchResult.total ? searchResult.total : 0));",
      "report.push('Milestone blocks sampled: ' + blockItems.length);",
      "appendResult = qnotes.appendBlocks(report.map(function (line) {",
      "  return { type: 'paragraph', data: { text: line } };",
      "}));",
      "console.log('Selftest report:');",
      "console.log(report.join('\\n'));",
      "console.log('Append result:');",
      "console.log(JSON.stringify(appendResult, null, 2));"
    ])
  };

  if (noteContextText) {
    files['/workspace/note-context.md'] = String(noteContextText);
  }

  return files;
}
