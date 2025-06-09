// =================================================================
//        Phoenix Project v2.8 - 核心重构最终版 (Part 1/2)
// =================================================================

// --- 全局默认配置 ---
const DEFAULT_CONFIG = {
  mytoken: 'auto',
  subConverter: "api.v1.mk",
  subConfig: "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini"
};

export default {
  async fetch(request, env) {
      try {
          const url = new URL(request.url);
          
          // API 路由
          if (url.pathname.startsWith('/api/')) {
              return await handleApiRequest(request, env);
          }

          const userAgent = request.headers.get('User-Agent') || "";

          // 订阅器客户端请求 (非浏览器)
          if (!userAgent.toLowerCase().includes('mozilla')) {
              return await handleSubscriptionRequest(request, env);
          }
          
          // 浏览器访问，返回UI界面
          return new Response(await renderApplicationShell(env), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });

      } catch (err) {
          console.error("FATAL ERROR:", err);
          return new Response(`Worker script failed: ${err.message}\n${err.stack}`, { status: 500 });
      }
  }
};

// =================================================================
//                      API (后端逻辑)
// =================================================================

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/login') {
      return await handleLoginRequest(request, env);
  }
  
  // --- 以下为需要管理员权限的API ---
  const password = request.headers.get('Authorization') || '';
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'your_default_admin_password';
  if (password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: false, message: '未授权' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
  }

  if (url.pathname === '/api/links' && request.method === 'POST') {
      return await handleLinkActionRequest(request, env);
  }
  if (url.pathname === '/api/config' && request.method === 'POST') {
      return await handleConfigSaveRequest(request, env);
  }

  return new Response(JSON.stringify({ success: false, message: 'API端点不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' }});
}

async function handleLoginRequest(request, env) {
  try {
      const { password } = await request.json();
      const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'your_default_admin_password';
      const GUEST_PASSWORD = env.GUEST_PASSWORD || 'your_default_guest_password';
      
      let userType = 'none';
      if (password === ADMIN_PASSWORD) userType = 'admin';
      else if (password === GUEST_PASSWORD) userType = 'guest';

      if (userType === 'none') {
          return new Response(JSON.stringify({ success: false, message: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
      }

      const data = await getRenderData(request, env, userType);
      return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
      return new Response(JSON.stringify({ success: false, message: '服务器内部错误: ' + error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleLinkActionRequest(request, env) {
  if (!env.KV) return new Response(JSON.stringify({ success: false, message: "未绑定KV空间" }), { status: 500 });
  try {
      let links = await getLinksFromKV(env);
      const { action, payload } = await request.json();

      switch(action) {
          case 'add': 
              links.push({ ...payload, id: crypto.randomUUID(), enabled: true }); 
              break;
          case 'add_bulk':
              const urls = payload.urls || [];
              const newLinks = urls.map(url => ({
                  id: crypto.randomUUID(),
                  name: extractNodeName(url),
                  url: url,
                  enabled: true
              }));
              links.push(...newLinks);
              break;
          case 'update': 
              links = links.map(link => link.id === payload.id ? { ...link, ...payload } : link); 
              break;
          case 'delete': 
              links = links.filter(link => link.id !== payload.id); 
              break;
          case 'toggle': 
              links = links.map(link => link.id === payload.id ? { ...link, enabled: !link.enabled } : link); 
              break;
          case 'clear_all':
              links = [];
              break;
          default: 
              return new Response(JSON.stringify({ success: false, message: '未知的操作' }), { status: 400 });
      }
      
      await env.KV.put('SUBS_DATA', JSON.stringify(links, null, 2));
      return new Response(JSON.stringify({ success: true, links, message: '操作成功' }), { headers: { 'Content-Type': 'application/json' }});
  } catch(e) {
      return new Response(JSON.stringify({ success: false, message: e.message }), { status: 500 });
  }
}

async function handleConfigSaveRequest(request, env) {
  if (!env.KV) return new Response(JSON.stringify({ success: false, message: "未绑定KV空间" }), { status: 500 });
  try {
      const { SUBAPI, SUBCONFIG } = await request.json();
      await env.KV.put("SUBAPI", SUBAPI || "");
      await env.KV.put("SUBCONFIG", SUBCONFIG || "");
      return new Response(JSON.stringify({ success: true, message: "高级配置保存成功" }));
  } catch(e) {
      return new Response(JSON.stringify({ success: false, message: e.message }), { status: 500 });
  }
}

async function getRenderData(request, env, userType) {
  const isGuest = userType === 'guest';
  const hostname = new URL(request.url).hostname;
  const mytoken = env.TOKEN || DEFAULT_CONFIG.mytoken;

  await migrateData(env);

  const links = isGuest ? [] : (await getLinksFromKV(env));
  const guestToken = env.GUESTTOKEN || (await generateGuestToken(mytoken));
  const kvSubApi = await env.KV.get("SUBAPI");
  const kvSubConfig = await env.KV.get("SUBCONFIG");
      
  return {
      isAdmin: !isGuest,
      links,
      clientLinks: {
          admin: {
              adaptive: `https://${hostname}/${mytoken}`, base64: `https://${hostname}/${mytoken}?b64`, clash: `https://${hostname}/${mytoken}?clash`,
              singbox: `https://${hostname}/${mytoken}?sb`, surge: `https://${hostname}/${mytoken}?surge`, loon: `https://${hostname}/${mytoken}?loon`,
          },
          guest: {
              adaptive: `https://${hostname}/sub?token=${guestToken}`, base64: `https://${hostname}/sub?token=${guestToken}&b64`, clash: `https://${hostname}/sub?token=${guestToken}&clash`,
              singbox: `https://${hostname}/sub?token=${guestToken}&sb`, surge: `https://${hostname}/sub?token=${guestToken}&surge`, loon: `https://${hostname}/sub?token=${guestToken}&loon`,
          }
      },
      advancedConfig: {
          SUBAPI: kvSubApi || env.SUBAPI || DEFAULT_CONFIG.subConverter,
          SUBCONFIG: kvSubConfig || env.SUBCONFIG || DEFAULT_CONFIG.subConfig,
      }
  };
}

// =================================================================
//                      订阅生成 (核心功能)
// =================================================================

async function handleSubscriptionRequest(request, env) {
  const url = new URL(request.url);
  const userAgent = request.headers.get('User-Agent') || "";
  
  await migrateData(env);

  const kvSubApi = await env.KV.get("SUBAPI");
  const kvSubConfig = await env.KV.get("SUBCONFIG");
  let activeSubConverter = kvSubApi || env.SUBAPI || DEFAULT_CONFIG.subConverter;
  let activeSubConfig = kvSubConfig || env.SUBCONFIG || DEFAULT_CONFIG.subConfig;
  let subProtocol = activeSubConverter.startsWith("http://") ? 'http' : 'https';
  activeSubConverter = activeSubConverter.replace(/^https?:\/\//, '');

  const allLinks = await getLinksFromKV(env);
  const enabledLinks = allLinks.filter(link => link.enabled).map(link => link.url);

  // 分离手动节点和订阅链接
  const manualNodes = enabledLinks.filter(link => !link.toLowerCase().startsWith('http'));
  const subLinks = enabledLinks.filter(link => link.toLowerCase().startsWith('http'));

  // [核心重构] 预处理所有订阅链接
  const { processedNodes, fullConfigUrls } = await fetchAndProcessSubs(subLinks, userAgent);

  // 合并所有节点 (手动节点 + 从订阅中提取的节点)
  const allNodes = [...manualNodes, ...processedNodes].join('\n');
  const uniqueNodes = [...new Set(allNodes.split('\n'))].filter(Boolean).join('\n');
  
  let target = 'base64';
  const clientMap = { clash: 'clash', surge: 'surge', quantumult: 'quanx', loon: 'loon', singbox: 'singbox', 'sing-box': 'singbox' };
  for (const key in clientMap) {
      if (userAgent.toLowerCase().includes(key) || url.searchParams.has(clientMap[key]) || (key === 'sing-box' && url.searchParams.has('sb'))) {
          target = clientMap[key]; break;
      }
  }
  if(url.searchParams.has('base64') || url.searchParams.has('b64')) target = 'base64';
  
  let warpUrl = "";
  if (env.WARP) {
      const warpConfigs = (await ADD(env.WARP)).filter(Boolean);
      if (warpConfigs.length > 0) warpUrl = "|" + warpConfigs.join("|");
  }

  const b64encoded = btoa(unescape(encodeURIComponent(uniqueNodes)));
  
  // [核心重构] 构建最终的 subconverter URL
  let finalUrlParts = [];
  if (uniqueNodes) {
      finalUrlParts.push(`data:text/plain;base64,${b64encoded}`);
  }
  finalUrlParts.push(...fullConfigUrls);
  if(warpUrl) {
      finalUrlParts.push(...warpUrl.split('|').filter(Boolean));
  }

  if (target === 'base64' && finalUrlParts.length === 1 && finalUrlParts[0].startsWith('data:')) {
      return new Response(b64encoded, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const finalUrl = finalUrlParts.join('|');

  if (!finalUrl) {
      return new Response('', { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  
  const subconverterUrl = `${subProtocol}://${activeSubConverter}/sub?target=${target}&url=${encodeURIComponent(finalUrl)}&insert=false&config=${encodeURIComponent(activeSubConfig)}&new_name=true&ua=${encodeURIComponent(userAgent)}`;
  
  try {
      const subResponse = await fetch(subconverterUrl, { signal: AbortSignal.timeout(10000) });

      if (!subResponse.ok) {
          const errorText = await subResponse.text();
          throw new Error(`Subconverter service returned status ${subResponse.status}: ${errorText}`);
      }
      await sendMessage(env, `#获取订阅 ${env.SUBNAME || 'Subscription'}`, request.headers.get('CF-Connecting-IP'), userAgent, url);
      return subResponse;
  } catch (e) {
      // 当转换失败时，提供更详细的错误信息
      const errorBody = `[PHOENIX PROJECT ERROR] Failed to fetch subscription from subconverter.\n\nError: ${e.message}\n\nUpstream URL: ${subconverterUrl}`;
      return new Response(errorBody, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
// =================================================================
//        Phoenix Project v2.8 - 核心重构最终版 (Part 2/2)
// =================================================================

async function renderApplicationShell(env) {
  const FileName = env.SUBNAME || 'Subscription';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-bs-theme="dark">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FileName}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <style>
      :root { --bs-body-bg: #1e1e2e; --bs-body-color: #cdd6f4; --bs-border-color: #45475a; --bs-border-radius: 0.75rem; }
      body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; background-color: #11111b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .main-panel { width: 100%; max-width: 960px; background: rgba(30, 30, 46, 0.7); backdrop-filter: blur(10px); border: 1px solid var(--bs-border-color); border-radius: 1.5rem; padding: 2.5rem; box-shadow: 0 8px 32px rgba(0,0,0,.3); transition: all 0.5s ease; }
      .form-control, .form-select, .form-check-input, textarea { background-color: rgba(69, 71, 90, 0.5); border-color: #585b70; color: var(--bs-body-color); }
      .form-control:focus, textarea:focus { background-color: rgba(69, 71, 90, 0.8); border-color: #89b4fa; box-shadow: 0 0 0 0.25rem rgba(137, 180, 250, 0.25); color: var(--bs-body-color); }
      .form-control::placeholder, textarea::placeholder { color: #6c757d; }
      .btn-primary { background-color: #89b4fa; border-color: #89b4fa; color: #1e1e2e; font-weight: bold; }
      .btn-primary:hover { background-color: #74c7ec; border-color: #74c7ec; }
      .btn-success { background-color: #a6e3a1; border-color: #a6e3a1; color: #1e1e2e; font-weight: bold; }
      .form-check-input:checked { background-color: #a6e3a1; border-color: #a6e3a1; }
      .link-item { background: rgba(69, 71, 90, 0.3); border: 1px solid transparent; border-radius: var(--bs-border-radius); padding: 0.75rem 1rem; margin-bottom: 0.5rem; transition: all 0.2s ease-in-out; }
      .link-item:hover { border-color: #6c757d; }
      .link-name { font-weight: 500; color: #cdd6f4; }
      .link-url { font-size: 0.8rem; color: #a6adc8; word-break: break-all; }
      .card { background: rgba(49, 50, 68, 0.6); border-color: #45475a; }
      .toast-container { z-index: 1100; }
      .fade-in { animation: fadeInAnimation 0.5s ease-in-out; }
      @keyframes fadeInAnimation { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
      .main-grid { display: grid; gap: 1.5rem; }
      .sub-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
  </style>
</head>
<body>
  <div class="main-panel fade-in" id="app"></div>
  <div class="modal fade" id="qrModal"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="qrModalLabel"></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div><div class="modal-body d-flex justify-content-center align-items-center p-4"><div id="qrcode"></div></div></div></div></div>
  <div class="modal fade" id="confirmModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="confirmModalTitle"></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div><div class="modal-body"><p id="confirmModalBody"></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-danger" id="confirmModalBtn">确认</button></div></div></div></div>
  <div class="modal fade" id="bulkAddModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">批量添加链接</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div><div class="modal-body"><textarea class="form-control" id="bulk-urls-input" rows="10" placeholder="每行一个链接..."></textarea></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-primary" id="save-bulk-btn">保存</button></div></div></div></div>
  <div class="toast-container position-fixed top-0 end-0 p-3"></div>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
  <script>${clientSideScript()}</script>
</body>
</html>`;
}

function clientSideScript() {
  return `
  const app = {
      state: { password: null, data: null, confirmAction: null },
      elements: {
          appContainer: document.getElementById('app'),
          toastContainer: document.querySelector('.toast-container'),
          qrModal: new bootstrap.Modal(document.getElementById('qrModal')),
          confirmModal: new bootstrap.Modal(document.getElementById('confirmModal')),
          bulkAddModal: new bootstrap.Modal(document.getElementById('bulkAddModal')),
      },
      init() {
          this.renderLogin();
          this.elements.appContainer.addEventListener('submit', this.handleFormSubmit.bind(this));
          this.elements.appContainer.addEventListener('click', this.handleActionClick.bind(this));
          this.elements.appContainer.addEventListener('change', this.handleActionChange.bind(this));
          this.elements.appContainer.addEventListener('input', this.handleAutoName.bind(this));
          document.getElementById('confirmModalBtn').addEventListener('click', this.handleConfirm.bind(this));
          document.getElementById('save-bulk-btn').addEventListener('click', this.handleSaveBulk.bind(this));
      },
      async handleFormSubmit(e) {
          e.preventDefault();
          const form = e.target;
          const button = form.querySelector('button[type="submit"]');
          if(!button) return;
          const originalButtonText = button.innerHTML;
          button.disabled = true;
          button.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 正在处理...';
          if (form.id === 'login-form') {
              const password = form.querySelector('#password').value;
              try {
                  const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
                  const result = await response.json();
                  if (!result.success) throw new Error(result.message);
                  this.state.password = password;
                  this.state.data = result.data;
                  this.renderApp();
              } catch (err) {
                  this.showToast(err.message || '登录失败', 'danger');
                  button.disabled = false;
                  button.innerHTML = originalButtonText;
              }
          }
      },
      handleActionClick(e) {
          const button = e.target.closest('button');
          if (!button) return;
          if (button.matches('.qr-btn')) { this.showQr(button.dataset.link, button.dataset.title); return; }
          if (button.matches('.input-copy-btn')) { this.copyToClipboard(button.previousElementSibling.value); return; }
          
          if (button.matches('.edit-btn')) this.handleEditClick(button);
          else if (button.matches('.delete-btn')) this.handleDeleteClick(button);
          else if (button.id === 'clear-all-btn') this.handleClearAllClick();
          else if (button.id === 'add-link-btn') this.handleAddOrUpdate(button);
          else if (button.id === 'bulk-add-btn') this.elements.bulkAddModal.show();
          else if (button.id === 'cancel-edit-btn') this.resetLinkForm();
          else if (button.id === 'saveAdvancedBtn') this.handleSaveConfig(button);
      },
      handleActionChange(e) { if (e.target.matches('.toggle-btn')) this.handleToggle(e.target); },
      handleAutoName(e) {
          if (e.target.id !== 'url-input') return;
          const nameInput = document.getElementById('name-input');
          if (nameInput && (nameInput.value.trim() === '' || nameInput.dataset.auto)) {
              nameInput.value = this.extractNodeName(e.target.value);
              nameInput.dataset.auto = true;
          }
      },
      async handleApiAction(endpoint, body, button) {
          if(button) button.disabled = true;
          this.showToast('正在操作...', 'info');
          try {
              const response = await fetch('/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': this.state.password }, body: JSON.stringify(body) });
              const result = await response.json();
              if (!result.success) throw new Error(result.message);
              this.showToast(result.message || '操作成功！');
              if (result.links !== undefined) {
                  this.state.data.links = result.links;
                  document.getElementById('links-list').innerHTML = this.renderLinkList(result.links);
                  this.resetLinkForm();
              }
              return true;
          } catch (e) {
              this.showToast('操作失败: ' + e.message, 'danger');
              return false;
          } finally {
              if(button) button.disabled = false;
          }
      },
      showConfirmModal(title, body, action) {
          document.getElementById('confirmModalTitle').textContent = title;
          document.getElementById('confirmModalBody').textContent = body;
          this.state.confirmAction = action;
          this.elements.confirmModal.show();
      },
      handleEditClick(button) {
          const item = button.closest('.link-item');
          document.getElementById('name-input').value = item.dataset.name;
          document.getElementById('url-input').value = item.dataset.url;
          document.getElementById('edit-id-input').value = item.dataset.id;
          document.getElementById('cancel-edit-btn').classList.remove('d-none');
          document.getElementById('add-link-btn').textContent = '更新链接';
          document.getElementById('name-input').focus();
      },
      handleDeleteClick(button) {
          const item = button.closest('.link-item');
          this.showConfirmModal('确认删除', '您确定要删除链接 "' + item.dataset.name + '" 吗？', {
              type: 'delete',
              payload: { action: 'delete', payload: { id: item.dataset.id } }
          });
      },
      handleClearAllClick() {
          this.showConfirmModal('确认清空', '您确定要删除所有链接吗？此操作不可恢复！', {
              type: 'clear_all',
              payload: { action: 'clear_all' }
          });
      },
      async handleConfirm() {
          if (this.state.confirmAction) {
              await this.handleApiAction('links', this.state.confirmAction.payload);
              this.state.confirmAction = null;
              this.elements.confirmModal.hide();
          }
      },
      handleToggle(checkbox) {
          const item = checkbox.closest('.link-item');
          this.handleApiAction('links', { action: 'toggle', payload: { id: item.dataset.id, enabled: checkbox.checked } });
      },
      handleAddOrUpdate(button) {
          const nameInput = document.getElementById('name-input');
          const urlInput = document.getElementById('url-input');
          const idInput = document.getElementById('edit-id-input');
          const payload = { name: nameInput.value, url: urlInput.value };
          if (!payload.name || !payload.url) { this.showToast('备注和URL不能为空', 'danger'); return; }
          const id = idInput.value;
          const action = id ? 'update' : 'add';
          if (id) payload.id = id;
          this.handleApiAction('links', { action, payload }, button);
      },
      async handleSaveBulk(button) {
          const urlsInput = document.getElementById('bulk-urls-input');
          const urls = urlsInput.value.split('\\n').map(u => u.trim()).filter(Boolean);
          if(urls.length === 0) {
              this.showToast('请输入至少一个链接', 'danger');
              return;
          }
          const success = await this.handleApiAction('links', { action: 'add_bulk', payload: { urls: urls } }, button);
          if(success) {
               urlsInput.value = '';
               this.elements.bulkAddModal.hide();
          }
      },
      handleSaveConfig(button) {
          const payload = { SUBAPI: document.getElementById('subapi-input').value, SUBCONFIG: document.getElementById('subconfig-input').value };
          this.handleApiAction('config', payload, button);
      },
      resetLinkForm() {
          document.getElementById('name-input').value = '';
          document.getElementById('url-input').value = '';
          document.getElementById('edit-id-input').value = '';
          document.getElementById('add-link-btn').textContent = '保存链接';
          document.getElementById('cancel-edit-btn').classList.add('d-none');
      },
      renderLogin() {
          this.elements.appContainer.innerHTML =
              '<header class="text-center mb-4"><h1 class="display-4">Subscription</h1><p class="lead text-muted">您的订阅链接管理中心</p></header>' +
              '<form id="login-form" class="mx-auto" style="max-width: 400px;">' +
                  '<div class="form-floating mb-3">' +
                      '<input type="password" class="form-control" id="password" name="password" placeholder="Password" required>' +
                      '<label for="password">管理员或访客密码</label>' +
                  '</div>' +
                  '<button class="w-100 btn btn-lg btn-primary" id="login-btn" type="submit">' +
                      '<i class="bi bi-box-arrow-in-right me-2"></i>登 录' +
                  '</button>' +
              '</form>';
      },
      renderApp() {
          const data = this.state.data;
          let html = '<header class="text-center mb-5"><h1 class="display-4">Subscription</h1><p class="lead text-muted">您的订阅链接管理中心</p></header>';
          if (data.isAdmin) {
              html += '<div class="main-grid">' +
                      '<div class="card p-3">' + this.renderLinkManagerHTML(data.links) + '</div>' +
                      '<div class="sub-grid">' +
                          '<div class="card p-3">' + this.renderClientLinksHTML(data.clientLinks.admin, 'admin') + '</div>' +
                          '<div class="card p-3">' + this.renderAdvancedConfigHTML(data.advancedConfig) + '</div>' +
                      '</div>' +
                    '</div>';
          } else {
               html += '<div class="card p-3">' + this.renderClientLinksHTML(data.clientLinks.guest, 'guest') + '</div>';
          }
          this.elements.appContainer.innerHTML = '';
          this.elements.appContainer.insertAdjacentHTML('beforeend', html);
          this.elements.appContainer.classList.add('fade-in');
      },
      renderLinkManagerHTML(links) {
          return '<div class="d-flex justify-content-between align-items-center"><h5><i class="bi bi-pencil-square me-2"></i>订阅源管理</h5>' +
                 '<button class="btn btn-sm btn-outline-danger" id="clear-all-btn"><i class="bi bi-trash-fill me-1"></i>清空列表</button></div><hr class="my-3">' +
                 '<div id="links-list" class="mb-3" style="max-height: 400px; overflow-y: auto;">' + this.renderLinkList(links) + '</div>' +
                 '<h6><i class="bi bi-plus-circle me-2"></i>添加/编辑链接</h6>' +
                 '<div class="card" style="background: rgba(0,0,0,0.1);"><div class="card-body">' +
                 '<input type="hidden" id="edit-id-input">' +
                 '<div class="mb-2"><input type="text" class="form-control" id="name-input" placeholder="备注 (可自动识别)"></div>' +
                 '<div class="mb-2"><input type="text" class="form-control" id="url-input" placeholder="粘贴链接 (vless, ss, https, ...)"></div>' +
                 '<div class="d-flex justify-content-between">' +
                     '<div><button class="btn btn-success" id="add-link-btn">保存链接</button> <button class="btn btn-secondary d-none" id="cancel-edit-btn">取消编辑</button></div>' +
                     '<div><button class="btn btn-info" id="bulk-add-btn">批量添加</button></div>' +
                 '</div>' +
                 '</div></div>';
      },
      renderLinkList(links) {
          if (!links || links.length === 0) return '<p class="text-muted text-center mt-3">暂无链接，请添加您的第一个订阅源。</p>';
          return links.map(link =>
              '<div class="link-item d-flex align-items-center" data-id="' + link.id + '" data-name="' + this.escapeHTML(link.name) + '" data-url="' + this.escapeHTML(link.url) + '">' +
                  '<div class="form-check form-switch me-2"><input class="form-check-input toggle-btn" type="checkbox" role="switch" ' + (link.enabled ? 'checked' : '') + '></div>' +
                  '<div class="flex-grow-1"><div class="link-name">' + this.escapeHTML(link.name) + '</div><div class="link-url">' + this.escapeHTML(link.url) + '</div></div>' +
                  '<div class="ms-2 btn-group">' +
                      '<button class="btn btn-sm btn-outline-primary edit-btn"><i class="bi bi-pencil-fill"></i></button>' +
                      '<button class="btn btn-sm btn-outline-danger delete-btn"><i class="bi bi-trash-fill"></i></button>' +
                  '</div>' +
              '</div>'
          ).join('');
      },
      renderAdvancedConfigHTML(config) {
          return '<h5><i class="bi bi-gear-fill me-2"></i>高级配置</h5>' +
                 '<div class="mb-3"><label class="form-label">订阅转换后端 API</label><input type="text" class="form-control" id="subapi-input" value="' + this.escapeHTML(config.SUBAPI) + '"></div>' +
                 '<div class="mb-3"><label class="form-label">订阅配置文件 URL</label><input type="text" class="form-control" id="subconfig-input" value="' + this.escapeHTML(config.SUBCONFIG) + '"></div>' +
                 '<div class="d-flex align-items-center mt-2"><button class="btn btn-success" id="saveAdvancedBtn">保存高级配置</button></div>';
      },
      renderClientLinksHTML(links, type) {
          const title = type === 'admin' ? '管理员订阅' : '访客订阅';
          const linkTypes = ['adaptive', 'base64', 'clash', 'singbox', 'surge', 'loon'];
          const linkNames = {'adaptive':'自适应','base64':'Base64','clash':'Clash','singbox':'Sing-Box','surge':'Surge','loon':'Loon'};
          const cardsHTML = linkTypes.map(key => {
              const linkUrl = this.escapeHTML(links[key]);
              return '<div class="col-12">' +
                  '<div class="card h-100"><div class="card-body p-3">' +
                      '<div class="d-flex justify-content-between align-items-center mb-2">' +
                         '<h6 class="card-title mb-0">' + linkNames[key] + '</h6>' +
                         '<div class="btn-group">' +
                             '<button class="btn btn-sm btn-secondary qr-btn" data-link="' + linkUrl + '" data-title="'+ this.escapeHTML(linkNames[key]) +'">二维码</button>' +
                         '</div>' +
                      '</div>' +
                      '<div class="input-group input-group-sm mt-2">' +
                         '<input type="text" class="form-control" value="' + linkUrl + '" readonly>' +
                         '<button class="btn btn-outline-secondary input-copy-btn" type="button"><i class="bi bi-clipboard"></i></button>' +
                      '</div>' +
                  '</div></div>' +
              '</div>'
          }).join('');
          return '<h5><i class="bi bi-link-45deg me-2"></i>' + title + '</h5><div class="row g-3">' + cardsHTML + '</div>';
      },
      showToast(message, type = 'success') {
          const bgClass = type === 'danger' ? 'bg-danger' : (type === 'info' ? 'bg-primary' : 'bg-success');
          const toastHTML = \`<div class="toast align-items-center text-white \${bgClass} border-0" role="alert"><div class="d-flex"><div class="toast-body">\${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>\`;
          this.elements.toastContainer.insertAdjacentHTML('beforeend', toastHTML);
          const toastEl = this.elements.toastContainer.lastElementChild;
          const bsToast = new bootstrap.Toast(toastEl, { delay: 3000 });
          bsToast.show();
          toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
      },
      copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => this.showToast('已复制到剪贴板')); },
      showQr(text, title) { 
          document.getElementById('qrModalLabel').innerText = title; 
          document.getElementById('qrcode').innerHTML = ''; 
          new QRCode(document.getElementById('qrcode'), { text, width: 256, height: 256 }); 
          this.elements.qrModal.show();
      },
      extractNodeName(url) {
          if (!url) return '';
          try {
              if (url.includes('#')) { const name = decodeURIComponent(url.split('#')[1].trim()); if (name) return name; }
              if (url.startsWith("ss://")) { const b64 = url.substring(5).split('#')[0].trim(); const decoded = atob(b64); const parts = decoded.split('@'); if (parts.length > 1) return parts[1].split(':')[0]; }
              if (url.startsWith("trojan://") || url.startsWith("vless://") || url.startsWith("vmess://")) {
                  const urlPart = url.split('@')[0];
                  const hostPart = url.split('@')[1];
                  if(hostPart.includes('#')) return decodeURIComponent(hostPart.split('#')[1].trim());
                  return hostPart.split(':')[0];
              }
              const urlObj = new URL(url); return urlObj.hostname;
          } catch (e) { return url.substring(0, 40); }
      },
      escapeHTML(str) { return str ? String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]) : ''; }
  };
  app.init();`;
}

// =================================================================
//                      辅助函数
// =================================================================

/**
* [核心重构] 预处理订阅链接，智能分类
* @param {string[]} subLinks - 订阅链接数组
* @param {string} userAgent - 原始客户端的 User-Agent
* @returns {Promise<{processedNodes: string[], fullConfigUrls: string[]}>}
*/
async function fetchAndProcessSubs(subLinks, userAgent) {
  let processedNodes = [];
  let fullConfigUrls = [];

  const promises = subLinks.map(url => 
      fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(5000) })
          .then(res => {
              if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
              return res.text();
          })
          .then(content => {
              if (content.includes('proxies:') || content.includes('outbounds:')) {
                  // 这是一个完整的配置文件，直接保留 URL
                  fullConfigUrls.push(url);
              } else {
                  // 这是一个节点列表（可能是 base64 或纯文本）
                  try {
                      // 尝试 Base64 解码
                      processedNodes.push(atob(content.replace(/\s/g, '')));
                  } catch (e) {
                      // 如果解码失败，认为是纯文本
                      processedNodes.push(content);
                  }
              }
          })
          .catch(err => {
              console.error(`Failed to process subscription ${url}:`, err.message);
              // 可以在这里添加一个伪节点来提示错误
              processedNodes.push(`trojan://ERROR@127.0.0.1:1?sn=SUBSCRIPTION_ERROR#${encodeURIComponent(`订阅链接获取失败: ${url}`)}`);
          })
  );

  await Promise.allSettled(promises);

  return { processedNodes, fullConfigUrls };
}

function extractNodeName(url) {
  if (!url) return 'Unnamed';
  try {
      if (url.includes('#')) {
          const name = decodeURIComponent(url.split('#').pop().trim());
          if (name) return name;
      }
      if (url.startsWith("ss://")) {
          const b64 = url.substring(5).split('#')[0].trim();
          const decoded = atob(b64);
          const parts = decoded.split('@');
          if (parts.length > 1) return parts[1].split(':')[0];
      }
      if (url.startsWith("trojan://") || url.startsWith("vless://") || url.startsWith("vmess://")) {
          const hostPart = url.split('@')[1];
          return hostPart.split(':')[0];
      }
      const urlObj = new URL(url);
      return urlObj.hostname;
  } catch (e) {
      return url.substring(0, 40) + '...';
  }
}

async function getLinksFromKV(env) {
  if (!env.KV) return [];
  let links = await env.KV.get('SUBS_DATA', 'json');
  return links || [];
}

async function migrateData(env) {
  if (!env.KV) return;
  const linksExist = await env.KV.get('SUBS_DATA');
  if (linksExist === null) {
      const oldLinks = await env.KV.get('LINK.txt');
      if (oldLinks) {
          const links = oldLinks.split('\n').filter(Boolean).map(url => ({
              id: crypto.randomUUID(),
              name: extractNodeName(url),
              url: url,
              enabled: true
          }));
          await env.KV.put('SUBS_DATA', JSON.stringify(links, null, 2));
          await env.KV.delete('LINK.txt');
      }
  }
}

async function generateGuestToken(secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("guest-access"));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}


async function sendMessage(env, type, ip, userAgent, url) {
  const BotToken = env.TGTOKEN || '';
  const ChatID = env.TGID || '';
  const TG = env.TG || 0;
  if (BotToken && ChatID && TG == 1) {
      let msg = "";
      try {
          const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`, { signal: AbortSignal.timeout(2000) });
          const ipInfo = await response.json();
          msg = `${type}\nIP: ${ip}\n国家: ${ipInfo.country}\n<tg-spoiler>城市: ${ipInfo.city}\n组织: ${ipInfo.org}\nASN: ${ipInfo.as}\nUA: ${userAgent}\n入口: ${url.pathname + url.search}</tg-spoiler>`;
      } catch(e) {
          msg = `${type}\nIP: ${ip}\n<tg-spoiler>UA: ${userAgent}\n入口: ${url.pathname + url.search}</tg-spoiler>`;
      }
      let tgUrl = `https://api.telegram.org/bot${BotToken}/sendMessage?chat_id=${ChatID}&parse_mode=HTML&text=${encodeURIComponent(msg)}`;
      fetch(tgUrl, { method: 'get' });
  }
}

async function ADD(text) {
  return text.replace(/[	"'|\r\n]+/g, '\n').replace(/\n+/g, '\n').trim().split('\n');
}
