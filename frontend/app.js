// frontend/app.js — xmlAnalise Frontend

const API = window.location.origin;

let supabaseClient = null;
let currentUser = null;
let currentToken = null;
let perspectivaPadrao = 'emitente'; // 'consumidor' | 'emitente' | 'revendedor'
let configCache = null;
let userIsAdmin = false;

// Dados dos filtros e busca
let todosOsBairros = [];
let baseFiltrosGlobal = { cidades: [], bairros: [] };
let filtrosEncontradosNaBusca = { cidades: [], bairros: [] }; // Persiste os locais encontrados no termo atual
let resultadosBuscaAtuais = [];
let inactivityTimeout;
const INACTIVITY_TIME = 30 * 60 * 1000; // 30 minutos

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
        storage: window.localStorage,
        flowType: 'pkce'
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

  // 1. Setup imediato de eventos (não bloqueia UI)
  setupEventListeners();
  setupNcmAutocomplete();

  // 2. Carrega dados essenciais com retry (Render pode estar dormindo)
  await carregarFiltrosComRetry();
  await carregarEstatisticasComRetry();

  // 3. Inicializa Supabase e Auth
  try {
    const supabaseReady = await initSupabase();
    if (!supabaseReady) {
      showToast('Modo offline/visitante ativo', 'info');
      showAnonymousUser();
    } else {
      await initAuth();
    }
    resetInactivityTimer();
  } catch (e) {
    console.error('Erro na inicialização do Auth:', e);
    showAnonymousUser();
  }
});

// Retry wrapper genérico para APIs que podem falhar com 503 (Render cold start)
async function fetchComRetry(url, tentativas = 3, intervaloMs = 3000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 503 && i < tentativas - 1) {
        console.warn(`⏳ Servidor dormindo (503), tentativa ${i + 2}/${tentativas} em ${intervaloMs / 1000}s...`);
        await new Promise(r => setTimeout(r, intervaloMs));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i < tentativas - 1) {
        console.warn(`⏳ Falha na requisição (${e.message}), tentativa ${i + 2}/${tentativas}...`);
        await new Promise(r => setTimeout(r, intervaloMs));
      } else {
        throw e;
      }
    }
  }
}

async function carregarFiltrosComRetry() {
  try {
    await carregarFiltros();
  } catch (e) {
    console.error('❌ Erro final carregando filtros:', e);
  }
}

async function carregarEstatisticasComRetry() {
  try {
    await carregarEstatisticasGerais();
  } catch (e) {
    console.error('❌ Erro final carregando estatísticas:', e);
  }
}

// ============================================================
// AUTENTICAÇÃO E PERMISSÕES
// ============================================================
async function verificarAdmin() {
  if (!currentToken) {
    userIsAdmin = false;
    return;
  }
  try {
    const res = await fetch(`${API}/api/debug-sessao`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    userIsAdmin = data.userInfo?.isAdmin || false;
    console.log('👑 Admin status:', userIsAdmin);
  } catch (e) {
    userIsAdmin = false;
  }
}

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
      await verificarAdmin();
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
      console.log('✅ Evento SIGNED_IN detectado:', session.user.email);
      currentUser = session.user;
      currentToken = session.access_token;
      await verificarAdmin();
      showUserLoggedIn(session.user);
      const sessionId = getAnonymousSessionId();
      if (sessionId) await migrarDadosAnonimos(sessionId);
      showToast('Login realizado com sucesso! 🎉', 'success');
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentToken = null;
      userIsAdmin = false;
      showAnonymousUser();
      showToast('Logout realizado', 'success');
    } else if (event === 'TOKEN_REFRESHED' && session) {
      currentToken = session.access_token;
      await verificarAdmin();
    }
  });
}

function getAnonymousSessionId() {
  const match = document.cookie.match(/anonymousSessionId=([^;]+)/);
  return match ? match[1] : null;
}

async function loginWithGoogle() {
  console.log('🚀 Iniciando redirecionamento para o Google...');
  showToast('Iniciando login com Google...', 'info');

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      }
    }
  });

  if (error) {
    console.error('❌ Erro no login Google:', error);
    showToast('Erro ao iniciar login: ' + error.message, 'error');
  }
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

  // Novos elementos Desktop
  const desktopLoginBtn = document.getElementById('desktopLoginBtn');
  const desktopLogoutBtn = document.getElementById('desktopLogoutBtn');
  const desktopUserInfo = document.getElementById('desktopUserInfo');
  const desktopUserName = document.getElementById('desktopUserName');
  const desktopAvatar = document.getElementById('desktopAvatar');

  if (desktopLoginBtn) desktopLoginBtn.style.display = 'none';
  if (desktopLogoutBtn) desktopLogoutBtn.style.display = 'inline-flex';
  if (desktopUserInfo) desktopUserInfo.style.display = 'flex';
  if (desktopUserName) desktopUserName.textContent = nome;
  if (desktopAvatar) {
    if (avatar) {
      desktopAvatar.innerHTML = `<img src="${avatar}" alt="${nome}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`;
    } else {
      desktopAvatar.textContent = nome.charAt(0).toUpperCase();
      desktopAvatar.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
      desktopAvatar.style.color = 'white';
    }
  }

  // Novos elementos Sidebar
  const sidebarLoginBtn = document.getElementById('sidebarLoginBtn');
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserStatus = document.getElementById('sidebarUserStatus');
  const sidebarAvatar = document.getElementById('sidebarAvatar');

  if (sidebarLoginBtn) sidebarLoginBtn.style.display = 'none';
  if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = 'inline-flex';
  if (sidebarUserName) sidebarUserName.textContent = nome;
  if (sidebarUserStatus) sidebarUserStatus.textContent = 'Conectado';
  if (sidebarAvatar) {
    if (avatar) {
      sidebarAvatar.innerHTML = `<img src="${avatar}" alt="${nome}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
    } else {
      sidebarAvatar.textContent = nome.charAt(0).toUpperCase();
    }
  }

  const banner = document.getElementById('loginBanner');
  if (banner) banner.style.display = 'none';

  // Badge Admin se necessário
  if (userIsAdmin) {
    if (sidebarUserStatus) sidebarUserStatus.innerHTML = '<span class="badge-user" style="background:#764ba2;">Administrador</span>';
    if (desktopUserName) desktopUserName.innerHTML = `${nome} <span class="badge-user" style="background:#764ba2; font-size:10px; padding:2px 8px;">ADMIN</span>`;
  }
}

function showAnonymousUser() {
  // Novos elementos Desktop
  const desktopLoginBtn = document.getElementById('desktopLoginBtn');
  const desktopLogoutBtn = document.getElementById('desktopLogoutBtn');
  const desktopUserInfo = document.getElementById('desktopUserInfo');
  if (desktopLoginBtn) desktopLoginBtn.style.display = 'inline-flex';
  if (desktopLogoutBtn) desktopLogoutBtn.style.display = 'none';
  if (desktopUserInfo) desktopUserInfo.style.display = 'none';

  // Novos elementos Sidebar
  const sidebarLoginBtn = document.getElementById('sidebarLoginBtn');
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserStatus = document.getElementById('sidebarUserStatus');
  const sidebarAvatar = document.getElementById('sidebarAvatar');

  if (sidebarLoginBtn) sidebarLoginBtn.style.display = 'inline-flex';
  if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = 'none';
  if (sidebarUserName) sidebarUserName.textContent = 'Visitante';
  if (sidebarUserStatus) sidebarUserStatus.textContent = 'Não logado';
  if (sidebarAvatar) sidebarAvatar.textContent = '👤';

  const banner = document.getElementById('loginBanner');
  if (banner) banner.style.display = 'block';
}

// ============================================================
// FILTROS E BUSCA DINÂMICA
// ============================================================
async function carregarFiltros() {
  console.log('📡 Buscando filtros base do servidor...');
  const data = await fetchComRetry(`${API}/api/filtros-vendedores`);
  console.log('📦 Dados de filtros recebidos:', data);

  if (!data || !data.sucesso) {
    console.warn('Backend retornou erro nos filtros:', data?.erro);
    return;
  }

  baseFiltrosGlobal.cidades = data.cidades || [];
  baseFiltrosGlobal.bairros = data.bairros || [];

  console.log(`✅ Base global: ${baseFiltrosGlobal.cidades.length} cidades, ${baseFiltrosGlobal.bairros.length} bairros`);

  repopularSelects(baseFiltrosGlobal.cidades, baseFiltrosGlobal.bairros, false);
  detectarLocalizacaoUsuario();
}

function repopularSelects(cidades, bairros, manterSelecao = true) {
  const selectCidade = document.getElementById('filtroCidade');
  if (!selectCidade) return;

  const cidadeAtual = selectCidade.value;
  selectCidade.innerHTML = '<option value="">📍 Todas as cidades</option>';

  // Cidades únicas ordenadas
  const cidadesUnicas = [...new Map(cidades.map(c => [c.municipio, c])).values()]
    .sort((a, b) => a.municipio.localeCompare(b.municipio));

  cidadesUnicas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.municipio;
    opt.textContent = `${c.municipio} — ${c.uf}`;
    selectCidade.appendChild(opt);
  });

  if (manterSelecao) selectCidade.value = cidadeAtual;
  popularBairros(selectCidade.value, bairros);
}

function popularBairros(cidadeFiltro, listaBairros = null) {
  const selectBairro = document.getElementById('filtroBairro');
  if (!selectBairro) return;

  const valorAtual = selectBairro.value;
  selectBairro.innerHTML = '<option value="">🏘️ Todos os bairros</option>';

  // Se não passou lista, usa a base global ou a encontrada na busca
  const fonte = listaBairros || (filtrosEncontradosNaBusca.bairros.length > 0 ? filtrosEncontradosNaBusca.bairros : baseFiltrosGlobal.bairros);

  const filtrados = cidadeFiltro
    ? fonte.filter(b => b.municipio === cidadeFiltro)
    : fonte;

  const bairrosUnicos = [...new Set(filtrados.map(b => b.bairro))].sort();

  bairrosUnicos.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    selectBairro.appendChild(opt);
  });

  if (valorAtual && [...selectBairro.options].some(o => o.value === valorAtual)) {
    selectBairro.value = valorAtual;
  }
}

async function detectarLocalizacaoUsuario() {
  console.log('📍 Detectando localização...');
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        const cidade = data.address.city || data.address.town || data.address.village;
        console.log('🏙️ Cidade detectada por GPS:', cidade);
        if (cidade) selecionarCidadeNosFiltros(cidade);
      } catch (e) {
        console.warn('Falha reverse geocode, tentando IP');
        tentarLocalizacaoPorIP();
      }
    }, (err) => {
      console.warn('GPS negado ou falhou:', err.message);
      tentarLocalizacaoPorIP();
    }, { timeout: 8000, enableHighAccuracy: true });
  } else {
    tentarLocalizacaoPorIP();
  }
}

async function tentarLocalizacaoPorIP() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    if (data.city) selecionarCidadeNosFiltros(data.city);
  } catch (e) { }
}

function selecionarCidadeNosFiltros(nomeCidade) {
  const selectCidade = document.getElementById('filtroCidade');
  if (!selectCidade || !nomeCidade) return;

  // Normaliza removendo acentos, convertendo para uppercase e removendo espaços extras
  function normalizar(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  }

  const cidadeNorm = normalizar(nomeCidade);
  console.log(`📍 Procurando "${nomeCidade}" (normalizado: "${cidadeNorm}") em ${selectCidade.options.length} opções`);

  let encontrada = false;
  for (let i = 1; i < selectCidade.options.length; i++) { // pula index 0 ("Todas as cidades")
    const optValue = normalizar(selectCidade.options[i].value);
    const optText = normalizar(selectCidade.options[i].textContent);

    if (optValue === cidadeNorm || optText.startsWith(cidadeNorm) || cidadeNorm === optValue.split(' - ')[0] || cidadeNorm === optValue.split(' — ')[0]) {
      selectCidade.selectedIndex = i;
      selectCidade.dispatchEvent(new Event('change'));
      encontrada = true;
      showToast(`📍 ${nomeCidade} detectada e selecionada!`, 'success');
      console.log(`✅ Cidade auto-selecionada: ${selectCidade.options[i].textContent}`);
      break;
    }
  }

  if (!encontrada) {
    showToast(`📍 Localização detectada: ${nomeCidade} (não disponível nos filtros)`, 'info');
    console.log(`ℹ️ Cidade "${nomeCidade}" (${cidadeNorm}) não encontrada nas opções disponíveis.`);
  }
}

async function executarBusca() {
  const termo = document.getElementById('buscaTermo')?.value?.trim();
  const cidade = document.getElementById('filtroCidade')?.value;
  const bairro = document.getElementById('filtroBairro')?.value;
  const ncm = document.getElementById('filtroNcm')?.value?.trim();

  const loading = document.getElementById('buscaLoading');
  const vazio = document.getElementById('buscaVazio');
  const resultadosDiv = document.getElementById('buscaResultados');
  const vazioMsg = document.getElementById('buscaVazioMsg');

  // Se não houver termo E não houver nenhum filtro, avisa
  if (!termo && !cidade && !bairro && !ncm) {
    showToast('Digite um termo ou use os filtros para buscar', 'warning');
    return;
  }

  // Se houver termo, valida 3 caracteres (a menos que haja outros filtros)
  if (termo && termo.length < 3 && !cidade && !bairro && !ncm) {
    showToast('Digite pelo menos 3 caracteres para buscar', 'warning');
    return;
  }

  if (loading) loading.style.display = 'block';
  if (vazio) vazio.style.display = 'none';
  if (resultadosDiv) resultadosDiv.innerHTML = '';

  try {
    const params = new URLSearchParams();
    if (termo) params.append('termo', termo);
    if (cidade) params.append('cidade', cidade);
    if (bairro) params.append('bairro', bairro);
    if (ncm) params.append('ncm', ncm);

    const res = await fetch(`${API}/api/buscar-produtos?${params}`);
    const data = await res.json();

    if (loading) loading.style.display = 'none';

    if (!data.sucesso || !data.resultados || data.resultados.length === 0) {
      if (vazio) vazio.style.display = 'block';
      if (vazioMsg) vazioMsg.textContent = `Nenhum vendedor encontrado para os critérios informados.`;
      resultadosBuscaAtuais = [];
      return;
    }

    resultadosBuscaAtuais = data.resultados;
    renderizarResultados(data.resultados, termo || '');
    renderContributeInvite();
    resetInactivityTimer();

    // PERSISTÊNCIA: Extrai e guarda os filtros se for uma nova busca por termo
    const extraidos = extrairFiltrosDeResultados(data.resultados);
    if (!cidade && !bairro) {
      filtrosEncontradosNaBusca = extraidos;
    } else if (filtrosEncontradosNaBusca.cidades.length === 0) {
      filtrosEncontradosNaBusca = extraidos;
    }

    // Bugfix: Sempre usamos a lista GLOBAL de cidades para evitar que a lista encolha 
    // após uma auto-seleção ou busca específica, conforme solicitado pelo usuário.
    repopularSelects(baseFiltrosGlobal.cidades, filtrosEncontradosNaBusca.bairros, true);

  } catch (e) {
    if (loading) loading.style.display = 'none';
    showToast('Erro na busca', 'error');
  }
}

function extrairFiltrosDeResultados(resultados) {
  const cidades = [];
  const bairros = [];
  resultados.forEach(r => {
    const v = r.vendedor;
    if (v.cidade) cidades.push({ municipio: v.cidade, uf: v.uf });
    if (v.bairro) bairros.push({ municipio: v.cidade, bairro: v.bairro });
  });
  return { cidades, bairros };
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
    const localizacao = [v.cidade, v.uf].filter(Boolean).join(' — ');

    const produtosHtml = item.produtos.slice(0, 5).map(p => {
      const ncmHtml = p.ncm
        ? `<span onclick="setNcmFilter('${p.ncm}')" style="cursor:pointer; color:#667eea; text-decoration:underline; margin-left:4px; font-weight:600;" title="Clique para filtrar por este NCM">#${p.ncm}</span>`
        : '';
      return `
        <span style="display:inline-block; background:#e8f0fe; color:#3c5fb5; border-radius:20px;
                    padding:3px 10px; font-size:12px; margin:2px;">
          ${p.cean ? `<strong>${p.cean}</strong> · ` : ''}${p.descricao || ''}${ncmHtml}
        </span>
      `;
    }).join('');

    const maisHtml = item.produtos.length > 5
      ? `<span style="font-size:12px; color:#888; margin-left:4px;">+${item.produtos.length - 5} produto(s)</span>`
      : '';

    const telHtml = v.telefone
      ? `<a href="tel:${v.telefone}" style="color:#667eea; text-decoration:none;">📞 ${v.telefone}</a>`
      : '<span style="color:#bbb;">Telefone não disponível</span>';

    const enderecoQuery = [v.logradouro, v.numero, v.bairro, v.cidade, v.uf, 'Brasil'].filter(Boolean).join(', ');
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoQuery)}`;
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

// ============================================================
// AUTOCOMPLETE NCM
// ============================================================
function setupNcmAutocomplete() {
  const inputNcm = document.getElementById('filtroNcm');
  const sugestoesCont = document.getElementById('ncmSugestoes');

  if (!inputNcm || !sugestoesCont) return;

  let timeout = null;

  inputNcm.addEventListener('input', () => {
    clearTimeout(timeout);
    const q = inputNcm.value.trim();

    if (q.length < 2) {
      sugestoesCont.style.display = 'none';
      return;
    }

    timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/ncm/autocomplete?q=${encodeURIComponent(q)}`);
        const result = await res.json();

        if (result.sucesso && result.data.length > 0) {
          sugestoesCont.innerHTML = result.data.map(item => `
            <div class="ncm-sugestao-item" data-codigo="${item.codigo}">
              <strong>${item.codigo}</strong> ${item.descricao}
            </div>
          `).join('');
          sugestoesCont.style.display = 'block';

          sugestoesCont.querySelectorAll('.ncm-sugestao-item').forEach(el => {
            el.addEventListener('click', () => {
              inputNcm.value = el.dataset.codigo;
              sugestoesCont.style.display = 'none';
            });
          });
        } else {
          sugestoesCont.style.display = 'none';
        }
      } catch (e) {
        console.error('Erro NCM autocomplete:', e);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (e.target !== inputNcm && e.target !== sugestoesCont) {
      sugestoesCont.style.display = 'none';
    }
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
// UPLOAD E NOTAS
// ============================================================
function mostrarConfirmacaoUpload(files) {
  if (!files || files.length === 0) return;

  const anterior = document.getElementById('confirmacaoUpload');
  if (anterior) anterior.remove();

  const nomes = {
    consumidor: { label: '🛒 Sou COMPRADOR', desc: 'Recebi estes XMLs nas minhas compras.' },
    emitente: { label: '🏪 Sou VENDEDOR', desc: 'Estes XMLs são das minhas vendas.' },
    revendedor: { label: '🔄 Sou REVENDEDOR', desc: 'Comprei estes produtos para revender.' }
  };

  const dialog = document.createElement('div');
  dialog.id = 'confirmacaoUpload';
  dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;`;

  dialog.innerHTML = `
    <div style="background:white; border-radius:16px; padding:28px; max-width:480px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:20px; font-weight:700; color:#222; margin-bottom:6px;">📂 ${files.length} arquivo(s) prontos</div>
      <div style="font-size:13px; color:#888; margin-bottom:20px;">Como você se relaciona com estes documentos?</div>
      <div id="opcoesRole" style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
        ${['consumidor', 'emitente', 'revendedor'].map(val => `
          <label id="label_${val}" style="display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border:2px solid ${val === 'consumidor' ? '#667eea' : '#e9ecef'}; border-radius:10px; cursor:pointer; background:${val === 'consumidor' ? '#f0f2ff' : 'white'}; transition:all 0.15s;">
            <input type="radio" name="roleUpload" value="${val}" ${val === 'consumidor' ? 'checked' : ''} style="margin-top:3px; accent-color:#667eea; width:16px; height:16px; flex-shrink:0;">
            <div>
              <div style="font-weight:600; font-size:14px; color:#222;">${nomes[val].label}</div>
              <div style="font-size:12px; color:#666; margin-top:2px;">${nomes[val].desc}</div>
            </div>
          </label>`).join('')}
      </div>
      <div style="display:flex; gap:10px;">
        <button id="btnCancelarUpload" style="flex:1; padding:12px; border:1px solid #ddd; border-radius:8px; background:white; color:#666; font-size:14px; cursor:pointer;">Cancelar</button>
        <button id="btnConfirmarUpload" style="flex:2; padding:12px; border:none; border-radius:8px; background:#667eea; color:white; font-size:14px; font-weight:600; cursor:pointer;">Importar</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.querySelectorAll('input[name="roleUpload"]').forEach(radio => {
    radio.addEventListener('change', () => {
      ['consumidor', 'emitente', 'revendedor'].forEach(v => {
        const lbl = document.getElementById('label_' + v);
        const sel = v === radio.value;
        lbl.style.borderColor = sel ? '#667eea' : '#e9ecef';
        lbl.style.background = sel ? '#f0f2ff' : 'white';
      });
    });
  });

  document.getElementById('btnCancelarUpload').onclick = () => dialog.remove();
  document.getElementById('btnConfirmarUpload').onclick = () => {
    perspectivaPadrao = dialog.querySelector('input[name="roleUpload"]:checked').value;
    dialog.remove();
    executarUpload(files);
  };
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const uploadArea = document.getElementById('uploadArea');
  if (uploadArea) uploadArea.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xml'));
  if (files.length > 0) {
    processMultipleFiles(files);
  } else {
    showToast('Nenhum arquivo XML encontrado', 'error');
  }
}

async function processMultipleFiles(files) {
  if (!files || files.length === 0) return;
  mostrarConfirmacaoUpload(files);
}

async function executarUpload(files) {
  const uploadArea = document.getElementById('uploadArea');
  const uploadProgress = document.getElementById('uploadProgress');
  if (uploadArea) uploadArea.classList.add('loading-upload');
  
  const totalFiles = files.length;
  let successCount = 0, errorCount = 0, duplicateCount = 0, totalProducts = 0;
  const details = [];

  if (uploadProgress) { 
    uploadProgress.style.display = 'block'; 
    uploadProgress.textContent = `Iniciando processamento de ${totalFiles} arquivos...`; 
  }

  for (let i = 0; i < totalFiles; i++) {
    const file = files[i];
    if (uploadProgress) {
      uploadProgress.textContent = `Processando ${i + 1} de ${totalFiles}: ${file.name}...`;
    }

    try {
      const result = await uploadXML(file);
      if (result.sucesso) {
        successCount++;
        totalProducts += (result.quantidade_produtos || 0);
        details.push({ name: file.name, status: 'success', message: `${result.quantidade_produtos || 0} produtos` });
      } else if (result.duplicado) {
        duplicateCount++;
        details.push({ name: file.name, status: 'duplicate', message: 'Já importado' });
      } else {
        errorCount++;
        details.push({ name: file.name, status: 'error', message: result.erro || 'Erro desconhecido' });
      }
    } catch (e) { 
      errorCount++; 
      details.push({ name: file.name, status: 'error', message: e.message });
    }
  }

  if (uploadArea) uploadArea.classList.remove('loading-upload');
  if (uploadProgress) uploadProgress.style.display = 'none';

  // Mostra o resumo detalhado
  showImportSummary({
    title: 'Resumo da Importação XML',
    total: totalFiles,
    success: successCount,
    duplicates: duplicateCount,
    errors: errorCount,
    totalProducts: totalProducts,
    details: details
  });

  if (successCount > 0) {
    await loadNotas();
    await loadStatistics();
    await carregarFiltros();
  }
}

function showImportSummary(summary) {
  const modal = document.getElementById('xmlModal');
  const modalBody = document.getElementById('modalBody');
  const modalTitle = modal.querySelector('h3');
  
  if (!modal || !modalBody) return;

  modalTitle.textContent = summary.title || 'Resumo da Importação';
  
  let html = `
    <div style="padding: 10px 0;">
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; background: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div style="text-align: center;">
          <div style="font-size: 20px; font-weight: 800; color: #1e293b;">${summary.total}</div>
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600;">Total</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 20px; font-weight: 800; color: #22c55e;">${summary.success}</div>
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600;">Sucesso</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 20px; font-weight: 800; color: #eab308;">${summary.duplicates}</div>
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600;">Ignorados</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 20px; font-weight: 800; color: #ef4444;">${summary.errors}</div>
          <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600;">Erros</div>
        </div>
      </div>

      ${summary.totalProducts ? `
      <div style="margin-bottom: 20px; padding: 12px; background: #f0f9ff; border-radius: 10px; border: 1px solid #bae6fd; display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 24px;">📦</div>
        <div>
          <div style="font-weight: 700; color: #0369a1;">${summary.totalProducts} produtos mapeados</div>
          <div style="font-size: 12px; color: #0ea5e9;">Estes itens já estão disponíveis para busca.</div>
        </div>
      </div>
      ` : ''}

      <div style="text-align: left; max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: white;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead style="background: #f1f5f9; position: sticky; top: 0;">
            <tr>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #e2e8f0;">Item / Arquivo</th>
              <th style="padding: 10px; text-align: center; border-bottom: 1px solid #e2e8f0;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${summary.details.map(d => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px;">
                  <div style="font-weight: 600; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${d.name}">${d.name}</div>
                  <div style="font-size: 11px; color: #94a3b8;">${d.message || ''}</div>
                </td>
                <td style="padding: 10px; text-align: center;">
                  ${d.status === 'success' ? '<span style="color: #22c55e; background: #f0fdf4; padding: 4px 8px; border-radius: 20px; font-weight: 700;">✅ OK</span>' : 
                    d.status === 'duplicate' ? '<span style="color: #eab308; background: #fefce8; padding: 4px 8px; border-radius: 20px; font-weight: 700;">⚠️ DUPLICADO</span>' : 
                    '<span style="color: #ef4444; background: #fef2f2; padding: 4px 8px; border-radius: 20px; font-weight: 700;">❌ ERRO</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-top: 24px; display: flex; gap: 12px;">
        <button class="btn btn-primary" onclick="closeModal()" style="flex: 1; padding: 12px; font-weight: 700;">Entendido</button>
      </div>
    </div>
  `;

  modalBody.innerHTML = html;
  modal.classList.add('active');
}

async function uploadXML(file) {
  const formData = new FormData();
  formData.append('xml', file);

  // Mapeia a perspectiva selecionada para o backend
  // perspectivaPadrao pode ser 'consumidor', 'emitente' ou 'revendedor'
  formData.append('perspectiva', perspectivaPadrao);

  const headers = {};
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const response = await fetch(`${API}/api/processar-xml`, {
    method: 'POST', credentials: 'include', headers, body: formData
  });
  const result = await response.json();
  return result;
}

let paginacaoState = { pagina: 1, porPagina: 50, total: 0, totalPaginas: 0, search: '' };

async function loadNotas(search = '', pagina = 1, porPagina = null) {
  const fileList = document.getElementById('fileList');
  if (!fileList) return;
  if (porPagina !== null) paginacaoState.porPagina = porPagina;
  paginacaoState.pagina = pagina;
  paginacaoState.search = search;

  fileList.innerHTML = '<p style="padding:20px;text-align:center;color:#666;">Carregando...</p>';

  if (!currentToken) {
    fileList.innerHTML = '';
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  try {
    const params = new URLSearchParams({ page: paginacaoState.pagina, perPage: paginacaoState.porPagina });
    if (search) params.append('search', search);

    const response = await fetch(`${API}/api/minhas-notas?${params}`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await response.json();
    fileList.innerHTML = '';

    const notas = data.notas || [];
    if (notas.length === 0) {
      const emptyState = document.getElementById('emptyState');
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    notas.forEach(nota => {
      const li = document.createElement('li');
      li.className = 'file-item-modern';
      const valorTotal = nota.valor_total_nf || nota.valor_total_nota || 0;
      li.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600;color:#1a1f36;">${nota.emitente_nome || 'Emitente'}</div>
          <div style="font-size:12px;color:#6b7280;">NF-e ${nota.numero} | ${new Date(nota.data_emissao).toLocaleDateString('pt-BR')} | R$ ${parseFloat(valorTotal).toLocaleString('pt-BR')}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline" onclick="viewNota('${nota.id}')" style="padding:6px 12px;font-size:12px;">Ver</button>
          <button class="btn btn-outline" onclick="deleteNota('${nota.id}')" style="padding:6px 12px;font-size:12px;color:#dc3545;">Excluir</button>
        </div>`;
      fileList.appendChild(li);
    });

    renderPaginacao(data.paginacao);

  } catch (e) {
    console.error('Erro ao carregar notas:', e);
  }
}

async function carregarEstatisticasGerais() {
  const container = document.getElementById('globalStats');
  if (!container) {
    console.warn('Container #globalStats não encontrado');
    return;
  }
  console.log('📊 Buscando estatísticas gerais...');
  const data = await fetchComRetry(`${API}/api/estatisticas-gerais`);
  console.log('📊 Dados estatísticas:', data);

  if (data && data.sucesso) {
    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px; margin-bottom: 24px;">
        <div style="background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-left: 4px solid #667eea;">
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 8px;">📦 Produtos Mapeados</div>
          <div style="font-size: 26px; font-weight: 800; color: #1a1f36;">${(data.total_produtos || 0).toLocaleString('pt-BR')}</div>
        </div>
        <div style="background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-left: 4px solid #764ba2;">
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 8px;">🏢 Fornecedores</div>
          <div style="font-size: 26px; font-weight: 800; color: #1a1f36;">${(data.total_fornecedores || 0).toLocaleString('pt-BR')}</div>
        </div>
        <div style="background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-left: 4px solid #4caf50;">
          <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 8px;">🌎 Cidades Atendidas</div>
          <div style="font-size: 26px; font-weight: 800; color: #1a1f36;">${(data.total_cidades || 0).toLocaleString('pt-BR')}</div>
        </div>
      </div>`;
  } else {
    console.warn('Estatísticas falharam:', data?.erro);
  }
}

function renderPaginacao(pag) {
  const old = document.getElementById('paginacaoContainer');
  if (old) old.remove();
  if (!pag || pag.totalPaginas <= 1) return;
  const container = document.createElement('div');
  container.id = 'paginacaoContainer';
  container.style.cssText = 'display:flex;justify-content:center;gap:8px;padding:20px 0;';
  for (let i = 1; i <= pag.totalPaginas; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = `btn ${i === pag.pagina ? 'btn-primary' : 'btn-outline'}`;
    btn.style.padding = '4px 10px';
    btn.onclick = () => loadNotas(paginacaoState.search, i);
    container.appendChild(btn);
  }
  document.getElementById('fileList').after(container);
}

async function loadStatistics() {
  if (!currentToken) return;
  try {
    const response = await fetch(`${API}/api/minhas-estatisticas`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const stats = await response.json();
    const fmt = (val) => parseFloat(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (document.getElementById('totalXmls')) document.getElementById('totalXmls').textContent = stats.total_notas || 0;
    if (document.getElementById('totalValor')) document.getElementById('totalValor').textContent = fmt(stats.valor_total_notas);
    if (document.getElementById('totalIcms')) document.getElementById('totalIcms').textContent = fmt(stats.total_icms);
    if (document.getElementById('totalEmitentes')) document.getElementById('totalEmitentes').textContent = stats.total_emitentes_distintos || 0;
  } catch (e) { }
}

async function viewNota(id) {
  try {
    const response = await fetch(`${API}/api/minha-nota/${id}`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const nota = await response.json();
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;
    modalBody.innerHTML = `<pre style="font-size:12px;background:#f8fafc;padding:15px;border-radius:12px;overflow:auto;max-height:400px;">${JSON.stringify(nota, null, 2)}</pre>`;
    document.getElementById('xmlModal').classList.add('active');
  } catch (e) { showToast('Erro ao carregar detalhes', 'error'); }
}

async function deleteNota(id) {
  if (!confirm('Excluir esta nota?')) return;
  try {
    await fetch(`${API}/api/nota/${id}`, { method: 'DELETE', credentials: 'include', headers: { 'Authorization': `Bearer ${currentToken}` } });
    showToast('Nota excluída', 'success');
    loadNotas(paginacaoState.search, paginacaoState.pagina);
    loadStatistics();
  } catch (e) { }
}

function setupEventListeners() {
  const loginBtns = [document.getElementById('desktopLoginBtn'), document.getElementById('sidebarLoginBtn'), document.getElementById('bannerLoginBtn')];
  const logoutBtns = [document.getElementById('desktopLogoutBtn'), document.getElementById('sidebarLogoutBtn')];

  loginBtns.forEach(btn => btn?.addEventListener('click', loginWithGoogle));
  logoutBtns.forEach(btn => btn?.addEventListener('click', logout));

  document.getElementById('buscaBtn')?.addEventListener('click', executarBusca);
  document.getElementById('buscaTermo')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') executarBusca(); });
  document.getElementById('filtroCidade')?.addEventListener('change', (e) => {
    popularBairros(e.target.value);
    // Removida a busca automática para evitar execução sem termo definido
  });
  document.getElementById('filtroBairro')?.addEventListener('change', executarBusca);
  document.getElementById('limparFiltrosBtn')?.addEventListener('click', () => {
    document.getElementById('buscaTermo').value = '';
    document.getElementById('filtroCidade').value = '';
    document.getElementById('filtroBairro').value = '';
    document.getElementById('filtroNcm').value = '';

    // Reset da persistência inteligente
    filtrosEncontradosNaBusca = { cidades: [], bairros: [] };
    resultadosBuscaAtuais = [];

    // Repopula com a base global original
    repopularSelects(baseFiltrosGlobal.cidades, baseFiltrosGlobal.bairros, false);

    // Limpa resultados visuais
    const resultadosDiv = document.getElementById('buscaResultados');
    if (resultadosDiv) resultadosDiv.innerHTML = '';

    const vazio = document.getElementById('buscaVazio');
    if (vazio) {
      vazio.style.display = 'block';
      const vazioMsg = document.getElementById('buscaVazioMsg');
      if (vazioMsg) vazioMsg.textContent = 'Digite um produto acima para buscar vendedores.';
    }

    showToast('Filtros limpos', 'info');
  });

  try {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    if (uploadArea && fileInput) {
      uploadArea.addEventListener('click', () => fileInput.click());
      uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
      uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
      uploadArea.addEventListener('drop', handleDrop);
    }
    fileInput?.addEventListener('change', (e) => processMultipleFiles(Array.from(e.target.files)));

    document.getElementById('selectFilesBtn')?.addEventListener('click', () => { fileInput.webkitdirectory = false; fileInput.multiple = true; fileInput.click(); });
    document.getElementById('selectFolderBtn')?.addEventListener('click', () => { fileInput.webkitdirectory = true; fileInput.click(); });
  } catch (e) {
    console.error('Erro configurando upload:', e);
  }

  // === SIDEBAR MOBILE ===
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    console.log('✅ Menu toggle e sidebar encontrados');

    // Usar tanto click quanto touchend para garantir funcionamento mobile
    function toggleSidebar(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      sidebar.classList.toggle('open');
      console.log('🖱️ Sidebar toggled:', sidebar.classList.contains('open'));
    }

    menuToggle.addEventListener('click', toggleSidebar, { passive: false });
    menuToggle.addEventListener('touchend', toggleSidebar, { passive: false });
  } else {
    console.error('❌ Elementos de menu não encontrados:', { menuToggle, sidebar });
  }

  // Fechar sidebar ao clicar/tocar fora no mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar && menuToggle) {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      document.getElementById(tab + 'Tab').style.display = 'block';
      if (tab === 'arquivos') loadNotas();
      if (tab === 'estatisticas') loadStatistics();
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    });
  });


  setupManualForm();
  setupSpreadsheetImport();

  document.getElementById('searchInput')?.addEventListener('input', debounce((e) => loadNotas(e.target.value, 1), 300));

  // Inicializa autenticação para verificar se retornou do login social
  initAuth();

  // Carrega estatísticas gerais do dashboard ao iniciar
  carregarEstatisticasGerais();

  // Reset timer em eventos globais
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(name => {
    document.addEventListener(name, resetInactivityTimer, true);
  });
}

// ============================================================
// INCLUSÃO MANUAL
// ============================================================
function setupManualForm() {
  const form = document.getElementById('manualForm');
  if (!form) return;

  // Auto-preenchimento por CNPJ
  const cnpjInput = document.getElementById('manVendCnpj');
  cnpjInput?.addEventListener('blur', async () => {
    const cnpj = cnpjInput.value.replace(/\D/g, '');
    if (cnpj.length === 14) {
      try {
        const res = await fetch(`${API}/api/fornecedor/${cnpj}`);
        const data = await res.json();
        if (data.sucesso && data.fornecedor) {
          preencherDadosFornecedor(data.fornecedor);
          showToast('🏢 Dados do fornecedor carregados (Base Local)', 'success');
        } else {
          // Fallback para busca externa
          showToast('🌐 Buscando CNPJ em base externa...', 'info');
          const resExt = await fetch(`${API}/api/cnpj-externo/${cnpj}`);
          const dataExt = await resExt.json();
          if (dataExt.sucesso && dataExt.fornecedor) {
            preencherDadosFornecedor(dataExt.fornecedor);
            showToast('🌐 Dados do fornecedor carregados (Base Externa)', 'success');
          } else {
            showToast('⚠️ CNPJ não encontrado nas bases', 'warning');
          }
        }
      } catch (e) {
        console.warn('Erro ao buscar fornecedor:', e);
      }
    }
  });

  // Auto-recuperação de produto por EAN
  const eanInput = document.getElementById('manProdCean');
  eanInput?.addEventListener('blur', async () => {
    const ean = eanInput.value.trim();
    if (ean.length >= 8) {
      try {
        const res = await fetch(`${API}/api/produto/ean/${ean}`);
        const data = await res.json();
        if (data.sucesso && data.produto) {
          document.getElementById('manProdDesc').value = data.produto.descricao || '';
          document.getElementById('manProdNcm').value = data.produto.ncm || '';
          showToast('📦 Produto recuperado da base', 'success');
        }
      } catch (e) {
        console.warn('Erro ao recuperar produto:', e);
      }
    }
  });

  function preencherDadosFornecedor(v) {
    document.getElementById('manVendRazao').value = v.razao_social || '';
    document.getElementById('manVendFantasia').value = v.nome_fantasia || '';
    document.getElementById('manVendFone').value = v.telefone || '';
    document.getElementById('manVendLogr').value = v.logradouro || '';
    document.getElementById('manVendNum').value = v.numero || '';
    document.getElementById('manVendCompl').value = v.complemento || '';
    document.getElementById('manVendBairro').value = v.bairro || '';
    document.getElementById('manVendCidade').value = v.municipio || '';
    document.getElementById('manVendIbge').value = v.codigo_municipio || '';
    document.getElementById('manVendUf').value = v.uf || '';
    document.getElementById('manVendCep').value = v.cep || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('manSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Salvando...';
    }

    // Tratamento de NCM (Garantir 8 dígitos se informado)
    let ncmManual = document.getElementById('manProdNcm').value.replace(/\D/g, '');
    if (ncmManual && ncmManual.length > 0 && ncmManual.length < 8) {
      ncmManual = ncmManual.padStart(8, '0');
    }

    const data = {
      vendedor: {
        cnpj: document.getElementById('manVendCnpj').value.replace(/\D/g, ''),
        razao_social: document.getElementById('manVendRazao').value,
        nome_fantasia: document.getElementById('manVendFantasia').value,
        telefone: document.getElementById('manVendFone').value,
        logradouro: document.getElementById('manVendLogr').value,
        numero: document.getElementById('manVendNum').value,
        complemento: document.getElementById('manVendCompl').value,
        bairro: document.getElementById('manVendBairro').value,
        municipio: document.getElementById('manVendCidade').value,
        codigo_municipio: document.getElementById('manVendIbge').value.replace(/\D/g, '') || null,
        uf: document.getElementById('manVendUf').value.toUpperCase(),
        cep: document.getElementById('manVendCep').value.replace(/\D/g, '')
      },
      produto: {
        codigo_barras: document.getElementById('manProdCean').value,
        descricao: document.getElementById('manProdDesc').value,
        ncm: ncmManual,
        unidade: 'UN',
        quantidade: 0,
        valor_unitario: 0
      },
      data_emissao: new Date().toISOString().split('T')[0],
      perspectiva: document.getElementById('manPerspectiva').value
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

      const response = await fetch(`${API}/api/incluir-manual`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.sucesso) {
        showToast('✅ Registro salvo com sucesso!', 'success');
        form.reset();
        await carregarFiltros();
        await carregarEstatisticasGerais();
      } else {
        showToast('❌ Erro: ' + (result.erro || 'Falha ao salvar'), 'error');
      }
    } catch (err) {
      console.error('Erro submissão manual:', err);
      showToast('❌ Erro de conexão com o servidor', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Salvar Registro';
      }
    }
  });
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 4000);
}

function debounce(func, wait) {
  let timeout;
  return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); };
}

window.viewNota = viewNota;
window.deleteNota = deleteNota;
window.closeModal = () => document.getElementById('xmlModal').classList.remove('active');
window.loginWithGoogle = loginWithGoogle;

window.setNcmFilter = (ncm) => {
  const inputNcm = document.getElementById('filtroNcm');
  if (inputNcm) {
    inputNcm.value = ncm;
    inputNcm.focus();
    showToast(`Filtro NCM definido para #${ncm}`, 'info');

    // Pequeno efeito visual de destaque
    inputNcm.style.transition = 'all 0.3s';
    inputNcm.style.borderColor = '#667eea';
    inputNcm.style.boxShadow = '0 0 10px rgba(102, 126, 234, 0.5)';
    setTimeout(() => {
      inputNcm.style.borderColor = '';
      inputNcm.style.boxShadow = '';
    }, 2000);

    // Rola suavemente para o topo se estiver muito embaixo
    if (window.scrollY > 300) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
};

// ============================================================
// IMPORTAÇÃO DE PLANILHA
// ============================================================
function setupSpreadsheetImport() {
  const btn = document.getElementById('importarLoteBtn');
  const input = document.getElementById('spreadsheetInput');
  if (!btn || !input) return;

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);

        if (json.length === 0) {
          showToast('⚠️ Planilha vazia', 'warning');
          return;
        }

        if (confirm(`Deseja importar ${json.length} registros da planilha?`)) {
          await processarLotePlanilha(json);
        }
      } catch (err) {
        console.error('Erro ao ler planilha:', err);
        showToast('❌ Erro ao ler planilha', 'error');
      } finally {
        input.value = ''; // Limpa para permitir novo upload do mesmo arquivo
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function processarLotePlanilha(rows) {
  const totalRows = rows.length;
  let sucessos = 0;
  let erros = 0;
  const details = [];
  const BATCH_SIZE = 50; // Processar 50 por vez para equilíbrio entre performance e feedback

  // Elementos da Barra de Progresso
  const progressContainer = document.getElementById('spreadsheetProgressContainer');
  const progressBar = document.getElementById('spreadsheetProgressBar');
  const progressPercent = document.getElementById('spreadsheetProgressPercent');
  const progressStatus = document.getElementById('spreadsheetProgressStatus');
  const progressCount = document.getElementById('spreadsheetProgressCount');
  const progressEta = document.getElementById('spreadsheetProgressEta');

  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressStatus.textContent = 'Preparando lote...';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressCount.textContent = `0 / ${totalRows} registros`;
    progressEta.textContent = 'Calculando tempo restante...';
  }

  const startTime = Date.now();

  for (let i = 0; i < totalRows; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const batchPayloads = [];

    // Mapeamento dos itens do chunk
    for (const row of chunk) {
      const getAttr = (prefixes, suffixes) => {
        for (const p of prefixes) {
          for (const s of suffixes) {
            const key = p ? `${p}_${s}` : s;
            if (row[key] !== undefined) return row[key];
            const camel = p ? `${p}${s.charAt(0).toUpperCase()}${s.slice(1)}` : s;
            if (row[camel] !== undefined) return row[camel];
          }
        }
        return null;
      };

      const vCnpj = String(getAttr(['vendedor', 'fornecedor', 'emitente', ''], ['cnpj', 'identificador', 'doc']) || '').replace(/\D/g, '');
      const vRazao = String(getAttr(['vendedor', 'fornecedor', 'emitente', ''], ['razao_social', 'nome', 'xnome']) || '').trim();
      
      if (!vCnpj || !vRazao) {
        erros++;
        details.push({ name: `Linha ${rows.indexOf(row) + 1}`, status: 'error', message: 'CNPJ ou Razão Social ausente' });
        continue;
      }

      let dataEmi = row.data_emissao || row.data || row.emissao;
      if (typeof dataEmi === 'number') {
        const date = new Date(Math.round((dataEmi - 25569) * 86400 * 1000));
        dataEmi = date.toISOString().split('T')[0];
      } else if (!dataEmi) {
        dataEmi = new Date().toISOString().split('T')[0];
      }

      let ncmStr = String(row.produto_ncm || row.ncm || '').replace(/\D/g, '');
      if (ncmStr && ncmStr.length > 0 && ncmStr.length < 8) ncmStr = ncmStr.padStart(8, '0');

      batchPayloads.push({
        vendedor: {
          cnpj: vCnpj,
          razao_social: vRazao,
          nome_fantasia: String(row.vendedor_nome_fantasia || row.fantasia || vRazao).trim(),
          telefone: String(row.vendedor_telefone || row.telefone || '').trim(),
          logradouro: String(row.vendedor_logradouro || row.logradouro || '').trim(),
          numero: String(row.vendedor_numero || row.numero || '').trim(),
          complemento: String(row.vendedor_complemento || row.complemento || '').trim(),
          bairro: String(row.vendedor_bairro || row.bairro || '').trim(),
          municipio: String(row.vendedor_cidade || row.municipio || row.cidade || '').trim(),
          codigo_municipio: (row.vendedor_cidade_ibge || row.ibge || row.cmun) ? String(row.vendedor_cidade_ibge || row.ibge || row.cmun).replace(/\D/g, '') : null,
          uf: String(row.vendedor_uf || row.uf || '').toUpperCase().trim(),
          cep: String(row.vendedor_cep || row.cep || '').replace(/\D/g, '')
        },
        produto: {
          codigo_barras: String(row.produto_cean || row.cean || row.barras || '').trim(),
          descricao: String(row.produto_descricao || row.descricao || row.xprod || '').trim(),
          ncm: ncmStr,
          unidade: String(row.produto_unidade || row.unidade || row.ucom || 'UN').trim(),
          quantidade: parseFloat(row.produto_quantidade || row.quantidade || row.qcom) || 0,
          valor_unitario: parseFloat(row.produto_valor_unitario || row.valor_unitario || row.vuncom || row.valor_unit || row.preco) || 0
        },
        data_emissao: dataEmi,
        perspectiva: String(row.perspectiva || row.tipo || 'vendedor').toLowerCase().trim()
      });
    }

    if (batchPayloads.length === 0) continue;

    // Envia o lote para o servidor
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

      const res = await fetch(`${API}/api/incluir-manual-lote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itens: batchPayloads })
      });
      const result = await res.json();
      
      if (result.sucesso) {
        sucessos += result.sucessos || 0;
        erros += result.erros || 0;
        if (result.detalhes) {
          details.push(...result.detalhes.map(d => ({ name: d.item, status: 'error', message: d.erro })));
        }
      } else {
        erros += chunk.length;
        details.push({ name: 'Lote', status: 'error', message: result.erro || 'Erro no lote' });
      }
    } catch (err) {
      erros += chunk.length;
      details.push({ name: 'Conexão', status: 'error', message: err.message });
    }

    // Atualiza UI
    if (progressContainer) {
      const current = Math.min(i + BATCH_SIZE, totalRows);
      const percent = Math.round((current / totalRows) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const avgTime = elapsed / current;
      const remainingSeconds = Math.round(avgTime * (totalRows - current));
      
      progressBar.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressCount.textContent = `${current} / ${totalRows} registros`;
      progressStatus.textContent = `Processando lote (${current} de ${totalRows})...`;
      
      if (current > 0) {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        progressEta.textContent = `Restam aprox. ${minutes}m ${seconds}s`;
      }
    }
  }

  // Finaliza e oculta progresso
  if (progressContainer) {
    progressStatus.textContent = 'Importação concluída!';
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 3000);
  }

  showImportSummary({
    title: 'Resumo da Importação de Planilha',
    total: totalRows,
    success: sucessos,
    duplicates: 0,
    errors: erros,
    details: details.slice(0, 500) // Limita detalhes para não travar o modal
  });

  if (sucessos > 0) {
    await carregarFiltros();
    await carregarEstatisticasGerais();
  }
}

// ============================================================
// ENGAJAMENTO E CONTRIBUIÇÃO (TELEGRAM / INATIVIDADE)
// ============================================================
function resetInactivityTimer() {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(showInactivityModal, INACTIVITY_TIME);
}

function showInactivityModal() {
    const modal = document.getElementById('inactivityModal');
    if (modal) modal.classList.add('active');
}

window.closeInactivityModal = function() {
    const modal = document.getElementById('inactivityModal');
    if (modal) modal.classList.remove('active');
    resetInactivityTimer();
};

window.goToUploadTab = function() {
    closeInactivityModal();
    const navItem = document.querySelector('.nav-item[data-tab="upload"]');
    if (navItem) navItem.click();
};

function renderContributeInvite() {
    const container = document.getElementById('contributeInviteContainer');
    if (!container) return;

    container.innerHTML = `
    <div class="contribute-invite-card" style="margin-top: 24px; padding: 25px; border-radius: 16px; background: linear-gradient(135deg, #f0f4ff 0%, #ffffff 100%); border: 1px dashed #667eea; text-align: center;">
        <div style="font-size: 32px; margin-bottom: 15px;">🤝</div>
        <h3 style="color: #1a1f36; margin-bottom: 10px;">Encontrou o que procurava?</h3>
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 20px; max-width: 400px; margin-left: auto; margin-right: auto;">
            Estas informações só estão aqui porque outros usuários como você compartilharam seus XMLs. Ajude nossa comunidade a crescer!
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="goToUploadTab()" style="padding: 10px 20px;">
                📤 Enviar XML agora
            </button>
            <a href="https://t.me/AquiTem_bot" target="_blank" class="btn btn-outline" style="padding: 10px 20px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
                <span>✈️</span> Chamar no Telegram
            </a>
        </div>
    </div>
    `;
}
