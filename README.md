# LaPink

Projeto organizado para facilitar manutenção e adição de fotos de produto.

## Estrutura de pastas

- `public/` — páginas do site público
  - `index.html` — homepage da loja
  - `produto.html` — página de detalhe de produto
  - `V1.html` — página de exemplo adicional

- `admin/` — páginas do painel administrativo
  - `admin.html` — dashboard administrativo
  - `cadastro-produto.html` — cadastro/edição de produtos
  - `cadastro-cliente.html` — cadastro/edição de clientes
  - `pedidos.html` — lista de pedidos
  - `clientes.html` — lista de clientes
  - `relatorios.html` — relatórios e métricas
  - `financeiro.html` — cobranças, histórico e configuração de pagamentos

- `css/` — arquivos de estilo
  - `Principal.css`
  - `PrincipalPublica.css`
  - `PrincipalPainelAdmin.css`
  - `componentes.css`

- `assets/images/` — pasta para adicionar fotos dos produtos e outras imagens do site

## Como usar

- Abra `public/index.html` para ver a loja pública
- Abra `admin/admin.html` para acessar o painel administrativo
- Coloque imagens de produto em `assets/images/` e atualize os caminhos nas páginas conforme necessário

## Servidor de Desenvolvimento

```bash
npm install
npm start
```

O servidor iniciará em `http://localhost:3000` (computador local).

### Acessar pelo celular

1. Certifique-se de que o celular está conectado à **mesma rede WiFi** que o computador
2. Abra o navegador no celular
3. Acesse: `http://<SEU_IP_LOCAL>:3000`

O IP local será mostrado no terminal quando o servidor iniciar.

### Testar autenticação

1. Acesse a página de **Cadastro** e crie uma conta
2. Faça **login** com as credenciais criadas
3. Valide o comportamento de autenticação (mostra nome, botão de logout, etc)
4. Teste em diferentes páginas (`index.html` e `V1.html`)

## Banco de dados

O arquivo `admin/js/api.js` é a camada de abstração de dados do projeto.
Hoje usa `localStorage` como backend. Para migrar para um banco real:

1. Ajuste `API_BASE_URL` para a URL do servidor
2. Troque `USE_REMOTE` para `true`
3. O restante do código permanece idêntico

