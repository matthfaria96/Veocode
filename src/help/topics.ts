// Textos da Ajuda: o que cada tela é, o que dá para fazer e o que é bom saber.
// Linguagem simples de propósito: é para quem está chegando agora.

import type { View } from "../store";

export type TopicId = "inicio" | "painel" | "projetos" | "nivel" | "chat" | "livre" | "contas" | "inventario" | "raiox" | "skills" | "ajustes" | "palavras";

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
          "Adicione uma pasta: na Visão geral, \"Adicionar projeto\" (ou ⌘K / Ctrl+K). Cada pasta é um projeto: um app, um site, um repositório do GitHub ou só uma pasta comum.",
          "Ligue uma conta em Contas e IAs: entre com o Claude, cole a chave do DeepSeek ou de uma API compatível com OpenAI, ou use o Ollama no próprio computador.",
          "Escolha o nível de acesso do projeto: quanto a IA pode mexer na pasta (de só ler até fazer tudo sozinha).",
          "Converse no painel do agente, na tela Projetos. Cada passo da IA aparece ao vivo: na árvore de arquivos, no editor e na Atividade.",
        ],
      },
      {
        title: "Bom saber",
        items: [
          "O sininho no topo junta tudo o que espera você: IA pedindo permissão, erro, conflito no git, conta sem login, commits só neste computador. Clique num item para ir direto onde se resolve. Quando a IA de outro projeto termina, aparece um aviso.",
          "Nada é apagado de vez: o que o Veocode tira vai para a Lixeira.",
          "Chaves de API ficam no chaveiro do sistema, nunca num arquivo.",
          "O projeto \"demo · simulação\" só aparece enquanto você não tem nenhuma pasta: é uma demonstração parada (aperte Assistir), com um aviso em cima, e nada ali é gravado.",
          "\"Seguir o agente\" (embaixo, ao lado da Atividade) vem desligado: a tela não troca sozinha de arquivo. Ligue se quiser que a árvore e o editor acompanhem o que a IA está mexendo.",
          "Com vários projetos rodando, a Visão geral mostra todos de uma vez e até 4 conversas ao vivo, na divisão de tela que você escolher.",
          "⌘K (Ctrl+K no Windows) abre a busca de projetos, arquivos e ações. F1 abre esta ajuda.",
          "⌘1 a ⌘5 trocam de tela (Visão geral, Projetos, Chat livre, Contas, Computador). ⌘N começa uma conversa nova no projeto ou no Chat livre.",
          "Passe o mouse numa mensagem para copiar o texto; nos seus pedidos, a seta volta o texto para a caixa para você ajustar e mandar de novo. Blocos de código têm o botão Copiar.",
        ],
      },
    ],
  },
  {
    id: "painel",
    title: "Visão geral",
    view: "board",
    where: "Primeiro ícone do menu lateral (quatro quadrados).",
    lead: "Todos os seus projetos num lugar só. Em Panorama você vê como cada um está; em Ao vivo você acompanha até 4 conversas ao mesmo tempo, dividindo a tela como quiser. O trabalho de verdade (arquivos, editor, terminal) fica na tela Projetos.",
    sections: [
      {
        title: "Panorama",
        items: [
          "Um cartão por projeto: a situação agora (pedindo permissão, trabalhando, com erro ou parado), a última fala da conversa, a conta, o nível de acesso e o git (↑ para enviar, ↓ para baixar, ● mudados).",
          "Quem precisa de você vem primeiro: um pedido de permissão deixa o cartão com borda amarela piscando.",
          "Também conta o que a IA faz fora do Veocode: o Claude aberto no Terminal ou no editor aparece como agente aberto naquela pasta.",
          "Clicar no cartão abre o projeto completo. O botão de duas colunas no cartão manda o projeto para Ao vivo.",
        ],
      },
      {
        title: "Ao vivo",
        items: [
          "Em \"Dividir a tela em\", escolha: um projeto na tela inteira, dois lado a lado, dois um em cima do outro, três (um grande e dois menores) ou quatro.",
          "Cada espaço vazio mostra a lista de projetos para escolher. Se você escolher mais projetos do que cabem, eles ficam em \"Fora da tela\": um clique traz de volta.",
          "Cada espaço mostra a conversa rolando ao vivo e tem a caixa para pedir, o botão de parar e os cartões de Permitir e Recusar.",
          "No topo de cada espaço: trocar o projeto (clicando no nome), mudar de lugar (setas), pôr em destaque na tela inteira (Esc volta), abrir o projeto completo e tirar dali.",
          "Tirar dali ou trocar de tela não para nada: a IA continua trabalhando e a conversa continua guardada.",
        ],
      },
      {
        title: "Quem trabalha onde",
        items: ["A conta de cada projeto aparece no cartão. Para ver e trocar todas de uma vez, use Contas e IAs."],
      },
    ],
  },
  {
    id: "projetos",
    title: "Projetos",
    view: "workspace",
    where: "Terceiro ícone do menu lateral. Troque de projeto pelo nome no topo da tela.",
    lead: "A mesa de trabalho de um projeto: os arquivos, o editor, a conversa com a IA e tudo o que ela está fazendo, ao vivo.",
    sections: [
      {
        title: "As partes da tela",
        items: [
          "Esquerda: a árvore de arquivos. Marcas coloridas mostram o que foi lido, editado, criado ou apagado.",
          "Meio: o editor. Clique no texto e escreva: ele grava sozinho (em cima aparece Salvando… e depois Salvo). ⌘S (Ctrl+S) grava na hora. As linhas que a IA mudou ficam destacadas.",
          "Embaixo: Atividade (cada passo da IA e cada mudança no disco), Comandos do agente (o que a IA rodou e a saída) e Terminal (um terminal seu, de verdade, nesta pasta). Arraste a borda de cima para deixar o painel mais alto.",
          "Direita: o painel do agente, com três abas: Agente (a conversa; o nível de acesso abre clicando no selo do nível), Rastro (o que a IA deixou fora e dentro da pasta) e Git.",
          "Embaixo, o botão Simples/Avançado: no Avançado aparece à esquerda uma coluna com todos os projetos, um embaixo do outro, para trocar com um clique sem sair da tela.",
          "Em cima, \"IAs abertas\" conta cada Claude aberto agora no computador (no VS Code, no app do Claude, no Terminal…). Passe o mouse para ver onde estão.",
          "Cursores coloridos (um por conta, e um para cada subagente) mostram onde a IA está mexendo agora.",
        ],
      },
      {
        title: "Arquivos e pastas",
        items: [
          "Os botões em cima da árvore criam um arquivo ou uma pasta novos na raiz do projeto.",
          "O botão ⋯ que aparece ao passar o mouse num item (ou o clique direito) cria dentro dele, renomeia, copia o caminho, mostra no Finder/Explorer, abre com o programa padrão (imagens, PDFs…) e manda para a Lixeira.",
          "Nada é apagado de vez: vai para a Lixeira do sistema, e o Veocode sempre pergunta antes.",
          "F2 renomeia o item escolhido. Arquivos que não são texto abrem com o programa padrão do sistema.",
          "⌘K (Ctrl+K) também busca qualquer arquivo do projeto aberto pelo nome.",
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
        title: "Rastro: o que a IA deixou",
        items: [
          "Pastas fora do projeto: lugares fora da pasta onde a IA criou ou copiou coisas (por exemplo, um editor do jogo gerado ao lado do jogo). Ficam ligadas ao projeto mesmo depois, e dá para abrir como projeto, mostrar no Finder ou esquecer.",
          "Se uma pasta foi criada por fora, \"Ligar uma pasta\" junta ela ao projeto à mão.",
          "Sobras dentro da pasta: arquivos de debug, logs, backups e cópias, e arquivos que a IA criou e o git ainda não acompanha. Dá para mandar para a Lixeira.",
          "Instalado no computador: programas e IAs locais (Ollama, Hugging Face, LM Studio) que a IA instalou ou baixou a pedido deste projeto. Eles valem para o computador todo.",
          "Sites, buscas e conexões: as páginas que a IA leu, o que ela pesquisou e as conexões (MCP) que usou.",
          "Tudo é lido dos históricos do Claude Code. Se os históricos forem apagados, o que já foi achado continua guardado no Veocode.",
        ],
      },
      {
        title: "Git e GitHub do projeto",
        items: [
          "A aba Git (no painel da direita, ou clicando no nome do branch embaixo do projeto) mostra o estado do git deste projeto, sozinho.",
          "No topo: o branch, e as setas ↑ (commits daqui que o remoto ainda não tem) e ↓ (commits do remoto que ainda não estão aqui).",
          "Mudanças não salvas no git: os arquivos alterados, novos ou apagados desde o último commit. Clicar abre o arquivo no editor.",
          "Commits: um desenho com uma linha colorida por branch, que se separa e se junta como no GitHub. Bolinha vazia é commit que só existe neste computador; cheia é o que já está no remoto. Clique num commit para ver os arquivos que ele mudou, e num arquivo para ver as linhas.",
          "No fim da aba, a explicação das letras da árvore de arquivos (L lido, B busca, M modificado, N novo, A apagado).",
          "Branches, stash (mudanças deixadas de lado) e remotos, com um botão para abrir o repositório no navegador.",
          "Com o GitHub CLI (gh) instalado e logado aparecem também: repositório (público ou privado, issues, versão), testes automáticos (CI) do branch e PRs abertos com o estado dos checks.",
          "Buscar (git fetch) pergunta ao remoto o que há de novo, sem mudar seus arquivos. O Veocode não faz commit, push nem pull: isso fica com você no Terminal ou com a IA, pelo nível de acesso.",
          "Na Visão geral e embaixo do nome do projeto, um resumo: ↑ para enviar, ↓ para baixar e ● arquivos mudados.",
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
    where: "Quarto ícone do menu lateral (dois balões).",
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
    where: "Quinto ícone do menu lateral.",
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
    title: "Computador: extras do Claude",
    view: "inventory",
    where: "Sexto ícone do menu lateral (o monitor), aba \"Extras do Claude\".",
    lead: "Habilidades a mais que alguém instalou para o Claude, onde cada uma vale e quanto pesa. Você não precisa mexer aqui para o Veocode funcionar: é para ver e, se quiser, tirar o que não usa.",
    sections: [
      {
        title: "Os quatro tipos",
        items: [
          "Receitas (skills): instruções prontas para um tipo de tarefa. O Claude usa sozinho quando o pedido combina.",
          "Atalhos /: comandos que você digita no chat começando com barra, como /revisar.",
          "Ajudantes: Claudes especializados que o principal chama para uma parte do trabalho.",
          "Conexões (MCP): pontes para outros programas e sites, como Figma ou GitHub.",
          "Pacotes (plugins): conjuntos que trazem várias receitas e conexões juntas.",
        ],
      },
      {
        title: "Como ler uma linha",
        items: [
          "A etiqueta embaixo do nome diz onde vale: \"todos os projetos da conta\" ou o nome de uma pasta.",
          "A pílula diz a situação: ligado, desligado, aberto ou \"falta programa\" (não vai funcionar).",
          "Clique na linha para ver os detalhes e, nas receitas, \"Ler o que ela diz\".",
          "Escolha um projeto no topo para ver só o que vale nele e quanto isso pesa em toda conversa (\"contexto fixo\").",
        ],
      },
      {
        title: "Instalei algo: fica só no projeto ou no computador?",
        items: [
          "Depende de como foi instalado. Cada linha mostra \"vale em\" (em quais projetos funciona) e \"guardado\" (onde os arquivos estão).",
          "Skill na pasta .claude/skills do projeto (comum em repositórios do GitHub): só vale naquele projeto e vai junto no git.",
          "Skill em ~/.claude/skills: vale em todos os projetos da conta neste computador.",
          "Plugin instalado com /plugin: sempre é baixado para o computador; na instalação, \"user\" liga em todos os projetos e \"project\" ou \"local\" liga só no projeto onde você estava.",
          "Conexão com claude mcp add: sem opção, vale só na pasta onde rodou; --scope project grava .mcp.json no projeto; --scope user vale em todos.",
          "Programas que uma skill instala (npm, pip, brew) ficam no computador todo.",
          "Cada conta do Claude no Veocode tem a sua pasta: o que uma conta instalou não aparece na outra.",
        ],
      },
      {
        title: "Tirar o que não usa",
        items: [
          "Receitas, atalhos e ajudantes: Remover manda para a Lixeira.",
          "Pacotes: Desligar (volta com um clique) ou Remover.",
          "Conexões: Remover, feito pelo próprio Claude.",
          "Antes de tirar qualquer coisa, o Veocode pergunta. Senhas e chaves das conexões nunca aparecem na tela.",
        ],
      },
    ],
  },
  {
    id: "raiox",
    title: "Computador: espaço e memória",
    view: "system",
    where: "Sexto ícone do menu lateral (o monitor), aba \"Espaço e memória\". O botão \"Liberar espaço\" no topo também abre aqui.",
    lead: "O que as IAs deixaram no disco e o que está aberto agora no computador.",
    sections: [
      {
        title: "As cinco partes",
        items: [
          "Espaço ocupado: arquivos temporários e históricos das IAs. Marque e mande para a Lixeira.",
          "Instalado pelas IAs: programas que o Claude instalou enquanto trabalhava, com o projeto que pediu e o comando para remover. Valem para o computador todo.",
          "IAs locais: modelos baixados para rodar no próprio computador (Ollama, LM Studio, Hugging Face), o tamanho e, quando dá, de qual projeto veio o pedido.",
          "Máquinas virtuais: Docker e afins. Os do Docker e do Lima dá para ligar e parar daqui. Containers criados pelo Docker Compose mostram a pasta do projeto que criou.",
          "IAs abertas agora: cada IA aberta, onde ela está (VS Code, app do Claude, Terminal…), o que ela abriu e quanta memória usa.",
        ],
      },
      {
        title: "Bom saber",
        items: ["Nada é apagado sem você confirmar, e tudo vai para a Lixeira.", "Encerrar só vale para programas que uma IA abriu.", "Remover um programa nunca é feito pelo Veocode: ele copia o comando para você rodar se quiser."],
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
          "Claro ou escuro: tema escuro, claro ou igual ao do computador (troca sozinho). O terminal continua escuro.",
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
