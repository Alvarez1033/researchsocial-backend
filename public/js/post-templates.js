// ─────────────────────────────────────────────────────────────────────────────
//  ResearchSocial — Post Templates
//  Defines structured fields for each post type
// ─────────────────────────────────────────────────────────────────────────────

const POST_TEMPLATES = {
  proposal: {
    label: 'Research Proposal',
    icon: '🔬',
    color: '#1d4ed8',
    description: 'A structured research proposal with methodology, objectives, and expected outcomes.',
    fields: [
      { key: 'background',    label: 'Background & Rationale',       type: 'textarea', placeholder: 'What is the research problem? Why does it matter?', required: true, rows: 3 },
      { key: 'objectives',    label: 'Research Objectives',          type: 'textarea', placeholder: 'List your primary and secondary objectives...', required: true, rows: 2 },
      { key: 'methodology',   label: 'Methodology',                  type: 'textarea', placeholder: 'Study design, participants, data collection procedures...', required: true, rows: 4 },
      { key: 'analysis',      label: 'Analysis Plan',                type: 'textarea', placeholder: 'Statistical methods, software, analysis approach...', required: false, rows: 2 },
      { key: 'timeline',      label: 'Timeline',                     type: 'text',     placeholder: 'e.g. 6 months, Q1 2026 – Q3 2026', required: false },
      { key: 'sample_size',   label: 'Expected Sample Size',         type: 'text',     placeholder: 'e.g. n=120 participants', required: false },
      { key: 'ethics',        label: 'Ethics & Pre-registration',    type: 'text',     placeholder: 'IRB approval status, OSF pre-registration link...', required: false },
      { key: 'collab_needed', label: 'Collaboration Needed',         type: 'text',     placeholder: 'e.g. Biostatistician, clinical site, funding', required: false },
    ]
  },

  study: {
    label: 'Study / Experiment',
    icon: '🧪',
    color: '#065f46',
    description: 'An ongoing or completed study with methods, data, and preliminary results.',
    fields: [
      { key: 'hypothesis',    label: 'Hypothesis',                   type: 'textarea', placeholder: 'State your primary hypothesis...', required: true, rows: 2 },
      { key: 'methodology',   label: 'Methods',                      type: 'textarea', placeholder: 'Design, participants, instruments, procedure...', required: true, rows: 4 },
      { key: 'sample',        label: 'Sample',                       type: 'text',     placeholder: 'n=?, age range, inclusion/exclusion criteria', required: false },
      { key: 'measures',      label: 'Measures & Instruments',       type: 'textarea', placeholder: 'Validated scales, equipment, biomarkers...', required: false, rows: 2 },
      { key: 'results',       label: 'Preliminary Results',          type: 'textarea', placeholder: 'What have you found so far? (can be partial)', required: false, rows: 3 },
      { key: 'limitations',   label: 'Limitations',                  type: 'textarea', placeholder: 'Known limitations of the current study...', required: false, rows: 2 },
      { key: 'preregistered', label: 'Pre-registration Link',        type: 'text',     placeholder: 'https://osf.io/...', required: false },
    ]
  },

  findings: {
    label: 'Findings / Results',
    icon: '📊',
    color: '#5b21b6',
    description: 'Share key findings from completed research with supporting data.',
    fields: [
      { key: 'key_finding',   label: 'Key Finding',                  type: 'textarea', placeholder: 'State your primary finding clearly and concisely...', required: true, rows: 2 },
      { key: 'methods_brief', label: 'Methods (Brief)',              type: 'textarea', placeholder: 'Brief description of how you obtained these results...', required: true, rows: 2 },
      { key: 'stats',         label: 'Key Statistics',               type: 'textarea', placeholder: 'Effect sizes, p-values, confidence intervals, n...', required: false, rows: 2 },
      { key: 'implications',  label: 'Implications',                 type: 'textarea', placeholder: 'What do these findings mean for the field?', required: false, rows: 2 },
      { key: 'limitations',   label: 'Limitations',                  type: 'textarea', placeholder: 'What should readers be cautious about?', required: false, rows: 2 },
      { key: 'data_available',label: 'Data Availability',            type: 'text',     placeholder: 'Link to dataset, code, or OSF page', required: false },
      { key: 'doi',           label: 'DOI / Publication Link',       type: 'text',     placeholder: 'https://doi.org/...', required: false },
    ]
  },

  review: {
    label: 'Systematic Review / Meta-Analysis',
    icon: '📋',
    color: '#92400e',
    description: 'A structured review of existing literature with PRISMA-aligned reporting.',
    fields: [
      { key: 'review_question',label: 'Review Question / PICO',     type: 'textarea', placeholder: 'Population, Intervention, Comparison, Outcome...', required: true, rows: 2 },
      { key: 'search_strategy',label: 'Search Strategy',            type: 'textarea', placeholder: 'Databases searched, keywords, date range...', required: true, rows: 2 },
      { key: 'inclusion',      label: 'Inclusion / Exclusion Criteria', type: 'textarea', placeholder: 'What studies were included and why?', required: false, rows: 2 },
      { key: 'studies_included',label: 'Studies Included',          type: 'text',     placeholder: 'e.g. k=47 studies, N=12,400 participants', required: false },
      { key: 'main_findings',  label: 'Main Findings',              type: 'textarea', placeholder: 'Pooled effect sizes, heterogeneity, key patterns...', required: true, rows: 3 },
      { key: 'quality',        label: 'Quality Assessment',         type: 'text',     placeholder: 'Tool used (e.g. GRADE, Cochrane RoB), overall quality', required: false },
      { key: 'registration',   label: 'PROSPERO / Registration',    type: 'text',     placeholder: 'CRD42025...', required: false },
    ]
  },

  discussion: {
    label: 'Open Discussion',
    icon: '💬',
    color: '#374151',
    description: 'A free-form post — share thoughts, ask questions, start a conversation.',
    fields: [
      { key: 'body',          label: 'Your post',                   type: 'textarea', placeholder: 'Share your thoughts, question, or observation...', required: true, rows: 6 },
    ]
  },
};

// Generate HTML for a template's fields
function renderTemplateFields(type) {
  const template = POST_TEMPLATES[type];
  if (!template) return '';

  return template.fields.map(field => {
    const req = field.required ? '<span style="color:var(--err);margin-left:2px;">*</span>' : '<span style="font-size:10px;color:var(--faint);margin-left:4px;">(optional)</span>';
    const inputEl = field.type === 'textarea'
      ? `<textarea
           class="post-field-input"
           id="field_${field.key}"
           name="${field.key}"
           placeholder="${field.placeholder}"
           rows="${field.rows || 3}"
           ${field.required ? 'data-required="true"' : ''}
         ></textarea>`
      : `<input
           class="post-field-input"
           type="text"
           id="field_${field.key}"
           name="${field.key}"
           placeholder="${field.placeholder}"
           ${field.required ? 'data-required="true"' : ''}
         >`;
    return `
    <div class="post-field-group">
      <label class="post-field-label" for="field_${field.key}">${field.label}${req}</label>
      ${inputEl}
    </div>`;
  }).join('');
}

// Collect structured body from form
function collectStructuredBody(type) {
  const template = POST_TEMPLATES[type];
  if (!template) return {};
  const body = {};
  for (const field of template.fields) {
    const el = document.getElementById(`field_${field.key}`);
    if (el) body[field.key] = el.value.trim();
  }
  return body;
}

// Validate required fields
function validateTemplate(type) {
  const template = POST_TEMPLATES[type];
  if (!template) return null;
  for (const field of template.fields) {
    if (field.required) {
      const el = document.getElementById(`field_${field.key}`);
      if (!el || !el.value.trim()) return `"${field.label}" is required`;
    }
  }
  return null; // valid
}

// Render structured body for display on a post card
function renderStructuredBody(type, body) {
  if (!body || !Object.keys(body).length) return '';
  const template = POST_TEMPLATES[type];
  if (!template) return '';

  const sections = template.fields
    .filter(f => body[f.key] && f.key !== 'body')
    .map(f => `
      <div class="structured-section">
        <div class="structured-label">${f.label}</div>
        <div class="structured-value">${escHtmlDisplay(body[f.key])}</div>
      </div>`).join('');

  if (type === 'discussion' && body.body) {
    return `<div class="structured-body-free">${escHtmlDisplay(body.body)}</div>`;
  }
  return sections ? `<div class="structured-body">${sections}</div>` : '';
}

function escHtmlDisplay(s) {
  return String(s || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g, '<br>');
}
