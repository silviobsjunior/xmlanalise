// frontend/app.js — xmlAnalise Frontend

const API = window.location.origin;

let supabaseClient = null;
let currentUser = null;
let currentToken = null;
let perspectivaPadrao = 'consumidor'; // 'consumidor' | 'emitente' | 'revendedor'
let configCache = null;

// Dados dos filtros carregados uma vez
let todosOsBairros = [];

// ============================================================
// CONFIGURAÇÕES E SUPABASE
// ============================================================
async function loadConfig() {
  if (configCache) return configCache;
  const response = await fetch(`${API}/api/config`);
  if (!response.ok) throw new Error('Falha ao carregar configurações');
  configCache = await response.json();
  return configCache;
}

async function initSupabase() {
  try {
    const config = await loadConfig();
    if (typeof supabase === 'undefined') return false;
    supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });
    return true;
  } catch (e) {
    console.error('❌ Erro Supabase:', e);
    return false;
  }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Inicializando xmlAnalise...');

  const supabaseReady = await initSupabase();
  if (!supabaseReady) {
    showToast('Erro ao conectar com servidor de autenticação', 'error');
    showAnonymousUser();
  } else {
    await initAuth();
  }

  setupEventListeners();
  await carregarFiltros();

  // Aba busca é a padrão — não carrega notas/stats até o usuário trocar de aba
});

// ============================================================
// AUTENTICAÇÃO
// ============================================================
async function initAuth() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.error('Erro sessão:', error);

    if (session?.user) {
      currentUser = session.user;
      currentToken = session.access_token;
      showUserLoggedIn(session.user);
    } else {
      showAnonymousUser();
    }
  } catch (e) {
    console.error('❌ Erro auth:', e);
    showAnonymousUser();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      currentToken = session.access_token;
      showUserLoggedIn(session.user);
      const sessionId = getAnonymousSessionId();
      if (sessionId) await migrarDadosAnonimos(sessionId);
      showToast('Login realizado com sucesso! 🎉', 'success');
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentToken = null;
      showAnonymousUser();
      showToast('Logout realizado', 'success');
    } else if (event === 'TOKEN_REFRESHED' && session) {
      currentToken = session.access_token;
    }
  });
}

function getAnonymousSessionId() {
  const match = document.cookie.match(/anonymousSessionId=([^;]+)/);
  return match ? match[1] : null;
}

async function loginWithGoogle() {
  const currentSessionId = getAnonymousSessionId();
  if (currentSessionId) localStorage.setItem('preLoginSessionId', currentSessionId);
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
  if (error) showToast('Erro ao iniciar login com Google', 'error');
}

async function logout() {
  await supabaseClient.auth.signOut();
  document.cookie = 'anonymousSessionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  localStorage.removeItem('preLoginSessionId');
}

async function migrarDadosAnonimos(sessionId) {
  if (!sessionId || !currentToken) return;
  try {
    const res = await fetch(`${API}/api/migrar-dados-anonimos`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    if (data.sucesso && data.quantidade_migrada > 0)
      showToast(`${data.quantidade_migrada} nota(s) migrada(s) ✅`, 'success');
  } catch (e) { console.error('Erro migração:', e); }
}

function showUserLoggedIn(user) {
  const nome = user.user_metadata?.full_name || user.email || 'Usuário';
  const avatar = user.user_metadata?.avatar_url;
  document.getElementById('loginBtn').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'flex';
  const userInfo = document.getElementById('userInfo');
  const anon = document.getElementById('anonymousIndicator');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  if (userInfo) userInfo.style.display = 'flex';
  if (anon) anon.style.display = 'none';
  if (userName) userName.textContent = nome;
  if (userAvatar) {
    if (avatar) {
      userAvatar.innerHTML = `<img src="${avatar}" alt="${nome}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`;
      userAvatar.style.background = 'transparent';
    } else {
      userAvatar.textContent = nome.charAt(0).toUpperCase();
      userAvatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      userAvatar.style.color = 'white';
    }
  }
  const banner = document.getElementById('loginBanner');
  if (banner) banner.style.display = 'none';
}

function showAnonymousUser() {
  document.getElementById('loginBtn').style.display = 'flex';
  document.getElementById('logoutBtn').style.display = 'none';
  const userInfo = document.getElementById('userInfo');
  const anon = document.getElementById('anonymousIndicator');
  if (userInfo) userInfo.style.display = 'none';
  if (anon) anon.style.display = 'flex';
  const banner = document.getElementById('loginBanner');
  if (banner) banner.style.display = 'block';
}

// ============================================================
// ABA DE BUSCA DE VENDEDORES
// ============================================================
async function carregarFiltros() {
  try {
    const res = await fetch(`${API}/api/filtros-vendedores`);
    const data = await res.json();
    if (!data.sucesso) return;

    todosOsBairros = data.bairros || [];

    const selectCidade = document.getElementById('filtroCidade');
    if (selectCidade) {
      data.cidades.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.municipio;
        opt.textContent = `${c.municipio} — ${c.uf}`;
        selectCidade.appendChild(opt);
      });
    }

    // Popula todos os bairros inicialmente
    popularBairros('');

  } catch (e) {
    console.error('Erro ao carregar filtros:', e);
  }
}

function popularBairros(cidadeFiltro) {
  const selectBairro = document.getElementById('filtroBairro');
  if (!selectBairro) return;

  selectBairro.innerHTML = '<option value="">📍 Todos os bairros</option>';

  const bairrosFiltrados = cidadeFiltro
    ? todosOsBairros.filter(b => b.municipio === cidadeFiltro)
    : todosOsBairros;

  bairrosFiltrados.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.bairro;
    opt.textContent = b.bairro;
    selectBairro.appendChild(opt);
  });
}

async function executarBusca() {
  const termo = document.getElementById('buscaTermo')?.value?.trim();
  const cidade = document.getElementById('filtroCidade')?.value;
  const bairro = document.getElementById('filtroBairro')?.value;

  const loading = document.getElementById('buscaLoading');
  const vazio = document.getElementById('buscaVazio');
  const resultados = document.getElementById('buscaResultados');
  const vazioMsg = document.getElementById('buscaVazioMsg');

  if (!termo || termo.length < 3) {
    showToast('Digite pelo menos 3 caracteres para buscar', 'warning');
    return;
  }

  if (loading) loading.style.display = 'block';
  if (vazio) vazio.style.display = 'none';
  if (resultados) resultados.innerHTML = '';

  try {
    const params = new URLSearchParams({ termo });
    if (cidade) params.append('cidade', cidade);
    if (bairro) params.append('bairro', bairro);

    const res = await fetch(`${API}/api/buscar-produtos?${params}`);
    const data = await res.json();

    if (loading) loading.style.display = 'none';

    if (!data.sucesso || !data.resultados || data.resultados.length === 0) {
      if (vazio) vazio.style.display = 'block';
      if (vazioMsg) vazioMsg.textContent = `Nenhum vendedor encontrado para "${termo}".`;
      return;
    }

    renderizarResultados(data.resultados, termo);

  } catch (e) {
    console.error('Erro na busca:', e);
    if (loading) loading.style.display = 'none';
    showToast('Erro ao realizar busca. Tente novamente.', 'error');
  }
}

function renderizarResultados(resultados, termo) {
  const container = document.getElementById('buscaResultados');
  if (!container) return;

  const totalVendedores = resultados.length;
  const totalProdutos = resultados.reduce((acc, r) => acc + r.produtos.length, 0);

  container.innerHTML = `
    <div style="margin-bottom:16px; padding:10px 14px; background:#f0f4ff; border-radius:8px; font-size:13px; color:#555;">
      Encontrados <strong>${totalVendedores} vendedor(es)</strong> com <strong>${totalProdutos} produto(s)</strong> correspondentes a "<strong>${termo}</strong>"
    </div>
  `;

  resultados.forEach(item => {
    const v = item.vendedor;
    const nomePrincipal = v.nome_fantasia || v.razao_social || 'Vendedor';
    const nomeSecundario = v.nome_fantasia ? v.razao_social : '';
    const enderecoCompleto = [v.logradouro, v.numero, v.complemento].filter(Boolean).join(', ');
    const localizacao = [v.bairro, v.cidade, v.uf].filter(Boolean).join(' — ');

    const produtosHtml = item.produtos.slice(0, 5).map(p => `
      <span style="display:inline-block; background:#e8f0fe; color:#3c5fb5; border-radius:20px;
                   padding:3px 10px; font-size:12px; margin:2px;">
        ${p.cean ? `<strong>${p.cean}</strong> · ` : ''}${p.descricao || ''}
      </span>
    `).join('');

    const maisHtml = item.produtos.length > 5
      ? `<span style="font-size:12px; color:#888; margin-left:4px;">+${item.produtos.length - 5} produto(s)</span>`
      : '';

    const telHtml = v.telefone
      ? `<a href="tel:${v.telefone}" style="color:#667eea; text-decoration:none;">📞 ${v.telefone}</a>`
      : '<span style="color:#bbb;">Telefone não disponível</span>';

    // Links de localização
    // Maps: abre o endereço no Google Maps (funciona sempre)
    // Street View: usa a URL de embed do Maps com parâmetro cbll que força o modo street
    const enderecoQuery = [v.logradouro, v.numero, v.bairro, v.cidade, v.uf, 'Brasil'].filter(Boolean).join(', ');
    const mapsUrl       = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoQuery)}`;
    const streetViewUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoQuery)}&layer=c`;
    const streetViewHtml = enderecoCompleto
      ? `<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
           <a href="${mapsUrl}" target="_blank" rel="noopener"
              style="color:#667eea; text-decoration:none; display:inline-flex; align-items:center; gap:4px;
                     font-size:12px; padding:4px 8px; border:1px solid #667eea; border-radius:6px; white-space:nowrap;">
             📍 Ver no Maps
           </a>
           <a href="${streetViewUrl}" target="_blank" rel="noopener"
              style="color:#43a047; text-decoration:none; display:inline-flex; align-items:center; gap:4px;
                     font-size:12px; padding:4px 8px; border:1px solid #43a047; border-radius:6px; white-space:nowrap;">
             🚶 Street View
           </a>
         </div>`
      : '<span style="color:#bbb;">Endereço não disponível</span>';

    const ultimaVendaHtml = v.ultima_venda
      ? `<span style="color:#aaa; font-size:12px;">Última venda: ${new Date(v.ultima_venda).toLocaleDateString('pt-BR')}</span>`
      : '';

    const card = document.createElement('div');
    card.style.cssText = `
      border:1px solid #e4e8f0; border-radius:12px; padding:20px;
      margin-bottom:14px; background:white;
      box-shadow:0 1px 4px rgba(0,0,0,0.06); transition:box-shadow 0.2s;
    `;
    card.onmouseenter = () => card.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)';
    card.onmouseleave = () => card.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div>
          <div style="font-size:17px; font-weight:600; color:#222;">${nomePrincipal}</div>
          ${nomeSecundario ? `<div style="font-size:13px; color:#888; margin-top:2px;">${nomeSecundario}</div>` : ''}
        </div>
        <span style="background:#f0f4ff; color:#3c5fb5; border-radius:6px; padding:4px 10px; font-size:12px; font-weight:500; white-space:nowrap;">
          CNPJ: ${formatarCNPJ(v.cnpj)}
        </span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:13px;">
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">Bairro</div>
          <div style="color:#444;">${v.bairro || '—'}</div>
        </div>
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">Cidade / UF</div>
          <div style="color:#444;">${localizacao || '—'}</div>
        </div>
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">Rua e Número</div>
          <div style="color:#444;">${enderecoCompleto || '—'}</div>
        </div>
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">CEP</div>
          <div style="color:#444;">${formatarCEP(v.cep) || '—'}</div>
        </div>
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">Contato</div>
          <div>${telHtml}</div>
        </div>
        <div>
          <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">Localização</div>
          <div style="margin-top:2px;">${streetViewHtml}</div>
        </div>
      </div>

      <div style="border-top:1px solid #f0f0f0; padding-top:12px;">
        <div style="color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Produtos encontrados</div>
        <div>${produtosHtml}${maisHtml}</div>
      </div>

      <div style="margin-top:10px; text-align:right;">
        ${ultimaVendaHtml}
      </div>
    `;

    container.appendChild(card);
  });
}

function formatarCNPJ(cnpj) {
  if (!cnpj) return '—';
  const s = cnpj.replace(/\D/g, '');
  if (s.length !== 14) return cnpj;
  return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarCEP(cep) {
  if (!cep) return null;
  const s = cep.replace(/\D/g, '');
  if (s.length !== 8) return cep;
  return s.replace(/(\d{5})(\d{3})/, '$1-$2');
}

// ============================================================
// UPLOAD E NOTAS (funcionalidades existentes)
// ============================================================
function mostrarConfirmacaoUpload(files) {
  if (!files || files.length === 0) return;

  // Remove diálogo anterior se existir
  const anterior = document.getElementById('confirmacaoUpload');
  if (anterior) anterior.remove();

  const nomes = {
    consumidor: { label: '🛒 Sou COMPRADOR',   desc: 'Recebi estes XMLs nas minhas compras. Os vendedores aparecerão nas buscas.' },
    emitente:   { label: '🏪 Sou VENDEDOR',    desc: 'Estes XMLs são das minhas vendas. Minha empresa aparecerá nas buscas.' },
    revendedor: { label: '🔄 Sou REVENDEDOR',  desc: 'Comprei estes produtos para revender. Minha empresa aparecerá nas buscas.' }
  };

  const dialog = document.createElement('div');
  dialog.id = 'confirmacaoUpload';
  dialog.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.5);
    display:flex; align-items:center; justify-content:center;
    z-index:9999; padding:20px;
  `;

  dialog.innerHTML = `
    <div style="background:white; border-radius:16px; padding:28px; max-width:480px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:20px; font-weight:700; color:#222; margin-bottom:6px;">
        📂 ${files.length} arquivo${files.length > 1 ? 's' : ''} pronto${files.length > 1 ? 's' : ''} para importar
      </div>
      <div style="font-size:13px; color:#888; margin-bottom:20px;">
        Como você se relaciona com estes documentos?
      </div>

      <div id="opcoesRole" style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
        ${['consumidor','emitente','revendedor'].map(val => `
          <label id="label_${val}" style="display:flex; align-items:flex-start; gap:12px; padding:14px 16px;
            border:2px solid ${val === 'consumidor' ? '#667eea' : '#e9ecef'};
            border-radius:10px; cursor:pointer;
            background:${val === 'consumidor' ? '#f0f2ff' : 'white'};
            transition:all 0.15s;">
            <input type="radio" name="roleUpload" value="${val}" ${val === 'consumidor' ? 'checked' : ''}
              style="margin-top:3px; accent-color:#667eea; width:16px; height:16px; flex-shrink:0;">
            <div>
              <div style="font-weight:600; font-size:14px; color:#222;">${nomes[val].label}</div>
              <div style="font-size:12px; color:#666; margin-top:2px;">${nomes[val].desc}</div>
            </div>
          </label>`).join('')}
      </div>

      <div style="display:flex; gap:10px;">
        <button id="btnCancelarUpload" style="flex:1; padding:12px; border:1px solid #ddd; border-radius:8px;
          background:white; color:#666; font-size:14px; cursor:pointer;">
          Cancelar
        </button>
        <button id="btnConfirmarUpload" style="flex:2; padding:12px; border:none; border-radius:8px;
          background:#667eea; color:white; font-size:14px; font-weight:600; cursor:pointer;">
          Importar arquivos
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Highlight ao mudar seleção
  dialog.querySelectorAll('input[name="roleUpload"]').forEach(radio => {
    radio.addEventListener('change', () => {
      ['consumidor','emitente','revendedor'].forEach(v => {
        const lbl = document.getElementById('label_' + v);
        const sel = v === radio.value;
        lbl.style.borderColor = sel ? '#667eea' : '#e9ecef';
        lbl.style.background  = sel ? '#f0f2ff' : 'white';
      });
    });
  });

  document.getElementById('btnCancelarUpload').onclick = () => dialog.remove();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

  document.getElementById('btnConfirmarUpload').onclick = () => {
    const selecionado = dialog.querySelector('input[name="roleUpload"]:checked').value;
    perspectivaPadrao = selecionado;
    dialog.remove();
    executarUpload(files);
  };
}

async function processMultipleFiles(files) {
  if (!files || files.length === 0) return;
  mostrarConfirmacaoUpload(files);
}

async function executarUpload(files) {
  const uploadArea = document.getElementById('uploadArea');
  const uploadProgress = document.getElementById('uploadProgress');
  const uploadCount = document.getElementById('uploadCount');
  const uploadDetails = document.getElementById('uploadDetails');

  if (uploadArea) uploadArea.classList.add('loading-upload');
  if (uploadProgress) uploadProgress.style.display = 'block';

  let successCount = 0, errorCount = 0, duplicateCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (uploadCount) uploadCount.textContent = `${i + 1}/${files.length}`;
    if (uploadDetails) uploadDetails.textContent = `Processando: ${file.name}`;
    try {
      const result = await uploadXML(file);
      if (result.sucesso) successCount++;
      else if (result.duplicado) duplicateCount++;
      else errorCount++;
    } catch (e) { errorCount++; }
  }

  if (uploadArea) uploadArea.classList.remove('loading-upload');
  if (uploadProgress) uploadProgress.style.display = 'none';

  const parts = [];
  if (successCount > 0) parts.push(`✅ ${successCount} importado(s)`);
  if (duplicateCount > 0) parts.push(`⚠️ ${duplicateCount} duplicado(s)`);
  if (errorCount > 0) parts.push(`❌ ${errorCount} erro(s)`);
  if (parts.length > 0) showToast(parts.join(' | '), successCount > 0 ? 'success' : 'warning');

  if (successCount > 0) {
    await loadNotas();
    await loadStatistics();
    await carregarFiltros();
  }
}

async function uploadXML(file) {
  const formData = new FormData();
  formData.append('xml', file);
  // 'consumidor' e 'emitente' têm o mesmo efeito no backend: emitente vira vendedor
  const perspectivaBackend = perspectivaPadrao === 'revendedor' ? 'revendedor' : 'emitente';
  formData.append('perspectiva', perspectivaBackend);
  const headers = {};
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const response = await fetch(`${API}/api/processar-xml`, {
    method: 'POST', credentials: 'include', headers, body: formData
  });
  const result = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(result.erro || 'Erro');
  return result;
}

// Estado de paginação
let paginacaoState = { pagina: 1, porPagina: 50, total: 0, totalPaginas: 0, search: '' };

async function loadNotas(search = '', pagina = 1, porPagina = null) {
  const fileList = document.getElementById('fileList');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const emptyState = document.getElementById('emptyState');
  if (!fileList) return;

  if (porPagina !== null) paginacaoState.porPagina = porPagina;
  paginacaoState.pagina = pagina;
  paginacaoState.search = search;

  if (loadingIndicator) loadingIndicator.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';
  fileList.innerHTML = '';
  const oldPag = document.getElementById('paginacaoContainer');
  if (oldPag) oldPag.remove();

  if (!currentToken) {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  try {
    const params = new URLSearchParams({ page: paginacaoState.pagina, perPage: paginacaoState.porPagina });
    if (search) params.append('search', search);

    const response = await fetch(`${API}/api/minhas-notas?${params}`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (response.status === 401) {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    const data = await response.json();
    if (loadingIndicator) loadingIndicator.style.display = 'none';

    const notas = data.notas || [];
    const pag = data.paginacao || {};
    paginacaoState.total = pag.total || 0;
    paginacaoState.totalPaginas = pag.totalPaginas || 1;

    if (!notas || notas.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      renderPaginacao(pag);
      return;
    }

    notas.forEach(nota => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const dataEmissao = nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR') : '—';
      const valorTotal = nota.valor_total_nf
        ? parseFloat(nota.valor_total_nf).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : (nota.valor_total_nota ? parseFloat(nota.valor_total_nota).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
      const isRevendedor = nota.perspectiva_importador === 'revendedor';
      const bgColor = isRevendedor ? '#fff8f0' : '#f0fff4';
      const borderColor = isRevendedor ? '#ffcc80' : '#a5d6a7';
      const badge = isRevendedor
        ? '<span style="background:#ff9800;color:white;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:500;margin-left:6px;">REVENDEDOR</span>'
        : '<span style="background:#4caf50;color:white;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:500;margin-left:6px;">VENDEDOR</span>';
      li.style.cssText = `background:${bgColor};border-left:3px solid ${borderColor};border-radius:4px;margin-bottom:2px;`;
      li.innerHTML = `
        <div class="file-info">
          <div class="file-name">${nota.emitente_nome || 'Emitente desconhecido'}${badge}</div>
          <div class="file-meta">
            <span>NF-e ${nota.numero || '—'}/${nota.serie || '—'}</span>
            <span>${dataEmissao}</span>
            <span>${valorTotal}</span>
            <span>${nota.quantidade_produtos || 0} produto(s)</span>
            ${isRevendedor ? `<span style="color:#e65100;">↳ dest: ${nota.destinatario_nome || '—'}</span>` : ''}
          </div>
        </div>
        <div class="file-actions">
          <button class="btn btn-secondary" onclick="viewNota('${nota.id}')">Ver</button>
          <button class="btn btn-danger" onclick="deleteNota('${nota.id}')">Excluir</button>
        </div>`;
      fileList.appendChild(li);
    });

    renderPaginacao(pag);

  } catch (e) {
    console.error('Erro ao carregar notas:', e);
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
  }
}

function renderPaginacao(pag) {
  const old = document.getElementById('paginacaoContainer');
  if (old) old.remove();
  if (!pag || !pag.total || pag.total === 0) return;

  const { total, pagina, porPagina, totalPaginas } = pag;
  const inicio = (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  const container = document.createElement('div');
  container.id = 'paginacaoContainer';
  container.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 0 8px;border-top:1px solid #f0f0f0;margin-top:8px;';

  // Info + seletor por página
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;color:#666;';
  infoDiv.innerHTML = `
    <span>Exibindo <strong>${inicio}–${fim}</strong> de <strong>${total}</strong> nota(s)</span>
    <label style="display:flex;align-items:center;gap:6px;">
      Por página:
      <select id="perPageSelect" style="padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;cursor:pointer;">
        ${[10,20,50,100].map(n => `<option value="${n}"${n===porPagina?' selected':''}>${n}</option>`).join('')}
      </select>
    </label>`;

  // Botões de navegação
  const navDiv = document.createElement('div');
  navDiv.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;';

  function criarBtn(texto, disabled, ativo, onClick) {
    const btn = document.createElement('button');
    btn.innerHTML = texto;
    btn.disabled = disabled;
    btn.style.cssText = `padding:5px 10px;border:1px solid ${ativo?'#667eea':'#ddd'};border-radius:6px;font-size:13px;` +
      `cursor:${disabled?'default':'pointer'};background:${ativo?'#667eea':'white'};color:${ativo?'white':disabled?'#ccc':'#555'};min-width:32px;`;
    if (!disabled && onClick) btn.onclick = onClick;
    return btn;
  }

  navDiv.appendChild(criarBtn('«', pagina===1, false, () => loadNotas(paginacaoState.search, 1)));
  navDiv.appendChild(criarBtn('‹', pagina===1, false, () => loadNotas(paginacaoState.search, pagina-1)));

  // Páginas numéricas
  const delta = 2;
  const range = [];
  for (let i = Math.max(1, pagina-delta); i <= Math.min(totalPaginas, pagina+delta); i++) range.push(i);
  if (range[0] > 2) range.unshift('...');
  if (range[0] > 1) range.unshift(1);
  if (range[range.length-1] < totalPaginas-1) range.push('...');
  if (range[range.length-1] < totalPaginas) range.push(totalPaginas);

  range.forEach(p => {
    if (p === '...') {
      const sp = document.createElement('span');
      sp.textContent = '…'; sp.style.cssText = 'padding:0 4px;color:#aaa;font-size:13px;';
      navDiv.appendChild(sp);
    } else {
      navDiv.appendChild(criarBtn(p, false, p===pagina, p===pagina ? null : () => loadNotas(paginacaoState.search, p)));
    }
  });

  navDiv.appendChild(criarBtn('›', pagina===totalPaginas, false, () => loadNotas(paginacaoState.search, pagina+1)));
  navDiv.appendChild(criarBtn('»', pagina===totalPaginas, false, () => loadNotas(paginacaoState.search, totalPaginas)));

  container.append(infoDiv, navDiv);

  const fileList = document.getElementById('fileList');
  if (fileList && fileList.parentNode) fileList.parentNode.insertBefore(container, fileList.nextSibling);

  document.getElementById('perPageSelect')?.addEventListener('change', e => {
    loadNotas(paginacaoState.search, 1, parseInt(e.target.value));
  });
}

async function loadStatistics() {
  if (!currentToken) return;
  try {
    const response = await fetch(`${API}/api/minhas-estatisticas`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (response.status === 401) return;
    const stats = await response.json();
    const fmt = (val) => parseFloat(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const el = (id) => document.getElementById(id);
    if (el('totalXmls')) el('totalXmls').textContent = stats.total_notas || 0;
    if (el('totalValor')) el('totalValor').textContent = fmt(stats.valor_total_notas);
    if (el('totalIcms')) el('totalIcms').textContent = fmt(stats.total_icms);
    if (el('totalEmitentes')) el('totalEmitentes').textContent = stats.total_emitentes_distintos || 0;
  } catch (e) { console.error('Erro estatísticas:', e); }
}

async function viewNota(id) {
  try {
    const response = await fetch(`${API}/api/minha-nota/${id}`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!response.ok) { showToast('Erro ao carregar detalhes', 'error'); return; }
    const nota = await response.json();
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;
    const fmt = (val) => val ? parseFloat(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
    const fmtDT = (val) => { if (!val) return '—'; try { return new Date(val).toLocaleString('pt-BR'); } catch { return val; } };

    let produtosHtml = '';
    if (nota.produtos && nota.produtos.length > 0) {
      produtosHtml = `
        <div style="margin-bottom:20px; padding:15px; background:#f8f9fa; border-radius:8px;">
          <h4 style="margin-bottom:15px; color:#333;">📦 Produtos (${nota.produtos.length})</h4>
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead><tr style="background:#e9ecef;">
                <th style="padding:8px; text-align:left;">#</th>
                <th style="padding:8px; text-align:left;">Código</th>
                <th style="padding:8px; text-align:left;">Descrição</th>
                <th style="padding:8px; text-align:left;">NCM</th>
                <th style="padding:8px; text-align:left;">CFOP</th>
                <th style="padding:8px; text-align:right;">Qtd</th>
                <th style="padding:8px; text-align:right;">Vl Unit</th>
                <th style="padding:8px; text-align:right;">Vl Total</th>
              </tr></thead>
              <tbody>
                ${nota.produtos.map(p => `<tr>
                  <td style="padding:8px;border-bottom:1px solid #eee;">${p.numero_item||'—'}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;">${p.codigo_produto||'—'}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;">${p.descricao||'—'}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;">${p.ncm||'—'}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;">${p.cfop||'—'}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${p.quantidade||0}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(p.valor_unitario)}</td>
                  <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(p.valor_total)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    modalBody.innerHTML = `
      <div style="margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:8px;">
        <h4 style="margin-bottom:15px;color:#333;">📋 Nota Fiscal</h4>
        <div class="info-grid">
          <div class="info-item"><div class="info-label">Chave de Acesso</div><div class="info-value" style="font-size:11px;word-break:break-all;">${nota.chave_acesso||'—'}</div></div>
          <div class="info-item"><div class="info-label">Número / Série</div><div class="info-value">${nota.numero||'—'} / ${nota.serie||'—'}</div></div>
          <div class="info-item"><div class="info-label">Data Emissão</div><div class="info-value">${fmtDT(nota.data_emissao)}</div></div>
          <div class="info-item"><div class="info-label">Natureza Operação</div><div class="info-value">${nota.natureza_operacao||'—'}</div></div>
          <div class="info-item"><div class="info-label">Status</div><div class="info-value">${nota.status||'—'}</div></div>
          <div class="info-item"><div class="info-label">Protocolo</div><div class="info-value">${nota.protocolo_autorizacao||'—'}</div></div>
        </div>
      </div>
      <div style="margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:8px;">
        <h4 style="margin-bottom:15px;color:#333;">🏢 Emitente</h4>
        <div class="info-grid">
          <div class="info-item"><div class="info-label">Razão Social</div><div class="info-value">${nota.emitente_nome||'—'}</div></div>
          <div class="info-item"><div class="info-label">CNPJ</div><div class="info-value">${nota.emitente_cnpj||'—'}</div></div>
          <div class="info-item"><div class="info-label">Inscrição Estadual</div><div class="info-value">${nota.emitente_ie||'—'}</div></div>
        </div>
      </div>
      <div style="margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:8px;">
        <h4 style="margin-bottom:15px;color:#333;">👤 Destinatário</h4>
        <div class="info-grid">
          <div class="info-item"><div class="info-label">Razão Social</div><div class="info-value">${nota.destinatario_nome||'—'}</div></div>
          <div class="info-item"><div class="info-label">CNPJ/CPF</div><div class="info-value">${nota.destinatario_cnpj||'—'}</div></div>
          <div class="info-item"><div class="info-label">Inscrição Estadual</div><div class="info-value">${nota.destinatario_ie||'—'}</div></div>
        </div>
      </div>
      ${produtosHtml}
      ${nota.totais ? `
      <div style="margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:8px;">
        <h4 style="margin-bottom:15px;color:#333;">💰 Totais</h4>
        <div class="info-grid">
          <div class="info-item"><div class="info-label">Base ICMS</div><div class="info-value">${fmt(nota.totais.base_calculo_icms)}</div></div>
          <div class="info-item"><div class="info-label">Valor ICMS</div><div class="info-value">${fmt(nota.totais.valor_icms)}</div></div>
          <div class="info-item"><div class="info-label">Valor IPI</div><div class="info-value">${fmt(nota.totais.valor_ipi)}</div></div>
          <div class="info-item"><div class="info-label">Valor PIS</div><div class="info-value">${fmt(nota.totais.valor_pis)}</div></div>
          <div class="info-item"><div class="info-label">Valor COFINS</div><div class="info-value">${fmt(nota.totais.valor_cofins)}</div></div>
          <div class="info-item" style="grid-column:span 2;background:#e9ecef;">
            <div class="info-label">VALOR TOTAL</div>
            <div class="info-value" style="font-size:18px;font-weight:700;color:#28a745;">${fmt(nota.totais.valor_total_nf)}</div>
          </div>
        </div>
      </div>` : ''}
      <div style="margin-top:20px;text-align:right;font-size:11px;color:#999;">
        ID: ${nota.id} | Importado: ${fmtDT(nota.created_at)}
      </div>`;

    document.getElementById('xmlModal').classList.add('active');
  } catch (e) {
    console.error('Erro ao visualizar nota:', e);
    showToast('Erro ao carregar detalhes', 'error');
  }
}

async function deleteNota(id) {
  if (!confirm('⚠️ Excluir esta nota fiscal permanentemente?')) return;
  try {
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    const response = await fetch(`${API}/api/nota/${id}`, { method: 'DELETE', credentials: 'include', headers });
    const result = await response.json();
    if (result.sucesso) { showToast('✅ Nota fiscal excluída', 'success'); await loadNotas(paginacaoState.search, paginacaoState.pagina); await loadStatistics(); }
    else showToast('❌ Erro ao excluir: ' + (result.erro || 'Erro desconhecido'), 'error');
  } catch (e) { showToast('❌ Erro ao excluir nota fiscal', 'error'); }
}

// ============================================================
// DRAG AND DROP
// ============================================================
async function handleDrop(e) {
  e.preventDefault();
  const uploadArea = document.getElementById('uploadArea');
  if (uploadArea) uploadArea.classList.remove('dragover');
  const items = e.dataTransfer.items;
  const xmlFiles = [];

  function getFileFromEntry(entry) {
    return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  }
  async function readDirectory(dir, list) {
    const reader = dir.createReader();
    const entries = await new Promise((resolve) => reader.readEntries(resolve));
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry);
        if (file && file.name.toLowerCase().endsWith('.xml')) list.push(file);
      } else if (entry.isDirectory) await readDirectory(entry, list);
    }
  }

  if (!items) {
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.xml'));
    if (files.length) processMultipleFiles(files);
    else showToast('Nenhum arquivo XML encontrado', 'warning');
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) {
        if (entry.isFile) { const file = await getFileFromEntry(entry); if (file && file.name.toLowerCase().endsWith('.xml')) xmlFiles.push(file); }
        else if (entry.isDirectory) await readDirectory(entry, xmlFiles);
      }
    }
  }
  if (xmlFiles.length) processMultipleFiles(xmlFiles);
  else showToast('Nenhum arquivo XML encontrado', 'warning');
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const bannerLoginBtn = document.getElementById('bannerLoginBtn');
  if (loginBtn) loginBtn.addEventListener('click', loginWithGoogle);
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  if (bannerLoginBtn) bannerLoginBtn.addEventListener('click', loginWithGoogle);

  // Busca
  const buscaBtn = document.getElementById('buscaBtn');
  const buscaTermo = document.getElementById('buscaTermo');
  const filtroCidade = document.getElementById('filtroCidade');
  const limparFiltrosBtn = document.getElementById('limparFiltrosBtn');

  if (buscaBtn) buscaBtn.addEventListener('click', executarBusca);
  if (buscaTermo) {
    buscaTermo.addEventListener('keydown', (e) => { if (e.key === 'Enter') executarBusca(); });
  }
  if (filtroCidade) {
    filtroCidade.addEventListener('change', () => {
      popularBairros(filtroCidade.value);
    });
  }
  if (limparFiltrosBtn) {
    limparFiltrosBtn.addEventListener('click', () => {
      const buscaTermoEl = document.getElementById('buscaTermo');
      const filtroCidadeEl = document.getElementById('filtroCidade');
      const filtroBairro = document.getElementById('filtroBairro');
      if (buscaTermoEl) buscaTermoEl.value = '';
      if (filtroCidadeEl) { filtroCidadeEl.value = ''; popularBairros(''); }
      if (filtroBairro) filtroBairro.value = '';
      const resultados = document.getElementById('buscaResultados');
      const vazio = document.getElementById('buscaVazio');
      const vazioMsg = document.getElementById('buscaVazioMsg');
      if (resultados) resultados.innerHTML = '';
      if (vazio) vazio.style.display = 'block';
      if (vazioMsg) vazioMsg.textContent = 'Digite um produto acima para buscar vendedores.';
    });
  }

  // Upload
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  if (uploadArea) {
    uploadArea.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', handleDrop);
  }
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.xml'));
        processMultipleFiles(files);
      }
    });
  }

  const selectFilesBtn = document.getElementById('selectFilesBtn');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', () => {
      fileInput.removeAttribute('webkitdirectory');
      fileInput.setAttribute('multiple', 'true');
      fileInput.value = ''; fileInput.click();
    });
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', () => {
      fileInput.setAttribute('webkitdirectory', 'true');
      fileInput.removeAttribute('multiple');
      fileInput.value = ''; fileInput.click();
    });
  }

  // Tabs
  // Perspectiva do importador (emitente = vendedor / revendedor)
  const perspectivaSelect = document.getElementById('perspectivaSelect');
  if (perspectivaSelect) {
    perspectivaSelect.addEventListener('change', (e) => {
      perspectivaPadrao = e.target.value;
      const hint = document.getElementById('perspectivaHint');
      if (hint) {
        if (perspectivaPadrao === 'revendedor') {
          hint.textContent = '🔄 Modo revendedor: o DESTINATÁRIO dos XMLs será catalogado como vendedor nas buscas.';
          hint.style.background = '#fff3e0';
          hint.style.color = '#e65100';
        } else {
          hint.textContent = '✅ Modo padrão: o EMITENTE dos XMLs será catalogado como vendedor nas buscas.';
          hint.style.background = '#e8f5e9';
          hint.style.color = '#2e7d32';
        }
      }
    });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Busca
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', debounce(() => loadNotas(searchInput.value, 1), 300));
}

// ============================================================
// UI HELPERS
// ============================================================
function closeModal() { document.getElementById('xmlModal').classList.remove('active'); }

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => { c.style.display = 'none'; });
  const el = document.getElementById(tabName + 'Tab');
  if (el) el.style.display = 'block';
  if (tabName === 'arquivos') loadNotas();
  else if (tabName === 'estatisticas') loadStatistics();
}

function showToast(message, type = 'info', duration = 4000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}

function debounce(func, wait) {
  let timeout;
  return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); };
}

// Globais
window.viewNota = viewNota;
window.deleteNota = deleteNota;
window.closeModal = closeModal;
window.loginWithGoogle = loginWithGoogle;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
