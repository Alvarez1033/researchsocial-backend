// ─────────────────────────────────────────────────────────────────────────────
//  ResearchSocial — Post Composer
//  Handles the new post modal, structured templates, and attachment uploads
// ─────────────────────────────────────────────────────────────────────────────

let composerPostId = null; // id of the just-created post (for attaching files)
let pendingAttachments = []; // { file, type, caption, linkUrl, linkTitle, localUrl }
let selectedPostType = 'discussion';

function openNewPost() {
  if (!Auth.isLoggedIn()) { openAuth(); return; }
  resetComposer();
  document.getElementById('postComposerModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeComposer() {
  document.getElementById('postComposerModal').classList.remove('open');
  document.body.style.overflow = '';
  composerPostId = null;
  pendingAttachments = [];
}

function resetComposer() {
  composerPostId = null;
  pendingAttachments = [];
  selectedPostType = 'discussion';
  document.getElementById('composerTitle').value = '';
  document.getElementById('composerExcerpt').value = '';
  document.getElementById('composerTags').value = '';
  document.getElementById('composerError').style.display = 'none';
  document.getElementById('attachmentList').innerHTML = '';
  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.type-chip[data-type="discussion"]')?.classList.add('active');
  renderTemplateForm('discussion');
  updateSubmitBtn('publish');
}

function selectPostType(type, el) {
  selectedPostType = type;
  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderTemplateForm(type);
}

function renderTemplateForm(type) {
  const wrap = document.getElementById('templateFieldsWrap');
  const template = POST_TEMPLATES[type];
  if (!template) return;

  // Update description
  document.getElementById('templateDesc').innerHTML = `<span style="font-size:16px;">${template.icon}</span> <strong>${template.label}</strong> — ${template.description}`;

  // Render fields
  wrap.innerHTML = renderTemplateFields(type);
}

// ─── Attachments ──────────────────────────────────────────────────────────────
function openAttachmentPicker(type) {
  if (type === 'image' || type === 'chart') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'image' ? 'image/*' : 'image/*,.pdf';
    input.onchange = e => handleFileSelected(e.target.files[0], type);
    input.click();
  } else if (type === 'link') {
    openLinkDialog();
  }
}

function handleFileSelected(file, type) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('⚠️ File must be under 10MB'); return; }

  const localUrl = URL.createObjectURL(file);
  const att = { id: `local_${Date.now()}`, file, type, caption: '', localUrl, status: 'local' };
  pendingAttachments.push(att);
  renderAttachmentList();
}

function openLinkDialog() {
  const url = prompt('Enter URL:');
  if (!url) return;
  const title = prompt('Link title (optional):') || '';
  pendingAttachments.push({ id: `local_${Date.now()}`, type: 'link', linkUrl: url, linkTitle: title, caption: '', status: 'local' });
  renderAttachmentList();
}

function removeAttachment(localId) {
  pendingAttachments = pendingAttachments.filter(a => a.id !== localId);
  renderAttachmentList();
}

function renderAttachmentList() {
  const list = document.getElementById('attachmentList');
  if (!pendingAttachments.length) { list.innerHTML = ''; return; }

  list.innerHTML = pendingAttachments.map(att => `
    <div class="att-preview-item" data-id="${att.id}">
      ${att.type === 'link'
        ? `<div class="att-link-preview">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
             <div>
               <div style="font-size:12px;font-weight:600;">${esc(att.linkTitle || att.linkUrl)}</div>
               <div style="font-size:11px;color:var(--muted);">${esc(att.linkUrl)}</div>
             </div>
           </div>`
        : `<img src="${att.localUrl}" alt="" style="width:100%;height:80px;object-fit:cover;border-radius:var(--r-md);">`}
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <input type="text" placeholder="Caption (optional)" value="${esc(att.caption)}"
          style="flex:1;font-size:11px;padding:4px 8px;background:var(--off);border:1px solid var(--bdr);border-radius:var(--r-md);color:var(--text);"
          oninput="updateAttCaption('${att.id}',this.value)">
        <button onclick="removeAttachment('${att.id}')" style="font-size:11px;color:var(--err);padding:4px 8px;border:1px solid var(--bdr);border-radius:var(--r-md);">Remove</button>
      </div>
      <div style="font-size:10px;color:var(--warn);margin-top:4px;">⏳ Will be reviewed by staff before becoming visible to others</div>
    </div>`).join('');
}

function updateAttCaption(id, val) {
  const att = pendingAttachments.find(a => a.id === id);
  if (att) att.caption = val;
}

function updateSubmitBtn(state) {
  const btn = document.getElementById('composerSubmitBtn');
  if (state === 'uploading') {
    btn.disabled = true;
    btn.textContent = 'Uploading attachments…';
  } else if (state === 'creating') {
    btn.disabled = true;
    btn.textContent = 'Publishing…';
  } else {
    btn.disabled = false;
    btn.innerHTML = pendingAttachments.length
      ? `Publish Post <span style="font-size:11px;opacity:.8;">(${pendingAttachments.length} attachment${pendingAttachments.length>1?'s':''} pending review)</span>`
      : 'Publish Post';
  }
}

// ─── Submit ────────────────────────────────────────────────────────────────────
async function submitNewPost() {
  const errEl = document.getElementById('composerError');
  errEl.style.display = 'none';

  const title = document.getElementById('composerTitle').value.trim();
  const excerpt = document.getElementById('composerExcerpt').value.trim();
  const tags = document.getElementById('composerTags').value.split(',').map(t => t.trim().replace(/^#/,'')).filter(Boolean);
  const type = selectedPostType;

  // Validate title
  if (!title || title.length < 5) {
    errEl.textContent = 'Title must be at least 5 characters.';
    errEl.style.display = 'block'; return;
  }
  if (!excerpt || excerpt.length < 10) {
    errEl.textContent = 'Summary must be at least 10 characters.';
    errEl.style.display = 'block'; return;
  }

  // Validate template fields
  const templateErr = validateTemplate(type);
  if (templateErr) {
    errEl.textContent = templateErr;
    errEl.style.display = 'block'; return;
  }

  const structuredBody = collectStructuredBody(type);

  updateSubmitBtn('creating');
  try {
    // 1. Create the post
    const post = await API.createPost({ title, excerpt, type, tags, structured_body: structuredBody });
    composerPostId = post.id;

    // 2. Upload attachments if any
    if (pendingAttachments.length) {
      updateSubmitBtn('uploading');
      for (let i = 0; i < pendingAttachments.length; i++) {
        const att = pendingAttachments[i];
        try {
          await uploadAttachment(post.id, att, i);
        } catch(e) {
          console.warn('Attachment upload failed:', e.message);
        }
      }
    }

    closeComposer();
    loadFeed(1);
    showToast(pendingAttachments.length
      ? `🎉 Post published! ${pendingAttachments.length} attachment(s) pending staff review.`
      : '🎉 Post published!'
    );
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    updateSubmitBtn('publish');
  }
}

async function uploadAttachment(postId, att, order) {
  const token = Auth.getToken();
  const form = new FormData();
  form.append('postId', postId);
  form.append('type', att.type);
  form.append('displayOrder', order);
  if (att.caption) form.append('caption', att.caption);

  if (att.type === 'link') {
    form.append('linkUrl', att.linkUrl);
    if (att.linkTitle) form.append('linkTitle', att.linkTitle);
  } else {
    form.append('file', att.file);
  }

  const res = await fetch('/api/attachments', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}
