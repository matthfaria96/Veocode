// Textos da Ajuda: o que cada tela é e o que dá para fazer nela. Curtos de propósito: uma ideia
// por linha, na língua de quem está chegando agora. O resto o próprio app explica (dicas ao passar
// o mouse, estados vazios).

import type { View } from "../store";

export type TopicId = "inicio" | "painel" | "projetos" | "chat" | "livre" | "contas" | "sistema" | "ajustes" | "palavras";

export interface Topic {
  id: TopicId;
  title: string;
  /** telas que este tópico explica (a primeira vai no botão "Abrir esta tela") */
  view?: View;
  also?: View[];
  /** uma frase: o que é */
  lead: string;
  /** onde está (como chegar) */
  where?: string;
  sections: { title: string; items: string[] }[];
  /** glossário: termo → explicação */
  terms?: [string, string][];
}

export const topics: Topic[] = [
  {
    id: "inicio",
    title: "Começo rápido",
    lead: "O Veocode junta as suas IAs (Claude, DeepSeek, modelos locais…) num lugar só e mostra, ao vivo, tudo o que elas fazem nos seus projetos.",
    sections: [
      {
        title: "Em quatro passos",
        items: [
          "Adicione uma pasta: na Visão geral, \"Adicionar projeto\". Cada pasta vira um projeto.",
          "Ligue uma conta em Contas e IAs: entre com o Claude, cole uma chave de API ou use o Ollama.",
          "Escolha o nível de acesso: quanto a IA pode mexer na pasta, de só ler até fazer tudo sozinha.",
          "Converse. Cada passo da IA aparece na hora, na conversa e nos arquivos.",
        ],
      },
      {
        title: "Atalhos",
        items: [
          "⌘1 a ⌘5 trocam de tela: Visão geral, Projetos, Chat livre, Contas e IAs, Painel.",
          "⌘K busca projetos, arquivos e ações. F1 abre esta ajuda.",
          "⌘N começa uma conversa nova. ⌘E troca entre os modos IA e Código.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "O sininho no topo junta o que espera você (permissões, erros, contas sem login). Um clique leva até onde se resolve.",
          "Uma bolinha num ícone do menu lateral avisa que algo acontece ali. Passe o mouse para ver o resumo.",
          "Nada é apagado de vez: tudo vai para a Lixeira. Chaves de API ficam no chaveiro do sistema.",
          "Sem nenhuma pasta, aparece um projeto de demonstração. Nada nele é gravado.",
        ],
      },
    ],
  },
  {
    id: "painel",
    title: "Visão geral",
    view: "board",
    where: "Primeiro ícone do menu lateral (⌘1).",
    lead: "A tela de início: os projetos lado a lado em colunas, cada uma com o chat completo do projeto. Em cima, a barra com todos os projetos e o estado de cada um.",
    sections: [
      {
        title: "Na tela",
        items: [
          "Os projetos entram sozinhos: quem pede você vem primeiro, depois quem está trabalhando e quem mexeu por último.",
          "Cabem tantas colunas quanto a janela permite, sem ficarem apertadas: janela maior, mais colunas (até oito).",
          "Cada coluna tem o chat completo do projeto, com uma aba para cada conversa rodando ao mesmo tempo e o + para começar outra.",
          "Os dois ícones no topo da coluna trocam entre IA (a conversa) e Código: a árvore de arquivos, várias abas para editar (grava sozinho), as mudanças com o commit e o terminal embaixo.",
          "Arraste um projeto pelo título até outro para trocar de lugar. O ✕ tira da tela, e a IA continua trabalhando.",
          "O botão de tela cheia amplia uma coluna, e as outras continuam rodando. No ⋯: abrir o projeto completo, nova conversa e fixar no lugar.",
        ],
      },
      {
        title: "Barra de projetos",
        items: [
          "A barra de cima tem todos os projetos, com uma bolinha de estado. Os que estão na tela ficam marcados, e um clique leva até a coluna.",
          "Clique num projeto fora da tela para pôr na tela, ou arraste até uma coluna para trocar. Dois cliques abrem o projeto.",
          "O clique direito abre, mostra no Finder ou fecha o projeto.",
          "\"Adicionar projeto\" sugere as pastas onde você já usou o Claude. Também dá para escolher outra no Finder.",
        ],
      },
    ],
  },
  {
    id: "projetos",
    title: "Projetos",
    view: "workspace",
    where: "Segundo ícone do menu lateral (⌘2). Troque de projeto pelo nome no topo.",
    lead: "Onde se trabalha num projeto, em dois modos que ⌘E alterna: IA, para conversar, e Código, para mexer nos arquivos.",
    sections: [
      {
        title: "Modo IA",
        items: [
          "À esquerda, os projetos com as conversas de cada um. O + começa uma conversa nova.",
          "À direita, o painel de depuração: Navegador, Comandos, Subagentes, Atividade e Rastro.",
          "Rastro mostra o que a IA deixou: sobras para limpar, pastas fora do projeto, o que instalou e o que consultou.",
        ],
      },
      {
        title: "Navegador",
        items: [
          "Abre o app do projeto rodando (localhost) em abas, no tamanho de computador ou de celular. Os servidores do projeto rodam, param e mostram os logs por ali mesmo.",
          "A seta escolhe um elemento da página e manda para a conversa o seletor, o componente, os estilos e a imagem dele. O lápis risca a página e manda a captura com o que você marcou.",
          "O console da página (erros, avisos e rede que falhou) fica a um clique, com o número de erros na barra, e pode ir junto para a conversa.",
          "A IA usa este mesmo navegador: abre páginas, olha, clica e digita, e um aviso mostra quando ela está mexendo. No menu ⋯ dá para guardar os dados dos sites só até fechar o app ou apagar os de um site.",
        ],
      },
      {
        title: "Modo Código",
        items: [
          "Árvore de arquivos, editor em abas e, à direita, um painel com Git, Terminal, Ambiente e Mapa. O ícone do painel (⌥⌘B) mostra e esconde.",
          "O editor grava sozinho (⌘S grava na hora). Marcas coloridas na árvore mostram o que a IA leu, editou, criou ou apagou.",
          "⌘J abre o terminal, já na pasta do projeto e com o seu shell. Cada projeto tem os dele, com o próprio histórico de comandos.",
          "Ambiente troca os perfis do .env com um clique e liga os serviços do projeto, como o npm run dev.",
        ],
      },
      {
        title: "Mapa do projeto",
        items: [
          "A aba Mapa desenha o projeto: cada área é uma nuvem colorida, cada arquivo um ponto e as linhas mostram quem usa quem.",
          "\"Desenhar a partir do código\" lê os imports em segundos. \"Pedir à IA\" faz um mapa de ideias (telas, serviços, dados) no lugar dos arquivos.",
          "Tudo fica num arquivo só, .veocode/map.json. O Veocode desenha sozinho e relê quando o arquivo muda.",
          "Ao vivo: anel rosa é o que a IA está mexendo, tracejado laranja é o que mudou e ainda não tem commit.",
          "Clique num ponto para ver o que ele usa e quem usa ele. Dois cliques abrem o arquivo. Busque pelo nome e esconda áreas na legenda.",
        ],
      },
      {
        title: "Git",
        items: [
          "Escreva a mensagem e clique em Commit (⌘Enter). A seta ao lado tem \"Commit e enviar\".",
          "Clique num arquivo para ver o antes e o agora lado a lado. \"Revisar tudo\" junta todas as mudanças numa tela só.",
          "Os commits aparecem num desenho com uma linha por branch. Clique num para ver o que ele mudou.",
          "As setas ↑ e ↓ enviam e baixam. Com o GitHub CLI (gh), aparecem também os PRs e os testes (CI).",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "Clique direito num arquivo para criar, renomear, mostrar no Finder ou mandar para a Lixeira.",
          "\"Fechar projeto…\", no menu do nome do projeto, tira ele do Veocode. A pasta fica, a menos que você escolha a Lixeira.",
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat e nível de acesso",
    view: "workspace",
    where: "No meio do modo IA, na tela Projetos.",
    lead: "Converse com a IA dentro do projeto. Ela trabalha na pasta dele, com a conta dele e dentro do nível de acesso.",
    sections: [
      {
        title: "Enquanto ela trabalha",
        items: [
          "Os passos ficam numa linha cinza (\"Executou 4 comandos, leu 2 arquivos ›\"). Clique para ver um por um.",
          "A última linha diz o que ela está fazendo e há quanto tempo (\"Executando um comando · 4 min 47 s\").",
          "Os números verdes e vermelhos (+12 −3) são as linhas que ela mudou. Clique para ver a mudança no modo Código (numa coluna do Início, na própria coluna).",
          "A lista de tarefas dela vira um cartão: ✓ nas feitas, girando na de agora, um círculo nas que faltam.",
          "Quando ela precisa de permissão, aparece um cartão com Permitir e Recusar.",
          "Parar, na linha de baixo (ou Esc na caixa), para tudo: a resposta, os comandos e os ajudantes dela. A conversa fica salva.",
          "Conversa rodando fora do Veocode (Terminal, editor, app do Claude) também mostra a linha e o tempo. Parar lista as IAs abertas na pasta para você escolher qual fechar.",
        ],
      },
      {
        title: "Conversas",
        items: [
          "A lista junta as conversas do Veocode, do Terminal e do editor. Clique para continuar de onde parou.",
          "Várias conversas podem trabalhar ao mesmo tempo, cada uma na sua aba. A tela cheia (no topo da conversa; Esc sai) esconde a lista e o painel da direita.",
          "Grupos juntam conversas do mesmo assunto: \"Novo grupo\", embaixo da lista, e \"Mover para o grupo\" no ⋯ da conversa.",
          "Embaixo, \"Ativas\" deixa só as que estão trabalhando ou esperando você.",
          "Local | Nuvem troca para as sessões do Claude Code na nuvem (claude.ai/code): comece uma, acompanhe pelo link ou traga para este computador.",
          "No ⋯ de uma conversa: abrir em outro lugar, fixar, renomear, bifurcar (tentar outro caminho sem perder este), arquivar ou apagar.",
          "Clique na conta, na caixa de mensagem, para trocar a conta, o modelo e a força do raciocínio.",
          "O medidor de contexto, em cima, mostra quanto da memória da conversa já foi usada. \"Compactar conversa\" libera espaço.",
        ],
      },
      {
        title: "Nível de acesso",
        items: [
          "Leitura: lê e responde, sem mudar nada.",
          "Sugerir: propõe mudanças e você aprova cada uma.",
          "Editar: edita arquivos; comandos pedem a sua aprovação.",
          "Total: edita, roda comandos e instala pacotes sozinha.",
          "No ajuste fino, cada item (comandos, git push, rede, segredos…) pode ser Permitido, Pergunta ou Bloqueado. Bloqueado sempre vence.",
          "\"Gravar no projeto\" faz o nível valer também no Claude fora do Veocode, no Terminal ou no editor.",
        ],
      },
    ],
  },
  {
    id: "livre",
    title: "Chat livre",
    view: "livre",
    where: "Terceiro ícone do menu lateral (⌘3).",
    lead: "Uma conversa fora de qualquer projeto, para tirar dúvidas, escrever e pensar junto. Funciona como o chat dos projetos.",
    sections: [
      {
        title: "O computador e a permissão",
        items: [
          "Ela conversa normalmente e só abre seus arquivos quando a pergunta é sobre o computador.",
          "O selo de permissão na caixa de mensagem diz o que ela pode fazer: Leitura (padrão: lê arquivos e roda comandos de leitura como ls, sem editar nem apagar nada), Sugerir, Editar ou Total.",
          "Pastas de senhas e chaves (.ssh, .aws, chaveiro, .env…) ficam sempre de fora, em qualquer nível.",
        ],
      },
      {
        title: "Conversas",
        items: [
          "A conta, o modelo e a força do raciocínio ficam na caixa de mensagem.",
          "Enquanto ela trabalha, a linha de baixo diz o que está fazendo e há quanto tempo. Parar interrompe tudo.",
          "O painel da direita tem a conversa nova (⌘N), a busca, os projetos e o histórico. O botão no canto de cima esconde ou mostra o painel.",
          "O medidor de contexto, ao lado da permissão, mostra quanto a conversa ocupa e deixa compactar.",
          "Trocar de conta começa uma conversa nova; trocar a permissão continua a mesma.",
        ],
      },
    ],
  },
  {
    id: "contas",
    title: "Contas e IAs",
    view: "accounts",
    where: "Quarto ícone do menu lateral (⌘4).",
    lead: "As contas de IA que o Veocode usa, quanto cada uma trabalhou e o cofre de chaves e senhas.",
    sections: [
      {
        title: "Contas",
        items: [
          "Claude: o login é feito pelo próprio Claude, num terminal que o Veocode abre. Cada conta tem a sua pasta.",
          "DeepSeek e APIs compatíveis com OpenAI: cole a chave, que vai para o chaveiro do sistema.",
          "Ollama: modelos rodando no computador, achados sozinhos.",
          "Cada conta mostra o plano, o uso da semana e o modelo padrão.",
        ],
      },
      {
        title: "Cofre",
        items: [
          "Guarde uma vez as chaves de API e os logins. O valor vai para o Chaveiro; a tela só mostra o final.",
          "Com um nome de variável (ex.: OPENAI_API_KEY), a chave entra no Claude e nos terminais dos projetos. A IA vê só o nome, nunca o valor.",
          "\"Vale em\" escolhe se a entrada serve para todos os projetos ou só para alguns.",
        ],
      },
    ],
  },
  {
    id: "sistema",
    title: "Painel",
    view: "system",
    also: ["inventory"],
    where: "Quinto ícone do menu lateral (⌘5).",
    lead: "O que as IAs deixaram no computador e o que está aberto agora. A Visão geral do Painel resume em cartões; a lista da esquerda abre cada parte.",
    sections: [
      {
        title: "No disco",
        items: [
          "Claude no computador: quanto o app do Claude, o Claude Code e o Veocode ocupam, com um botão de limpar em cada item.",
          "Caches e restos: temporários de pacotes, builds e históricos. Marque e mande para a Lixeira.",
          "Instalado pelas IAs e IAs locais: programas e modelos baixados, com o projeto que pediu.",
        ],
      },
      {
        title: "Rodando agora",
        items: [
          "IAs abertas: cada Claude aberto no computador, onde está e quanta memória usa.",
          "Servidores e portas que ficaram ligados (como localhost:3000). Dá para fechar daqui.",
          "Máquinas virtuais: Docker e Lima, para ligar e parar.",
        ],
      },
      {
        title: "Extras do Claude",
        items: [
          "Receitas (skills), atalhos /, ajudantes, conexões (MCP) e plugins: onde cada um vale e quanto pesa em toda conversa.",
          "Desligue ou mande para a Lixeira o que você não usa. O Veocode sempre pergunta antes.",
        ],
      },
    ],
  },
  {
    id: "ajustes",
    title: "Ajustes",
    view: "settings",
    where: "Último ícone do menu lateral, a engrenagem.",
    lead: "Como o Veocode aparece. Cada opção mostra uma prévia e vale na hora.",
    sections: [
      {
        title: "O que dá para mudar",
        items: [
          "Tema: claro, escuro ou igual ao do computador.",
          "Idioma: português, inglês ou igual ao do computador. A IA responde no idioma em que você escreve.",
          "Ícones detalhados (com cor e a etiqueta do tipo) ou minimalistas.",
          "Animações completas ou reduzidas.",
          "Terminal no modo Código: começa fechado ou já aberto na pasta do projeto.",
        ],
      },
      {
        title: "Bom saber",
        items: ["A tela mostra onde o Veocode guarda projetos, contas e conversas, com um botão para abrir cada pasta."],
      },
    ],
  },
  {
    id: "palavras",
    title: "Palavras que aparecem",
    lead: "Um glossário curto dos termos que aparecem no Veocode.",
    sections: [],
    terms: [
      ["Projeto", "Uma pasta do computador que você adicionou ao Veocode. Pode ter git (e ir para o GitHub) ou não."],
      ["Conta", "Um acesso a uma IA: uma conta do Claude, uma chave de API ou o Ollama local. Cada projeto usa uma conta."],
      ["Agente", "A IA trabalhando sozinha, passo a passo: lê, edita, roda comandos. Subagente é um ajudante que ela abre para uma parte do trabalho."],
      ["Nível de acesso", "O quanto a IA pode mexer na pasta: Leitura, Sugerir, Editar ou Total."],
      ["Skill", "Um arquivo de instruções extra que ensina a IA a fazer algo (criar PDFs, revisar código…). Só o nome e a descrição ficam sempre carregados."],
      ["MCP", "Um programa que dá ferramentas novas à IA (falar com o GitHub, com o Figma, com um banco de dados…). Roda enquanto a conversa está aberta."],
      ["Plugin", "Um pacote que instala várias skills, comandos e servidores MCP de uma vez."],
      ["Token", "A unidade em que a IA mede texto (mais ou menos ¾ de uma palavra). Planos e limites são contados em tokens."],
      ["Lixeira", "Para onde o Veocode manda tudo o que tira. Dá para recuperar de lá."],
      ["Git", "O histórico de versões da pasta. Cada versão salva é um commit; dá para ver o que mudou e voltar atrás."],
      ["Branch", "Uma linha de trabalho separada dentro do mesmo projeto (main é a principal)."],
      ["Push / pull / fetch", "Push envia seus commits ao remoto, pull traz os de lá e junta com os seus, fetch só pergunta o que há de novo sem mudar nada."],
      ["PR", "Pull request: um pedido para juntar um branch no principal, com conversa e revisão no GitHub."],
      ["CI", "Testes automáticos que o GitHub roda a cada envio (GitHub Actions). Verde passou, vermelho falhou."],
    ],
  },
];

/** Tópico que explica a tela aberta agora. */
export const topicForView = (v: View): TopicId => topics.find((t) => t.view === v || t.also?.includes(v))?.id ?? "inicio";
