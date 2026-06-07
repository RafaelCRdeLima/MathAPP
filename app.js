const TOTAL_STEPS = 100;
const QUESTIONS_PER_STEP = 5;
const STORAGE_KEY = "trilha-obmep-progress-v1";

const levels = [
  { id: "nivel1", label: "Nível 1", range: "6º e 7º anos", theme: "Fundamentos visuais" },
  { id: "nivel2", label: "Nível 2", range: "8º e 9º anos", theme: "Estratégias e estrutura" },
  { id: "nivel3", label: "Nível 3", range: "Ensino médio", theme: "Generalização" },
];

let questionBank = { questions: [] };

const state = {
  level: "nivel1",
  step: 1,
  queue: [],
  currentIndex: 0,
  selected: null,
  answered: false,
  mistakes: [],
  completed: 0,
  correctIds: new Set(),
  stepQuestions: [],
  xp: 0,
  streak: 0,
  reviewing: false,
  finished: false,
};

const $ = (id) => document.getElementById(id);

function init() {
  renderLevels();
  const requestedLevel = new URLSearchParams(window.location.search).get("level");
  if (levels.some((level) => level.id === requestedLevel)) {
    state.level = requestedLevel;
  }
  loadQuestionBank().then(() => {
    if (requestedLevel) {
      startLevel(state.level);
      return;
    }
    restoreProgress() || startLevel(state.level);
  });
  $("resetButton").addEventListener("click", () => startStep(state.step));
  $("clearProgressButton").addEventListener("click", clearSavedProgress);
  $("skipButton").addEventListener("click", skipQuestion);
  $("nextButton").addEventListener("click", handlePrimary);
  $("whyButton").addEventListener("click", () => {
    $("explanationPanel").hidden = !$("explanationPanel").hidden;
  });
}

async function loadQuestionBank() {
  try {
    const response = await fetch("questions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`questions.json HTTP ${response.status}`);
    questionBank = await response.json();
  } catch (error) {
    console.warn("Usando gerador interno: questions.json nao carregou.", error);
    questionBank = { questions: [] };
  }
}

function renderLevels() {
  $("levelButtons").innerHTML = levels
    .map((level) => `
      <button class="level-button" type="button" data-level="${level.id}">
        <span>${level.label}</span>
        <small>${level.range}</small>
      </button>
    `)
    .join("");

  document.querySelectorAll(".level-button").forEach((button) => {
    button.addEventListener("click", () => startLevel(button.dataset.level));
  });
}

function startLevel(level) {
  state.level = level;
  state.step = 1;
  state.xp = 0;
  state.streak = 0;
  state.finished = false;
  document.querySelectorAll(".level-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.level === level);
  });
  startStep(1);
}

function startStep(step) {
  state.step = step;
  state.stepQuestions = generateStep(state.level, step);
  state.queue = state.stepQuestions;
  state.currentIndex = 0;
  state.selected = null;
  state.answered = false;
  state.mistakes = [];
  state.correctIds = new Set();
  state.completed = 0;
  state.reviewing = false;
  state.finished = false;
  renderQuestion();
  saveProgress();
}

function restoreProgress() {
  const saved = loadSavedProgress();
  if (!saved) return false;

  state.level = saved.level;
  state.step = saved.step;
  state.xp = saved.xp;
  state.streak = saved.streak;
  state.stepQuestions = generateStep(state.level, state.step);
  state.correctIds = new Set(saved.correctIds || []);
  state.completed = state.correctIds.size;
  state.mistakes = hydrateSavedQuestions(saved.mistakeIds || [], true);
  state.queue = hydrateSavedQuestions(saved.queueIds || state.stepQuestions.map((question) => question.id), saved.reviewing);
  if (!state.queue.length) state.queue = state.stepQuestions;
  state.currentIndex = Math.min(saved.currentIndex || 0, state.queue.length - 1);
  while (
    state.currentIndex < state.queue.length - 1 &&
    state.correctIds.has(state.queue[state.currentIndex].id)
  ) {
    state.currentIndex += 1;
  }
  state.selected = null;
  state.answered = false;
  state.reviewing = Boolean(saved.reviewing);
  state.finished = Boolean(saved.finished);

  document.querySelectorAll(".level-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.level === state.level);
  });

  if (state.finished) {
    renderCelebration();
  } else {
    renderQuestion();
  }
  return true;
}

function loadSavedProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !levels.some((level) => level.id === saved.level)) return null;
    if (!Number.isInteger(saved.step) || saved.step < 1 || saved.step > TOTAL_STEPS) return null;
    return saved;
  } catch {
    return null;
  }
}

function hydrateSavedQuestions(ids, review) {
  return ids
    .map((id) => state.stepQuestions.find((question) => question.id === id))
    .filter(Boolean)
    .map((question) => ({ ...question, review: Boolean(review) || Boolean(question.review) }));
}

function saveProgress() {
  const payload = {
    level: state.level,
    step: state.step,
    xp: state.xp,
    streak: state.streak,
    currentIndex: state.currentIndex,
    correctIds: [...state.correctIds],
    queueIds: state.queue.map((question) => question.id),
    mistakeIds: state.mistakes.map((question) => question.id),
    reviewing: state.reviewing,
    finished: state.finished,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearSavedProgress() {
  const confirmed = window.confirm("Apagar todo o progresso salvo neste aparelho?");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  startLevel(state.level);
}

function generateStep(level, step) {
  const officialQuestions = questionsFromBank(level, step);
  if (officialQuestions.length >= QUESTIONS_PER_STEP) return officialQuestions;

  const generators = questionGenerators[level];
  return Array.from({ length: QUESTIONS_PER_STEP }, (_, index) => {
    const generator = generators[index % generators.length];
    return {
      ...generator(step, index),
      id: `${level}-${step}-${index}`,
      step,
      originalIndex: index,
      review: false,
    };
  });
}

function questionsFromBank(level, step) {
  return questionBank.questions
    .filter((question) => question.level === level && question.step === step)
    .sort((a, b) => a.order - b.order)
    .slice(0, QUESTIONS_PER_STEP)
    .map((question, index) => ({
      ...question,
      id: question.id,
      originalIndex: index,
      review: false,
    }));
}

function makeOptions(correct, distractors, suffix = "") {
  const values = [correct, ...distractors]
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 4);

  while (values.length < 4) {
    values.push(correct + values.length + 1);
  }

  const shift = Math.abs(correct) % values.length;
  const rotated = [...values.slice(shift), ...values.slice(0, shift)];
  return {
    options: rotated.map((value) => `${value}${suffix}`),
    answer: rotated.indexOf(correct),
  };
}

function makeFractionOptions(correctNumerator, denominator) {
  const options = [
    `${correctNumerator}/${denominator}`,
    `${Math.max(1, correctNumerator - 1)}/${denominator}`,
    `${correctNumerator}/${denominator + 1}`,
    `${denominator - correctNumerator}/${denominator}`,
  ].filter((value, index, array) => array.indexOf(value) === index);

  while (options.length < 4) {
    options.push(`${correctNumerator + options.length}/${denominator + options.length}`);
  }

  const answerText = `${correctNumerator}/${denominator}`;
  return { options, answer: options.indexOf(answerText) };
}

function titleFor(level, step, skill) {
  const levelInfo = levels.find((item) => item.id === level);
  return `Passo ${step}/${TOTAL_STEPS}: ${levelInfo.theme} - ${skill}`;
}

const questionGenerators = {
  nivel1: [
    (step) => {
      const rows = 2 + (step % 4);
      const cols = 3 + (step % 5);
      const missing = Math.floor(step / 6) % 3;
      const correct = rows * cols - missing;
      const { options, answer } = makeOptions(correct, [correct - 1, rows * cols, correct + rows]);
      return {
        title: titleFor("nivel1", step, "contagem organizada"),
        skill: "Contagem organizada",
        prompt: `A figura tem ${rows} linhas e ${cols} colunas. ${missing ? `${missing} quadradinho(s) não está(ão) pintado(s).` : "Todos estão pintados."} Qual é a área pintada?`,
        options,
        answer,
        feedback: "Boa. Você organizou a contagem em linhas e colunas.",
        misconception: "O erro mais comum aqui é contar um por um e perder uma peça, ou esquecer os quadradinhos que não estão pintados.",
        explanation: `A área total seria ${rows} x ${cols} = ${rows * cols}. Como há ${missing} sem pintura, a área pintada é ${rows * cols} - ${missing} = ${correct}.`,
        visual: "gridArea",
        diagram: { rows, cols, missing },
      };
    },
    (step) => {
      const start = 2 + (step % 9);
      const jump = 2 + (step % 5);
      const terms = [start, start + jump, start + 2 * jump, start + 3 * jump];
      const correct = start + 4 * jump;
      const { options, answer } = makeOptions(correct, [correct - 1, correct + 1, start + 5 * jump]);
      return {
        title: titleFor("nivel1", step, "padrões"),
        skill: "Padrões",
        prompt: `A sequência cresce sempre do mesmo jeito: ${terms.join(", ")}. Qual é o próximo termo?`,
        options,
        answer,
        feedback: "Isso! Você percebeu a diferença constante.",
        misconception: "Olhar só para o último número pode enganar. Compare dois termos vizinhos para descobrir a regra.",
        explanation: `Cada termo aumenta ${jump}. Então o próximo é ${terms[3]} + ${jump} = ${correct}.`,
        visual: "numberSteps",
        diagram: { terms, jump },
      };
    },
    (step) => {
      const denominator = 4 + (step % 5);
      const numerator = 1 + (step % (denominator - 1));
      const { options, answer } = makeFractionOptions(numerator, denominator);
      return {
        title: titleFor("nivel1", step, "frações"),
        skill: "Frações",
        prompt: `Um retângulo foi dividido em ${denominator} partes iguais e ${numerator} foram pintadas. Que fração está pintada?`,
        options,
        answer,
        feedback: "Muito bem. Você comparou a parte com o inteiro.",
        misconception: "A fração precisa usar o total de partes iguais no denominador, não só as partes que aparecem em destaque.",
        explanation: `São ${numerator} partes pintadas de um total de ${denominator}. Portanto a fração é ${numerator}/${denominator}.`,
        visual: "fractionBar",
        diagram: { numerator, denominator },
      };
    },
    (step) => {
      const width = 4 + (step % 8);
      const height = 2 + (step % 5);
      const correct = 2 * (width + height);
      const { options, answer } = makeOptions(correct, [width * height, correct - 2, correct + 4]);
      return {
        title: titleFor("nivel1", step, "perímetro"),
        skill: "Perímetro",
        prompt: `Um retângulo mede ${width} cm por ${height} cm. Qual é o perímetro?`,
        options: options.map((option) => `${option} cm`),
        answer,
        feedback: "Certo. Perímetro é a volta da figura.",
        misconception: "Área e perímetro são ideias diferentes. Aqui queremos somar os lados, não multiplicar.",
        explanation: `A volta do retângulo é ${width} + ${height} + ${width} + ${height} = ${correct} cm.`,
        visual: "rectangle",
        diagram: { width, height },
      };
    },
    (step) => {
      const price = 3 + (step % 7);
      const amount = 2 + (step % 6);
      const paid = price * amount + 5 + (step % 4);
      const correct = paid - price * amount;
      const { options, answer } = makeOptions(correct, [correct + price, correct - 1, paid - amount]);
      return {
        title: titleFor("nivel1", step, "operações"),
        skill: "Troco",
        prompt: `Cada lápis custa R$ ${price}. Você compra ${amount} lápis e paga com R$ ${paid}. Quanto recebe de troco?`,
        options: options.map((option) => `R$ ${option}`),
        answer,
        feedback: "Boa compra matemática. Primeiro calculamos o total, depois o troco.",
        misconception: "Não subtraia só a quantidade de lápis. O custo total é preço vezes quantidade.",
        explanation: `Os lápis custam ${amount} x ${price} = R$ ${amount * price}. O troco é ${paid} - ${amount * price} = R$ ${correct}.`,
        visual: "money",
        diagram: { price, amount, paid },
      };
    },
  ],
  nivel2: [
    (step) => {
      const baseW = 4 + (step % 7);
      const baseH = 3 + (step % 4);
      const topW = 2 + (step % 4);
      const topH = 1 + (step % 3);
      const correct = baseW * baseH + topW * topH;
      const { options, answer } = makeOptions(correct, [baseW * (baseH + topH), correct - topH, correct + baseH]);
      return {
        title: titleFor("nivel2", step, "área composta"),
        skill: "Área composta",
        prompt: `Uma figura é feita por um retângulo ${baseW} x ${baseH} e outro ${topW} x ${topH} grudado em cima. Qual é a área total?`,
        options,
        answer,
        feedback: "Perfeito. Você quebrou uma figura maior em pedaços simples.",
        misconception: "Multiplicar a largura total pela altura total pode contar uma região que não existe.",
        explanation: `As áreas são ${baseW} x ${baseH} = ${baseW * baseH} e ${topW} x ${topH} = ${topW * topH}. Total: ${correct}.`,
        visual: "compositeArea",
        diagram: { baseW, baseH, topW, topH },
      };
    },
    (step) => {
      const blue = 2 + (step % 4);
      const yellow = blue + 1 + (step % 3);
      const factor = 2 + (step % 5);
      const totalYellow = yellow * factor;
      const correct = blue * factor;
      const { options, answer } = makeOptions(correct, [correct + 1, totalYellow - blue, correct + factor]);
      return {
        title: titleFor("nivel2", step, "razão"),
        skill: "Razão",
        prompt: `Para cada ${blue} círculos azuis há ${yellow} amarelos. Se há ${totalYellow} amarelos, quantos azuis há?`,
        options,
        answer,
        feedback: "Mandou bem. Razão cresce multiplicando os dois lados pelo mesmo fator.",
        misconception: "Em razão, a diferença entre as quantidades não é o melhor guia. Procure o fator de multiplicação.",
        explanation: `Os amarelos foram de ${yellow} para ${totalYellow}, isto é, multiplicaram por ${factor}. Então os azuis são ${blue} x ${factor} = ${correct}.`,
        visual: "ratioDots",
        diagram: { blue: correct, yellow: totalYellow },
      };
    },
    (step) => {
      const boxes = 2 + (step % 4);
      const extra = 1 + (step % 6);
      const weight = 3 + (step % 8);
      const total = boxes * weight + extra;
      const { options, answer } = makeOptions(weight, [Math.floor(total / boxes), weight + 1, weight - 1], " kg");
      return {
        title: titleFor("nivel2", step, "equação"),
        skill: "Equação",
        prompt: `Na balança, ${boxes} caixas iguais e ${extra} kg equilibram ${total} kg. Quanto pesa cada caixa?`,
        options,
        answer,
        feedback: "Exato. Você retirou o peso extra antes de dividir.",
        misconception: "Dividir o total direto pelo número de caixas esquece o peso extra que também está na balança.",
        explanation: `${boxes} caixas + ${extra} = ${total}. Então ${boxes} caixas = ${total - extra}, e cada caixa pesa ${(total - extra)} ÷ ${boxes} = ${weight} kg.`,
        visual: "balance",
        diagram: { boxes, extra, total },
      };
    },
    (step) => {
      const base = 40 + 10 * (step % 8);
      const percent = [10, 20, 25, 50][step % 4];
      const correct = (base * percent) / 100;
      const { options, answer } = makeOptions(correct, [correct + 5, base - correct, percent]);
      return {
        title: titleFor("nivel2", step, "porcentagem"),
        skill: "Porcentagem",
        prompt: `Em uma turma com ${base} alunos, ${percent}% participam da olimpíada. Quantos alunos participam?`,
        options,
        answer,
        feedback: "Boa. Você transformou porcentagem em parte do total.",
        misconception: "A porcentagem não é uma quantidade sozinha: ela depende do total.",
        explanation: `${percent}% de ${base} é ${percent}/100 x ${base} = ${correct}.`,
        visual: "percent",
        diagram: { percent },
      };
    },
    (step) => {
      const a = 4 + (step % 8);
      const b = a + 2 + (step % 5);
      const c = b + 2 + (step % 4);
      const correct = (a + b + c) / 3;
      const { options, answer } = makeOptions(correct, [correct + 1, b, correct - 1]);
      return {
        title: titleFor("nivel2", step, "média"),
        skill: "Média",
        prompt: `Três pontuações foram ${a}, ${b} e ${c}. Qual é a média?`,
        options,
        answer,
        feedback: "Isso. Média é redistribuir o total igualmente.",
        misconception: "Não escolha só o número do meio sem conferir. Some tudo e divida pela quantidade.",
        explanation: `A soma é ${a + b + c}. Dividindo por 3, a média é ${correct}.`,
        visual: "average",
        diagram: { values: [a, b, c], average: correct },
      };
    },
  ],
  nivel3: [
    (step) => {
      const first = 3 + (step % 10);
      const jump = 2 + (step % 7);
      const term = 6 + (step % 10);
      const correct = first + (term - 1) * jump;
      const { options, answer } = makeOptions(correct, [first + term * jump, correct - jump, correct + jump]);
      return {
        title: titleFor("nivel3", step, "progressão aritmética"),
        skill: "Progressão aritmética",
        prompt: `Uma sequência começa em ${first} e aumenta ${jump} a cada passo. Qual é o ${term}º termo?`,
        options,
        answer,
        feedback: "Boa generalização. Você contou os saltos, não só os termos.",
        misconception: `Do 1º ao ${term}º termo existem ${term - 1} saltos, não ${term}.`,
        explanation: `O ${term}º termo é ${first} + (${term} - 1) x ${jump} = ${correct}.`,
        visual: "advancedSteps",
        diagram: { term, jump },
      };
    },
    (step) => {
      const factor = 2 + (step % 5);
      const sides = [3 + (step % 4), 4 + (step % 5), 5 + (step % 6)];
      const correct = sides.reduce((sum, value) => sum + value, 0) * factor;
      const { options, answer } = makeOptions(correct, [correct + factor, correct - factor, sides[0] * factor + sides[1] + sides[2]]);
      return {
        title: titleFor("nivel3", step, "semelhança"),
        skill: "Semelhança",
        prompt: `Um triângulo tem lados ${sides.join(", ")}. Outro semelhante tem escala ${factor}. Qual é o perímetro do maior?`,
        options,
        answer,
        feedback: "Isso. A escala multiplica todos os comprimentos.",
        misconception: "Em figuras semelhantes, não somamos a mesma diferença aos lados; multiplicamos todos pelo mesmo fator.",
        explanation: `O perímetro menor é ${sides.join(" + ")} = ${sides.reduce((sum, value) => sum + value, 0)}. Multiplicando por ${factor}, dá ${correct}.`,
        visual: "triangles",
        diagram: { factor },
      };
    },
    (step) => {
      const green = 2 + (step % 5);
      const blue = 1 + (step % 4);
      const red = 3 + (step % 6);
      const total = green + blue + red;
      const favorable = green + blue;
      const simplified = simplifyFraction(favorable, total);
      const correctText = `${simplified[0]}/${simplified[1]}`;
      const options = [correctText, `${red}/${total}`, `${green}/${total}`, `${blue + red}/${total}`].filter((value, index, array) => array.indexOf(value) === index);
      while (options.length < 4) options.push(`${favorable + options.length}/${total + options.length}`);
      return {
        title: titleFor("nivel3", step, "probabilidade"),
        skill: "Probabilidade",
        prompt: `Uma urna tem ${green} verdes, ${blue} azuis e ${red} vermelhas. Qual é a probabilidade de tirar uma bola que não seja vermelha?`,
        options,
        answer: options.indexOf(correctText),
        feedback: "Excelente. Você contou o complemento corretamente.",
        misconception: "A pergunta pede o que não é vermelho, então as verdes e azuis também contam.",
        explanation: `Há ${total} bolas. As não vermelhas são ${green} + ${blue} = ${favorable}. A probabilidade é ${favorable}/${total}, que simplifica para ${correctText}.`,
        visual: "probability",
        diagram: { green, blue, red },
      };
    },
    (step) => {
      const n = 4 + (step % 8);
      const correct = (n * (n - 1)) / 2;
      const { options, answer } = makeOptions(correct, [n * (n - 1), correct + n, correct - 1]);
      return {
        title: titleFor("nivel3", step, "combinatória"),
        skill: "Combinatória",
        prompt: `${n} estudantes querem se cumprimentar uma vez cada par. Quantos cumprimentos acontecem?`,
        options,
        answer,
        feedback: "Muito bom. Você contou pares sem repetir.",
        misconception: "Se cada pessoa cumprimenta todas as outras, cada par é contado duas vezes quando fazemos n x (n - 1).",
        explanation: `Cada um teria ${n - 1} escolhas, mas cada cumprimento aparece duas vezes. Então ${n} x ${n - 1} ÷ 2 = ${correct}.`,
        visual: "network",
        diagram: { n },
      };
    },
    (step) => {
      const x = 2 + (step % 8);
      const a = 2 + (step % 4);
      const b = 1 + (step % 7);
      const correct = a * x + b;
      const { options, answer } = makeOptions(correct, [a + x + b, correct - a, correct + b]);
      return {
        title: titleFor("nivel3", step, "função linear"),
        skill: "Função linear",
        prompt: `Se f(x) = ${a}x + ${b}, qual é f(${x})?`,
        options,
        answer,
        feedback: "Certo. Você substituiu o valor antes de calcular.",
        misconception: "Não basta somar os números da expressão. Primeiro substituímos x e respeitamos a multiplicação.",
        explanation: `f(${x}) = ${a} x ${x} + ${b} = ${a * x} + ${b} = ${correct}.`,
        visual: "functionLine",
        diagram: { a, b, x },
      };
    },
  ],
};

function simplifyFraction(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function currentQuestion() {
  return state.queue[state.currentIndex];
}

function renderQuestion() {
  const question = currentQuestion();
  state.selected = null;
  state.answered = false;

  $("modePill").textContent = question.review ? "Revisão" : "Aprender";
  $("questionTitle").textContent = question.title;
  $("skillLabel").textContent = question.skill;
  $("questionPrompt").textContent = question.prompt;
  $("visualBoard").innerHTML = (visuals[question.visual] || visuals.officialCard)(question);
  $("feedbackPanel").hidden = true;
  $("feedbackPanel").classList.remove("wrong");
  $("explanationPanel").hidden = true;
  $("explanationText").textContent = question.explanation;
  $("nextButton").textContent = "Responder";
  $("nextButton").disabled = true;
  $("skipButton").disabled = false;

  $("answerZone").innerHTML = question.options
    .map((option, index) => `<button class="answer-option" type="button" data-index="${index}">${option}</button>`)
    .join("");

  document.querySelectorAll(".answer-option").forEach((button) => {
    button.addEventListener("click", () => selectAnswer(Number(button.dataset.index)));
  });

  renderProgress();
}

function selectAnswer(index) {
  if (state.answered) return;
  state.selected = index;
  document.querySelectorAll(".answer-option").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.index) === index);
  });
  $("nextButton").disabled = false;
}

function handlePrimary() {
  if (state.finished) {
    if (state.step < TOTAL_STEPS) {
      startStep(state.step + 1);
    } else {
      startLevel(state.level);
    }
    return;
  }

  if (!state.answered) {
    submitAnswer();
    return;
  }
  moveNext();
}

function submitAnswer() {
  const question = currentQuestion();
  const correct = state.selected === question.answer;
  state.answered = true;

  document.querySelectorAll(".answer-option").forEach((button) => {
    const index = Number(button.dataset.index);
    button.classList.toggle("correct", index === question.answer);
    button.classList.toggle("wrong", index === state.selected && !correct);
  });

  if (correct) {
    if (!state.correctIds.has(question.id)) {
      state.correctIds.add(question.id);
      state.completed = state.correctIds.size;
    }
    state.xp += question.review ? 8 : 12;
    state.streak += 1;
    $("feedbackTitle").textContent = question.review ? "Agora ficou sólido!" : "Muito bem!";
    $("feedbackText").textContent = question.feedback;
  } else {
    state.streak = 0;
    state.mistakes.push({ ...question, review: true });
    $("feedbackPanel").classList.add("wrong");
    $("feedbackTitle").textContent = "Boa tentativa. Vamos ajustar.";
    $("feedbackText").textContent = question.misconception;
  }

  $("feedbackPanel").hidden = false;
  $("nextButton").textContent = nextButtonLabelAfterAnswer();
  $("skipButton").disabled = true;
  renderProgress();
  saveProgress();
}

function skipQuestion() {
  const question = currentQuestion();
  state.mistakes.push({ ...question, review: true });
  saveProgress();
  moveNext();
}

function nextButtonLabelAfterAnswer() {
  if (state.currentIndex < state.queue.length - 1) return "Continuar";
  if (state.mistakes.length) return "Revisar erros";
  return state.correctIds.size === QUESTIONS_PER_STEP ? "Concluir" : "Continuar";
}

function moveNext() {
  if (state.currentIndex < state.queue.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
    saveProgress();
    return;
  }

  if (state.mistakes.length) {
    state.queue = state.mistakes.splice(0);
    state.currentIndex = 0;
    state.reviewing = true;
    renderQuestion();
    saveProgress();
    return;
  }

  if (state.correctIds.size === QUESTIONS_PER_STEP) {
    renderCelebration();
  }
}

function renderCelebration() {
  const finishedLevel = state.step >= TOTAL_STEPS;
  state.finished = true;
  $("modePill").textContent = finishedLevel ? "Nível concluído" : "Concluído";
  $("questionTitle").textContent = finishedLevel ? "Parabéns, você completou este nível!" : `Parabéns, passo ${state.step} finalizado!`;
  $("skillLabel").textContent = finishedLevel ? "Trilha completa" : `Passo ${state.step + 1} liberado`;
  $("questionPrompt").textContent = finishedLevel
    ? "Você atravessou os 100 passos deste nível. Dá para reiniciar o nível ou escolher outro no painel."
    : "Você fechou este conjunto. O próximo usa as mesmas ideias com mais camadas, como uma trilha de treino da OBMEP.";
  $("visualBoard").innerHTML = visuals.celebration();
  $("answerZone").innerHTML = `
    <button class="answer-option selected" type="button">Passo ${state.step}/${TOTAL_STEPS}</button>
    <button class="answer-option selected" type="button">XP total: ${state.xp}</button>
  `;
  $("feedbackPanel").hidden = false;
  $("feedbackPanel").classList.remove("wrong");
  $("feedbackTitle").textContent = finishedLevel ? "Nível dominado" : "Trilha atualizada";
  $("feedbackText").textContent = finishedLevel
    ? "Excelente trabalho. Você concluiu todos os conjuntos deste nível."
    : `Agora vem o passo ${state.step + 1}, com 5 novas questões um pouco mais avançadas.`;
  $("explanationPanel").hidden = true;
  $("nextButton").textContent = finishedLevel ? "Recomeçar nível" : `Ir para passo ${state.step + 1}`;
  $("nextButton").disabled = false;
  $("skipButton").disabled = true;
  renderProgress(1);
  saveProgress();
}

function sourceText(question) {
  if (!question.source) return "";
  const parts = [
    question.source.competition,
    question.source.year,
    question.source.phase,
    question.source.levelLabel,
    question.source.questionNumber ? `questao ${question.source.questionNumber}` : "",
  ].filter(Boolean);
  return parts.join(" - ");
}

function renderProgress(forceRatio) {
  const ratio = forceRatio ?? Math.min(state.correctIds.size / QUESTIONS_PER_STEP, 1);
  const percent = Math.round(ratio * 100);
  const levelPercent = Math.round(((state.step - 1 + ratio) / TOTAL_STEPS) * 100);
  $("progressRing").style.strokeDashoffset = 314 - 314 * ratio;
  $("progressPercent").textContent = `${percent}%`;
  $("setLabel").textContent = state.reviewing ? `Revisão do passo ${state.step}` : `Passo ${state.step}/${TOTAL_STEPS}`;
  $("xpLabel").textContent = `${state.xp} XP`;
  $("streakLabel").textContent = `${levelPercent}% do nível`;

  const current = currentQuestion();
  const revealThrough = Math.min(
    QUESTIONS_PER_STEP - 1,
    Math.max(state.correctIds.size, current?.originalIndex ?? 0)
  );

  $("skillMap").innerHTML = state.stepQuestions
    .slice(0, revealThrough + 1)
    .map((question, index) => {
      const isCorrect = state.correctIds.has(question.id);
      const isCurrent = current?.id === question.id && !isCorrect;
      const status = isCorrect ? "done" : isCurrent ? "active" : "";
      return `
        <div class="skill-node ${status}">
          <span class="skill-dot">${index + 1}</span>
          <span>${question.skill}</span>
        </div>
      `;
    })
    .join("");
}

const visuals = {
  officialCard: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Questao oficial da OBMEP">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <rect x="45" y="38" width="270" height="184" rx="8" fill="#ffffff" stroke="#17202a" stroke-width="3"/>
      <rect x="45" y="38" width="270" height="42" rx="8" fill="#47a447"/>
      <text x="180" y="65" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="900">OBMEP oficial</text>
      <text x="180" y="119" text-anchor="middle" fill="#17202a" font-size="19" font-weight="900">${question.source?.year || ""} - ${question.source?.levelLabel || ""}</text>
      <text x="180" y="151" text-anchor="middle" fill="#60707f" font-size="15" font-weight="800">${question.source?.phase || ""}</text>
      <text x="180" y="183" text-anchor="middle" fill="#ee6c4d" font-size="17" font-weight="900">Questao ${question.source?.questionNumber || ""}</text>
    </svg>`,
  gridArea: (question) => {
    const { rows, cols, missing } = question.diagram;
    const total = rows * cols;
    return `
      <svg viewBox="0 0 360 300" role="img" aria-label="Grade de quadradinhos">
        <rect width="360" height="300" fill="#f6f8f4"/>
        ${Array.from({ length: total }, (_, i) => {
          const size = Math.min(42, 230 / Math.max(rows, cols));
          const gap = 7;
          const x = 180 - (cols * size + (cols - 1) * gap) / 2 + (i % cols) * (size + gap);
          const y = 150 - (rows * size + (rows - 1) * gap) / 2 + Math.floor(i / cols) * (size + gap);
          const painted = i < total - missing;
          return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="${painted ? "#47a447" : "#ffffff"}" stroke="#17202a" stroke-width="3"/>`;
        }).join("")}
      </svg>`;
  },
  numberSteps: (question) => {
    const { terms, jump } = question.diagram;
    return `
      <svg viewBox="0 0 360 260" role="img" aria-label="Sequência numérica">
        <rect width="360" height="260" fill="#f6f8f4"/>
        ${[...terms, "?"].map((n, i) => `<g transform="translate(${36 + i * 68} 112)"><circle r="25" fill="${i === 4 ? "#f2c94c" : "#2f80ed"}"/><text y="8" text-anchor="middle" fill="white" font-size="20" font-weight="800">${n}</text></g>`).join("")}
        ${[0, 1, 2, 3].map((i) => `<path d="M${66 + i * 68} 112 H${91 + i * 68}" stroke="#60707f" stroke-width="4"/><text x="${78 + i * 68}" y="92" text-anchor="middle" fill="#60707f" font-size="15" font-weight="800">+${jump}</text>`).join("")}
      </svg>`;
  },
  fractionBar: (question) => {
    const { numerator, denominator } = question.diagram;
    return `
      <svg viewBox="0 0 360 250" role="img" aria-label="Barra de fração">
        <rect width="360" height="250" fill="#f6f8f4"/>
        ${Array.from({ length: denominator }, (_, i) => {
          const w = 260 / denominator;
          return `<rect x="${50 + i * w}" y="82" width="${w}" height="86" fill="${i < numerator ? "#ee6c4d" : "#ffffff"}" stroke="#17202a" stroke-width="3"/>`;
        }).join("")}
        <text x="180" y="205" text-anchor="middle" fill="#60707f" font-size="18" font-weight="800">${numerator} de ${denominator}</text>
      </svg>`;
  },
  rectangle: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Retângulo com medidas">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <rect x="82" y="70" width="196" height="112" rx="4" fill="#ffffff" stroke="#17202a" stroke-width="4"/>
      <text x="180" y="56" text-anchor="middle" fill="#2f80ed" font-size="22" font-weight="900">${question.diagram.width} cm</text>
      <text x="300" y="134" fill="#47a447" font-size="22" font-weight="900">${question.diagram.height} cm</text>
      <path d="M82 202 H278 M60 70 V182" stroke="#60707f" stroke-width="3" stroke-dasharray="8 7"/>
    </svg>`,
  money: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Compra com dinheiro">
      <rect width="360" height="260" fill="#f6f8f4"/>
      ${Array.from({ length: Math.min(question.diagram.amount, 7) }, (_, i) => `<rect x="${58 + i * 34}" y="82" width="14" height="102" rx="6" fill="#f2c94c" stroke="#17202a" stroke-width="3"/><path d="M${65 + i * 34} 70 V82" stroke="#ee6c4d" stroke-width="5"/>`).join("")}
      <rect x="95" y="190" width="170" height="44" rx="8" fill="#47a447" stroke="#17202a" stroke-width="3"/>
      <text x="180" y="219" text-anchor="middle" fill="white" font-size="20" font-weight="900">R$ ${question.diagram.paid}</text>
    </svg>`,
  compositeArea: (question) => `
    <svg viewBox="0 0 360 280" role="img" aria-label="Figura composta por retângulos">
      <rect width="360" height="280" fill="#f6f8f4"/>
      <rect x="70" y="120" width="210" height="105" fill="#2f80ed" stroke="#17202a" stroke-width="3"/>
      <rect x="140" y="50" width="90" height="70" fill="#47a447" stroke="#17202a" stroke-width="3"/>
      <text x="175" y="180" text-anchor="middle" fill="white" font-size="22" font-weight="900">${question.diagram.baseW} x ${question.diagram.baseH}</text>
      <text x="185" y="93" text-anchor="middle" fill="white" font-size="18" font-weight="900">${question.diagram.topW} x ${question.diagram.topH}</text>
    </svg>`,
  ratioDots: (question) => `
    <svg viewBox="0 0 360 250" role="img" aria-label="Razão entre círculos">
      <rect width="360" height="250" fill="#f6f8f4"/>
      ${Array.from({ length: Math.min(question.diagram.blue, 16) }, (_, i) => `<circle cx="${45 + (i % 8) * 34}" cy="${70 + Math.floor(i / 8) * 34}" r="13" fill="#2f80ed"/>`).join("")}
      ${Array.from({ length: Math.min(question.diagram.yellow, 18) }, (_, i) => `<circle cx="${45 + (i % 9) * 31}" cy="${160 + Math.floor(i / 9) * 34}" r="13" fill="#f2c94c"/>`).join("")}
      <text x="180" y="128" text-anchor="middle" fill="#60707f" font-size="16" font-weight="900">mesmo fator</text>
    </svg>`,
  balance: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Balança equilibrada">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <path d="M180 55 V185 M110 185 H250 M95 92 H265" stroke="#17202a" stroke-width="6" stroke-linecap="round"/>
      <path d="M95 92 L62 160 H128 Z M265 92 L232 160 H298 Z" fill="#ffffff" stroke="#17202a" stroke-width="3"/>
      <text x="95" y="142" text-anchor="middle" fill="#2f80ed" font-size="18" font-weight="900">${question.diagram.boxes}x+${question.diagram.extra}</text>
      <text x="265" y="142" text-anchor="middle" fill="#47a447" font-size="20" font-weight="900">${question.diagram.total}</text>
    </svg>`,
  percent: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Porcentagem em grade">
      <rect width="360" height="260" fill="#f6f8f4"/>
      ${Array.from({ length: 100 }, (_, i) => `<rect x="${55 + (i % 10) * 25}" y="${35 + Math.floor(i / 10) * 18}" width="18" height="12" rx="2" fill="${i < question.diagram.percent ? "#47a447" : "#ffffff"}" stroke="#dce5ea"/>`).join("")}
      <text x="180" y="238" text-anchor="middle" fill="#17202a" font-size="28" font-weight="900">${question.diagram.percent}%</text>
    </svg>`,
  average: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Barras para média">
      <rect width="360" height="260" fill="#f6f8f4"/>
      ${question.diagram.values.map((value, i) => `<rect x="${85 + i * 65}" y="${205 - value * 10}" width="38" height="${value * 10}" rx="5" fill="#2f80ed"/><text x="${104 + i * 65}" y="230" text-anchor="middle" fill="#60707f" font-size="16" font-weight="900">${value}</text>`).join("")}
      <path d="M70 ${205 - question.diagram.average * 10} H280" stroke="#ee6c4d" stroke-width="4" stroke-dasharray="8 6"/>
    </svg>`,
  advancedSteps: (question) => `
    <svg viewBox="0 0 360 250" role="img" aria-label="Saltos de uma progressão">
      <rect width="360" height="250" fill="#f6f8f4"/>
      <path d="M45 150 H315" stroke="#17202a" stroke-width="4"/>
      ${Array.from({ length: Math.min(question.diagram.term, 10) }, (_, i) => `<g><circle cx="${45 + i * 30}" cy="150" r="8" fill="${i === 0 || i === question.diagram.term - 1 ? "#ee6c4d" : "#2f80ed"}"/><text x="${45 + i * 30}" y="184" text-anchor="middle" fill="#60707f" font-size="12" font-weight="800">${i + 1}º</text></g>`).join("")}
      <text x="180" y="88" text-anchor="middle" fill="#60707f" font-size="20" font-weight="900">saltos de ${question.diagram.jump}</text>
    </svg>`,
  triangles: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Triângulos semelhantes">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <path d="M55 190 L115 190 L55 110 Z" fill="#2f80ed" stroke="#17202a" stroke-width="3"/>
      <path d="M180 205 L315 205 L180 25 Z" fill="#47a447" stroke="#17202a" stroke-width="3"/>
      <text x="85" y="213" text-anchor="middle" fill="#60707f" font-size="16" font-weight="900">menor</text>
      <text x="248" y="230" text-anchor="middle" fill="#60707f" font-size="16" font-weight="900">escala x${question.diagram.factor}</text>
    </svg>`,
  probability: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Urna com bolas coloridas">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <path d="M105 55 H255 L235 218 H125 Z" fill="#ffffff" stroke="#17202a" stroke-width="4"/>
      ${[
        ...Array.from({ length: question.diagram.green }, () => "#47a447"),
        ...Array.from({ length: question.diagram.blue }, () => "#2f80ed"),
        ...Array.from({ length: question.diagram.red }, () => "#ee6c4d"),
      ].map((color, i) => `<circle cx="${135 + (i % 5) * 25}" cy="${92 + Math.floor(i / 5) * 32}" r="12" fill="${color}" stroke="#17202a" stroke-width="2"/>`).join("")}
    </svg>`,
  network: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Pessoas formando pares">
      <rect width="360" height="260" fill="#f6f8f4"/>
      ${Array.from({ length: question.diagram.n }, (_, i) => {
        const angle = (Math.PI * 2 * i) / question.diagram.n;
        const x = 180 + Math.cos(angle) * 85;
        const y = 130 + Math.sin(angle) * 85;
        return `<circle cx="${x}" cy="${y}" r="14" fill="#2f80ed" stroke="#17202a" stroke-width="3"/>`;
      }).join("")}
      <text x="180" y="136" text-anchor="middle" fill="#60707f" font-size="18" font-weight="900">pares</text>
    </svg>`,
  functionLine: (question) => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Reta de função linear">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <path d="M55 205 H315 M70 220 V45" stroke="#17202a" stroke-width="4" stroke-linecap="round"/>
      <path d="M78 190 L292 68" stroke="#47a447" stroke-width="6" stroke-linecap="round"/>
      <circle cx="220" cy="110" r="12" fill="#ee6c4d" stroke="#17202a" stroke-width="3"/>
      <text x="180" y="38" text-anchor="middle" fill="#60707f" font-size="20" font-weight="900">f(x) = ${question.diagram.a}x + ${question.diagram.b}</text>
    </svg>`,
  celebration: () => `
    <svg viewBox="0 0 360 260" role="img" aria-label="Troféu de conclusão">
      <rect width="360" height="260" fill="#f6f8f4"/>
      <path d="M130 62 H230 V125 C230 153 210 174 180 174 C150 174 130 153 130 125 Z" fill="#f2c94c" stroke="#17202a" stroke-width="4"/>
      <path d="M130 82 H92 C92 128 109 148 140 148 M230 82 H268 C268 128 251 148 220 148" fill="none" stroke="#17202a" stroke-width="4"/>
      <path d="M180 174 V207 M145 207 H215 M128 224 H232" stroke="#17202a" stroke-width="6" stroke-linecap="round"/>
      <text x="180" y="119" text-anchor="middle" fill="#17202a" font-size="34" font-weight="900">OB</text>
    </svg>`,
};

init();
