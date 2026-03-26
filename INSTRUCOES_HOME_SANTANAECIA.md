# Instruções para Home Page - santanaecia.com.br

Este documento contém o plano para a página central que irá unificar os projetos hospedados no seu domínio. **Mova este arquivo para ˜/Projetos ou copie o código abaixo.**

## 🏗️ Estrutura de Diretórios Sugerida no HostGator

Para que os links funcionem conforme planejado, a estrutura no seu servidor (public_html) deve ser:

- `/` -> Arquivo `index.html` (Página Principal/Home)
- `/aquitem/` -> Projeto **xmlAnalise**
- `/maspiofmg/` -> Projeto **iofmg**

## 🎨 Modelo de Home Page (HTML/CSS)

Você pode criar um arquivo `index.html` na raiz do seu domínio com o seguinte conteúdo base:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Santana & Cia - Ecossistema de Projetos</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            margin: 0;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 50px;
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.1);
        }
        h1 { margin-bottom: 30px; font-size: 2.5rem; }
        .project-links {
            display: flex;
            gap: 20px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .card {
            background: white;
            color: #333;
            padding: 30px;
            border-radius: 15px;
            text-decoration: none;
            width: 250px;
            transition: transform 0.3s, box-shadow 0.3s;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .card:hover {
            transform: translateY(-10px);
            box-shadow: 0 15px 30px rgba(0,0,0,0.2);
        }
        .card i { font-size: 3rem; margin-bottom: 15px; }
        .card h2 { margin: 10px 0; font-size: 1.5rem; color: #1a2a6c; }
        .card p { font-size: 0.9rem; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Ecossistema Santana & Cia</h1>
        <div class="project-links">
            <a href="/aquitem" class="card">
                <h2>AQUI TEM</h2>
                <p>Análise de XMLs e Busca de Produtos em Fornecedores Locais.</p>
            </a>
            <a href="/maspiofmg" class="card">
                <h2>IOFMG</h2>
                <p>Gestão e Monitoramento MASP no IOF MG.</p>
            </a>
        </div>
    </div>
</body>
</html>
```

## ⚙️ Configurações Importantes

1.  **xmlAnalise (AQUI TEM)**:
    - O frontend deve ser movido para a pasta `/aquitem` do HostGator.
    - No arquivo `app.js`, certifique-se de que a constante `API` aponte para a URL correta do backend (ex: `https://seu-backend-no-render.com`).

2.  **iofmg**:
    - O frontend deve ser movido para a pasta `/maspiofmg`.

3.  **Domínios e SSL**:
    - Certifique-se de habilitar o SSL (HTTPS) no HostGator para evitar erros de conteúdo misto ao chamar as APIs que estão no Render/Supabase.

---
*Instruções geradas em Março de 2026 para Silvio B. S. Junior.*
