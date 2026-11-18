// Textos da Ajuda: o que cada tela é, o que dá para fazer e o que é bom saber.
// Linguagem simples de propósito: é para quem está chegando agora.

import type { View } from "../store";

export type TopicId = "inicio" | "mapa" | "projetos" | "nivel" | "chat" | "livre" | "contas" | "inventario" | "raiox" | "skills" | "ajustes" | "palavras";

export interface Topic {
  id: TopicId;
  title: string;
  /** tela que este tópico explica (botão "Abrir esta tela") */
  view?: View;
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
    lead: "O Veocode é um painel para usar várias IAs (Claude, DeepSeek, modelos locais…) nos seus projetos e enxergar tudo o que elas fazem no computador.",
    sections: [
      {
        title: "Em quatro passos",
        items: [
          "Adicione uma pasta: no Mapa, \"Adicionar projeto\" (ou ⌘K / Ctrl+K). Cada pasta é um projeto: um app, um site, um repositório do GitHub ou só uma pasta comum.",
          "Ligue uma conta em Contas e IAs: entre com o Claude, cole a chave do DeepSeek ou de uma API compatível com OpenAI, ou use o Ollama no próprio computador.",
          "Escolha o nível de acesso do projeto: quanto a IA pode mexer na pasta (de só ler até fazer tudo sozinha).",
          "Converse no painel do agente, na tela Projetos. Cada passo da IA aparece ao vivo: na árvore de arquivos, no editor e na Atividade.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "Nada é apagado de vez: o que o Veocode tira vai para a Lixeira.",
          "Chaves de API ficam no chaveiro do sistema, nunca num arquivo.",
          "O projeto \"demo · simulação\" é só uma demonstração: ali nada é gravado.",
          "⌘K (Ctrl+K no Windows) abre a busca de projetos, arquivos e ações. F1 abre esta ajuda.",
        ],
      },
    ],
  },
  {
    id: "mapa",
    title: "Mapa",
    view: "home",
    where: "Primeiro ícone do menu lateral.",
    lead: "Quem trabalha onde: cada conta de IA à esquerda, os projetos à direita e uma linha ligando a conta a cada projeto que ela atende.",
    sections: [
      {
        title: "O que você vê",
        items: [
          "As contas, com o uso de hoje e uma bolinha que pulsa quando a conta está trabalhando.",
          "Os projetos, com a pasta, o tipo (Rust, Node…) e o branch do git, se houver.",
          "Na linha entre os dois, o nível de acesso daquela ligação (Leitura, Sugerir, Editar ou Total).",
          "No topo, números rápidos: projetos, agentes de IA abertos agora, espaço em caches e VMs ligadas.",
        ],
      },
      {
        title: "O que dá para fazer",
        items: ["Adicionar um projeto (uma pasta do computador).", "Clicar num projeto para abrir na tela Projetos.", "Clicar nos números do topo para ir direto à tela que explica cada um."],
      },
    ],
  },
  {
    id: "projetos",
    title: "Projetos",
    view: "workspace",
    where: "Segundo ícone do menu lateral. Troque de projeto pelo nome no topo da tela.",
    lead: "A mesa de trabalho de um projeto: os arquivos, o editor, a conversa com a IA e tudo o que ela está fazendo, ao vivo.",
    sections: [
      {
        title: "As partes da tela",
        items: [
          "Esquerda: a árvore de arquivos. Marcas coloridas mostram o que foi lido, editado, criado ou apagado.",
          "Meio: o editor, que abre o arquivo que a IA acabou de mexer e destaca as linhas que mudaram.",
          "Embaixo: Atividade (cada passo da IA e cada mudança no disco), Comandos do agente (o que a IA rodou e a saída) e Terminal (um terminal seu, de verdade, nesta pasta). Arraste a borda de cima para deixar o painel mais alto.",
          "Direita: o painel do agente, com três abas: Agente (a conversa), Acesso (o nível de acesso) e Git.",
          "Cursores coloridos (um por conta, e um para cada subagente) mostram onde a IA está mexendo agora.",
        ],
      },
      {
        title: "Terminal do projeto",
        items: [
          "Cada projeto tem os terminais dele (até 6, em abas). O primeiro abre sozinho quando você entra na aba Terminal.",
          "Ele nasce na pasta do projeto, com o seu shell de sempre (zsh, bash ou PowerShell) e a sua configuração.",
          "O histórico de comandos (setas ↑ ↓) é só deste projeto: o que você digitou em outro projeto não aparece aqui.",
          "Digitar claude aqui usa a conta do projeto, a mesma do chat, e o que ele fizer aparece na Atividade.",
          "Trocar de projeto não fecha nada: cada terminal continua rodando e volta como estava. Fechar o Veocode fecha todos.",
          "É um terminal normal seu: dá para ir a outras pastas com cd. Quem fica preso à pasta é a IA, pelo nível de acesso.",
        ],
      },
      {
        title: "Git e GitHub do projeto",
        items: [
          "A aba Git (no painel da direita, ou clicando no nome do branch embaixo do projeto) mostra o estado do git deste projeto, sozinho.",
          "No topo: o branch, e as setas ↑ (commits daqui que o remoto ainda não tem) e ↓ (commits do remoto que ainda não estão aqui).",
          "Mudanças não salvas no git: os arquivos alterados, novos ou apagados desde o último commit. Clicar abre o arquivo no editor.",
          "Commits: bolinha vazia é commit que só existe neste computador; cheia é o que já está no GitHub.",
          "Branches, stash (mudanças deixadas de lado) e remotos, com um botão para abrir o repositório no navegador.",
          "Com o GitHub CLI (gh) instalado e logado aparecem também: repositório (público ou privado, issues, versão), testes automáticos (CI) do branch e PRs abertos com o estado dos checks.",
          "Buscar (git fetch) pergunta ao remoto o que há de novo, sem mudar seus arquivos. O Veocode não faz commit, push nem pull: isso fica com você no Terminal ou com a IA, pelo nível de acesso.",
          "No Mapa e embaixo do nome do projeto, um resumo: ↑ para enviar, ↓ para baixar e ● arquivos mudados.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "A Atividade mostra tudo o que acontece na pasta, venha do chat do Veocode, do Claude no Terminal ou do editor (VS Code etc.).",
          "Ao abrir o projeto, os últimos passos das últimas 24 h aparecem como histórico.",
          "\"Remover da lista\" (o X ao lado de Arquivos) só tira o projeto do Veocode: a pasta continua intacta.",
        ],
      },
    ],
  },
  {
    id: "nivel",
    title: "Nível de acesso",
    view: "workspace",
    where: "No painel do agente, o botão colorido ao lado do campo de mensagem.",
    lead: "Quanto a IA pode mexer na pasta do projeto. Vale para todas as contas, do Claude às APIs.",
    sections: [
      {
        title: "Os quatro níveis",
        items: [
          "Leitura: lê arquivos e responde. Não altera nada.",
          "Sugerir: propõe mudanças e você aprova cada uma.",
          "Editar: edita arquivos do projeto; comandos pedem a sua aprovação.",
          "Total: edita, roda comandos e instala pacotes sozinha.",
        ],
      },
      {
        title: "Ajuste fino",
        items: [
          "Cada item (ler, editar, comandos, instalar pacotes, git push, rede, VMs, segredos…) pode ser Permitido, Pergunta ou Bloqueado, por cima do nível.",
          "Bloqueado sempre vence: a IA nem tenta.",
          "Quando algo está em Pergunta, aparece um cartão no chat com Permitir e Recusar.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "No chat do Veocode o nível vale sempre. Para valer também quando você usa o Claude fora do Veocode (no Terminal ou no editor), use \"Gravar no projeto\": as regras vão para .claude/settings.local.json na pasta.",
          "O Veocode grava só as regras dele, guarda o que havia antes e desfaz exatamente isso.",
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat e conversas",
    view: "workspace",
    where: "Painel da direita na tela Projetos.",
    lead: "Converse com a IA dentro do projeto. Ela trabalha na pasta dele, com a conta dele e respeitando o nível de acesso.",
    sections: [
      {
        title: "Como funciona",
        items: [
          "Com conta do Claude, o pedido vai para o próprio Claude Code, rodando sem janela, na pasta do projeto.",
          "Com DeepSeek, OpenAI ou Ollama, o Veocode dá ao modelo ferramentas para listar, ler, buscar e editar arquivos e rodar comandos, sempre pelo nível de acesso.",
          "O texto chega aos poucos; o botão quadrado para a resposta no meio.",
          "O clipe manda junto o arquivo que está aberto no editor.",
        ],
      },
      {
        title: "Conversas anteriores",
        items: [
          "O botão de relógio lista as conversas desta pasta (as do chat, as do Terminal e as do editor). Clique para continuar de onde parou.",
          "\"Nova conversa\" começa do zero.",
          "Conversas de outra conta aparecem com cadeado: troque a conta do projeto antes.",
          "O botão de terminal abre o Claude no Terminal do sistema, na pasta e com a conta do projeto.",
        ],
      },
    ],
  },
  {
    id: "livre",
    title: "Chat livre",
    view: "livre",
    where: "Terceiro ícone do menu lateral (dois balões).",
    lead: "Uma conversa fora de qualquer projeto, para tirar dúvidas, escrever textos e pensar junto. Se você quiser, a IA também pode olhar os arquivos do seu computador, só para ler.",
    sections: [
      {
        title: "Em quatro passos",
        items: [
          "Abra o Chat livre pelo menu lateral (ou ⌘K → \"Chat livre\").",
          "Escolha a conta no topo: Claude, DeepSeek, OpenAI-compatível ou Ollama.",
          "Deixe em \"Só conversa\" ou ligue \"Olhar o computador\".",
          "Escreva e aperte Enter, ou clique numa das sugestões.",
        ],
      },
      {
        title: "Só conversa",
        items: [
          "A IA não vê nenhum arquivo seu: só o que você escrever.",
          "Pode pesquisar na internet sem perguntar, porque não há nada seu para vazar.",
        ],
      },
      {
        title: "Olhar o computador",
        items: [
          "A IA pode listar, ler e buscar arquivos na sua pasta pessoal para responder: achar um PDF, resumir um documento, ver o que tem numa pasta.",
          "Nunca edita, cria, apaga nem roda comandos.",
          "Pastas de senhas e chaves ficam bloqueadas: .ssh, .aws, .gnupg, chaveiro, cookies, arquivos .env e chaves .pem/.key, e a configuração do próprio Veocode.",
          "Abrir páginas da internet passa a pedir sua aprovação, para nada lido no computador sair num link.",
          "Cada arquivo que ela olhou aparece no cartão \"Passos\" da conversa.",
        ],
      },
      {
        title: "Conversas",
        items: [
          "As conversas ficam guardadas: o botão de relógio lista todas e continua de onde parou (trocando para a conta dela, se precisar).",
          "Trocar de conta começa uma conversa nova; trocar o modo continua a mesma.",
        ],
      },
    ],
  },
  {
    id: "contas",
    title: "Contas e IAs",
    view: "accounts",
    where: "Quarto ícone do menu lateral.",
    lead: "As contas de IA que o Veocode usa e quanto cada uma está sendo usada.",
    sections: [
      {
        title: "Tipos de conta",
        items: [
          "Claude: cada conta é uma pasta separada do Claude Code. O login é feito pelo próprio Claude, num terminal que o Veocode abre.",
          "DeepSeek e APIs compatíveis com OpenAI: você cola a chave, que vai para o chaveiro do sistema. Aparecem o saldo e os modelos.",
          "Ollama: modelos rodando no próprio computador, achados automaticamente.",
        ],
      },
      {
        title: "O que dá para fazer",
        items: [
          "Ver o plano, o uso por dia na última semana e os modelos mais usados de cada conta.",
          "Escolher o modelo padrão da conta.",
          "Na tabela \"quem usa o quê\", clicar para trocar a conta de um projeto.",
          "Renomear ou tirar uma conta do Veocode (a conta em si continua existindo).",
        ],
      },
    ],
  },
  {
    id: "inventario",
    title: "Inventário",
    view: "inventory",
    where: "Quinto ícone do menu lateral.",
    lead: "Tudo o que as IAs instalaram ou usam neste computador, numa lista só: para qual projeto vale, se está ligado ou rodando, quanto pesa e como tirar.",
    sections: [
      {
        title: "Como ler uma linha",
        items: [
          "A etiqueta embaixo do nome diz onde vale: \"todos os projetos da conta\", o nome de uma pasta, ou \"computador todo\".",
          "A pílula diz a situação: ligado, desligado, rodando (pisca), remoto ou \"falta programa\" (vai falhar ao abrir).",
          "À direita, o peso: CPU e memória do que roda agora, tamanho no disco, ou tokens. Clique na linha para ver os detalhes.",
        ],
      },
      {
        title: "Tokens e contexto fixo",
        items: [
          "Toda conversa começa carregando o nome e a descrição de cada skill ligada: é o \"contexto fixo\", gasto antes de você escrever.",
          "O resto da skill só entra quando ela é usada (\"ao usar\").",
          "Escolha um projeto no topo para ver o total que vale nele.",
        ],
      },
      {
        title: "Tirar o que não usa",
        items: [
          "Skills, comandos e agentes: Remover manda para a Lixeira.",
          "Plugins: Desligar (volta com um clique) ou Remover.",
          "Servidores MCP: Remover, feito pelo próprio Claude Code.",
          "Programas instalados: o Veocode só copia o comando de remoção.",
          "O que não dá para tirar daqui mostra \"como tirar?\" com o caminho.",
        ],
      },
    ],
  },
  {
    id: "raiox",
    title: "Raio-X",
    view: "system",
    where: "Sexto ícone do menu lateral.",
    lead: "A máquina vista por dentro: o que as IAs deixaram no disco e o que está rodando agora.",
    sections: [
      {
        title: "As quatro abas",
        items: [
          "Caches e pastas grandes: quanto cada IA e cada gerenciador de pacotes ocupa. Marque e limpe (vai para a Lixeira).",
          "Instalado pelas IAs: pacotes que o Claude Code instalou (brew, npm, pip…), lidos dos históricos, com o comando para remover.",
          "VMs e containers: Docker, Lima, UTM, Parallels, VirtualBox. Os do Docker e do Lima dá para ligar e parar daqui.",
          "Agentes rodando: cada IA aberta, os programas que ela abriu, portas e um gráfico de CPU.",
        ],
      },
      {
        title: "Bom saber",
        items: ["Encerrar só vale para programas que um agente abriu.", "Remover um pacote nunca é feito pelo Veocode: ele copia o comando para você rodar se quiser."],
      },
    ],
  },
  {
    id: "skills",
    title: "Skills e MCP",
    view: "skills",
    where: "Sétimo ícone do menu lateral.",
    lead: "O que cada conta do Claude sabe fazer além do básico, e de onde isso vem: da conta, de um plugin ou do projeto.",
    sections: [
      {
        title: "Três camadas",
        items: [
          "Da conta: vale em tudo o que aquela conta abrir.",
          "Plugins: pacotes que trazem várias skills e servidores MCP juntos.",
          "Do projeto: arquivos dentro da pasta (.claude/ e .mcp.json), que vão junto no git.",
        ],
      },
      {
        title: "O que dá para fazer",
        items: [
          "Buscar e filtrar por tipo.",
          "Abrir uma skill para ler o conteúdo dela.",
          "Para tirar ou desligar algo, use o Inventário.",
        ],
      },
      {
        title: "Segurança",
        items: ["Dos servidores MCP aparecem só o comando e os nomes das variáveis. Valores de chaves e tokens nunca são lidos para a tela."],
      },
    ],
  },
  {
    id: "ajustes",
    title: "Ajustes",
    view: "settings",
    where: "Último ícone do menu lateral, a engrenagem.",
    lead: "Como o Veocode aparece. Cada opção é um cartão com a prévia: clique no que preferir e a mudança vale na hora, em todas as telas.",
    sections: [
      {
        title: "O que dá para mudar",
        items: [
          "Ícones detalhados: pastas com volume e cor (src azul, testes verdes, assets rosa, node_modules cinza…), arquivos com a etiqueta do tipo (TS, RS, CSS…) e cada projeto com uma cor e a sigla da tecnologia.",
          "Ícones minimalistas: traços finos de uma cor só, mais discretos.",
          "Animações completas ou reduzidas: reduzidas tira laços e deslizes para quem se incomoda com movimento.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "Os ajustes ficam em settings.json, na pasta de configuração do app. O botão Mostrar abre essa pasta.",
          "A tela também mostra onde ficam os projetos, as contas e as conversas, e que as chaves de API ficam no chaveiro do sistema.",
        ],
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
      ["Skill", "Um arquivo de instruções extra que ensina a IA a fazer algo (criar PDFs, revisar código…). Só o nome e a descrição ficam sempre carregados."],
      ["Comando", "Um atalho de barra (/nome) que dispara um pedido pronto."],
      ["MCP", "Um programa que dá ferramentas novas à IA (falar com o GitHub, com o Figma, com um banco de dados…). Roda enquanto a conversa está aberta."],
      ["Plugin", "Um pacote que instala várias skills, comandos e servidores MCP de uma vez."],
      ["Token", "A unidade em que a IA mede texto (mais ou menos ¾ de uma palavra). Planos e limites são contados em tokens."],
      ["Contexto fixo", "Tokens que entram em toda conversa antes de você escrever: o nome e a descrição das skills ligadas."],
      ["Nível de acesso", "O quanto a IA pode mexer na pasta: Leitura, Sugerir, Editar ou Total."],
      ["Cache", "Arquivos guardados para acelerar da próxima vez. Pode ser apagado: o programa baixa de novo o que precisar."],
      ["Lixeira", "Para onde o Veocode manda tudo o que tira. Dá para recuperar de lá."],
      ["Git", "O histórico de versões da pasta. Cada versão salva é um commit; dá para ver o que mudou e voltar atrás."],
      ["Commit", "Uma versão salva no git, com uma mensagem dizendo o que mudou."],
      ["Branch", "Uma linha de trabalho separada dentro do mesmo projeto (main é a principal)."],
      ["Remoto", "A cópia do repositório em outro lugar, normalmente o GitHub (origin)."],
      ["Push / pull / fetch", "Push envia seus commits ao remoto, pull traz os de lá e junta com os seus, fetch só pergunta o que há de novo sem mudar nada."],
      ["PR", "Pull request: um pedido para juntar um branch no principal, com conversa e revisão no GitHub."],
      ["CI", "Testes automáticos que o GitHub roda a cada envio (GitHub Actions). Verde passou, vermelho falhou."],
    ],
  },
];

/** Tópico que explica a tela aberta agora. */
export const topicForView = (v: View): TopicId => topics.find((t) => t.view === v)?.id ?? "inicio";
