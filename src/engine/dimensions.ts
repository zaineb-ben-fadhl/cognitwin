/**
 * Dimension registry — the single source of truth for what each dimension means, how it is
 * measured, and how it should be interpreted. The in-app "Methods" page and docs/DIMENSIONS.md
 * are both generated from this file, so documentation can never drift from the implementation.
 *
 * Adding a dimension = add a TaskSpec + one entry here. Nothing else in the engine changes.
 */
import type { AnyTaskSpec } from './tasks/types';
import { attentionTask } from './tasks/attention';
import { memoryTask } from './tasks/memory';
import { speedTask } from './tasks/speed';
import { inhibitionTask } from './tasks/inhibition';
import { flexibilityTask } from './tasks/flexibility';
import { reasoningTask } from './tasks/reasoning';
import type { DimensionId } from './types';

export interface Strategy {
  key: string;
  title: string;
  detail: string;
  source?: string;
}

export interface DimensionDoc {
  id: DimensionId;
  name: string;
  short: string;
  /** Icon name from lucide-react. */
  icon: string;
  definition: string;
  everyday: string[];
  /** What the score does NOT tell you. */
  notThis: string;
  task: AnyTaskSpec;
  scoring: string;
  uncertainty: string;
  biases: Array<{ bias: string; mitigation: string }>;
  strategies: Strategy[];
  /** Real-world practice suggestions ("transfer missions"). */
  missions: string[];
  references: string[];
  /** Words users may type to refer to this dimension (coach intent detection). */
  synonyms: string[];
}

const COMMON_SCORING =
  'Every trial is a success (correct and inside the calibrated response window) or not. A Bayesian item-response model ' +
  'turns these outcomes into an ability estimate θ with its uncertainty. The percentage shown is the expected share of the ' +
  "task's 10 difficulty levels you would master at that ability — a criterion-referenced score relative to the task, " +
  'not a ranking against other people.';

const COMMON_UNCERTAINTY =
  'Shown as an 80 % credible interval and a confidence label (high ≤ 16 pts wide, moderate ≤ 30, low otherwise). ' +
  'It narrows with more trials and widens again with inactivity (the Brain Twin adds drift of 0.003 logit²/day), ' +
  'because skills change when they are not observed.';

export const DIMENSIONS: DimensionDoc[] = [
  {
    id: 'attention',
    name: 'Selective Attention',
    short: 'Attention',
    icon: 'Crosshair',
    definition:
      'The ability to direct and keep your focus on what matters for the goal at hand while filtering out competing visual information.',
    everyday: ['Finding a friend in a crowd', 'Spotting a typo in a long document', 'Locating an app icon on a busy screen'],
    notThis: 'It does not describe how well you pay attention in class or at work in general — only visual search on this task.',
    task: attentionTask,
    scoring:
      COMMON_SCORING +
      ' Descriptive extras: search cost per item (slope of response time on the number of items) and distractor clicks.',
    uncertainty: COMMON_UNCERTAINTY,
    biases: [
      { bias: 'Colour-vision differences', mitigation: 'Colour-blind-safe palette by default and a colour-independent mode that uses fill patterns instead of colour.' },
      { bias: 'Input device and motor speed (mouse vs touch, latency)', mitigation: 'A 10-tap calibration scales every response window to your own device and pace.' },
      { bias: 'Screen size', mitigation: 'The grid scales to the viewport; difficulty comes from the number of items, not their pixel size.' },
      { bias: 'Environmental distractions', mitigation: 'Tab switches and long pauses are detected; affected trials count less and the session is flagged.' },
    ],
    strategies: [
      { key: 'template', title: 'Name the target', detail: 'Say the target to yourself ("orange triangle") before scanning — a clear template guides the eyes.', source: 'Wolfe, 1994 (Guided Search)' },
      { key: 'scan', title: 'Scan systematically', detail: 'Sweep row by row instead of jumping randomly; it avoids re-checking the same area.' },
      { key: 'environment', title: 'Reduce competing input', detail: 'Silence notifications for the length of a session; interruptions cost more focus than they seem.' },
      { key: 'micro-break', title: 'Micro-breaks', detail: 'A 20-second look into the distance between sessions helps keep visual focus fresh.' },
    ],
    missions: [
      'Do one 20-minute single-task block today with notifications off, then note how it felt.',
      'While reading, find every occurrence of one chosen word on a page in under a minute.',
    ],
    references: [
      'Treisman, A. & Gelade, G. (1980). A feature-integration theory of attention. Cognitive Psychology, 12, 97–136.',
      'Wolfe, J. M. (1994). Guided Search 2.0. Psychonomic Bulletin & Review, 1, 202–238.',
      'Posner, M. I. & Petersen, S. E. (1990). The attention system of the human brain. Annual Review of Neuroscience, 13, 25–42.',
    ],
    synonyms: ['attention', 'focus', 'search', 'concentration', 'target', 'hunt', 'visual'],
  },
  {
    id: 'memory',
    name: 'Working Memory',
    short: 'Memory',
    icon: 'Layers',
    definition:
      'The ability to hold a small amount of information in mind for a few seconds and use it — here, a spatial sequence you must reproduce in order.',
    everyday: ['Remembering a phone code while typing it', 'Following multi-step directions', 'Keeping track of a conversation while taking notes'],
    notThis: 'It is not long-term memory (remembering yesterday) and not general intelligence.',
    task: memoryTask,
    scoring:
      COMMON_SCORING +
      ' A trial is a success only if the whole sequence is reproduced in order. Partial credit (positions correct) and order-vs-item errors are reported descriptively.',
    uncertainty:
      COMMON_UNCERTAINTY +
      ' Sequence tasks give few trials per minute, so a single session leaves a wider interval than speeded tasks.',
    biases: [
      { bias: 'Practice / familiarity effects', mitigation: 'Gains are labelled as task progress; transfer missions check whether gains carry over to daily life.' },
      { bias: 'Strategy differences (verbal labelling vs visual)', mitigation: 'Strategies are taught openly to everyone, so the score reflects practised skill, not secret tricks.' },
      { bias: 'Lapses during the flash sequence', mitigation: 'Focus loss during presentation down-weights that trial.' },
      { bias: 'Test anxiety', mitigation: 'No visible countdown during recall, generous response window, and an optional practice trial.' },
    ],
    strategies: [
      { key: 'chunk', title: 'Chunk the path', detail: 'Group the tiles into pairs or triplets ("top-left, middle — then the corner trio").', source: 'Cowan, 2001' },
      { key: 'shape', title: 'See a shape', detail: 'Imagine the sequence as a line drawing; shapes are easier to hold than isolated points.' },
      { key: 'rehearse', title: 'Rehearse silently', detail: 'Replay the path in your head once before you start clicking.' },
      { key: 'sleep', title: 'Rest consolidates practice', detail: 'Spread practice over days; skills settle between sessions, not only during them.', source: 'Cepeda et al., 2006' },
    ],
    missions: [
      'Memorise your next shopping list (6–8 items) using chunks of three, and only check it at the end.',
      'Repeat a new phone number or code back in two chunks before writing it down.',
    ],
    references: [
      'Baddeley, A. (2003). Working memory: looking back and looking forward. Nature Reviews Neuroscience, 4, 829–839.',
      'Cowan, N. (2001). The magical number 4 in short-term memory. Behavioral and Brain Sciences, 24, 87–114.',
      'Kessels, R. P. C. et al. (2000). The Corsi block-tapping task: standardization and normative data. Applied Neuropsychology, 7, 252–258.',
      'Melby-Lervåg, M. & Hulme, C. (2013). Is working memory training effective? A meta-analytic review. Developmental Psychology, 49, 270–291.',
    ],
    synonyms: ['memory', 'working memory', 'remember', 'sequence', 'recall', 'span', 'corsi'],
  },
  {
    id: 'speed',
    name: 'Processing Speed',
    short: 'Speed',
    icon: 'Zap',
    definition: 'How quickly you can take in simple visual information and make an accurate decision about it.',
    everyday: ['Checking that two codes match', 'Reacting to a traffic light', 'Skimming a list for differences'],
    notThis: 'Fast is not the same as smart. Speed varies with rest, device and time of day — compare yourself with yourself.',
    task: speedTask,
    scoring:
      COMMON_SCORING + ' Descriptive extras: correct decisions per minute and response time on same vs different pairs.',
    uncertainty: COMMON_UNCERTAINTY + ' Speed is the most state-sensitive dimension (sleep, time of day), so day-to-day swings are expected.',
    biases: [
      { bias: 'Device latency and motor speed', mitigation: 'Personal calibration scales the response windows (factor 1.0–1.6).' },
      { bias: 'Age-related differences in pace', mitigation: 'No population norms: the score is criterion-referenced and progress is always compared with your own history.' },
      { bias: 'Time of day / fatigue', mitigation: 'Self-reported energy and time of day are logged; the coach separates state effects from real trends.' },
      { bias: 'Keyboard vs touch', mitigation: 'Input type is recorded per session and both are calibrated.' },
    ],
    strategies: [
      { key: 'rhythm', title: 'Find a rhythm', detail: 'A steady pace beats bursts of speed followed by errors.' },
      { key: 'pairs', title: 'Compare in pairs', detail: 'Compare position by position from left to right rather than looking at the whole row at once.' },
      { key: 'trust', title: 'Trust the first look', detail: 'On easy pairs, your first impression is usually right — avoid double-checking.' },
      { key: 'state', title: 'Practise when alert', detail: 'Speed is sensitive to energy; prefer sessions at a time of day you feel fresh.' },
    ],
    missions: [
      'Proof-read one paragraph for differences against a reference version in under 60 seconds.',
      'Sort a deck of cards by colour as fast as you can, twice, and compare times.',
    ],
    references: [
      'Salthouse, T. A. (1996). The processing-speed theory of adult age differences in cognition. Psychological Review, 103, 403–428.',
      'Kail, R. & Salthouse, T. A. (1994). Processing speed as a mental capacity. Acta Psychologica, 86, 199–225.',
    ],
    synonyms: ['speed', 'processing speed', 'fast', 'quick', 'reaction', 'sprint', 'pace', 'slow'],
  },
  {
    id: 'inhibition',
    name: 'Inhibitory Control',
    short: 'Inhibition',
    icon: 'Hand',
    definition:
      'The ability to resist a strong but wrong pull — ignoring misleading information and holding back an automatic response when needed.',
    everyday: ['Not replying to a message mid-meeting', 'Ignoring background chatter while reading', 'Stopping at an amber light'],
    notThis: 'It does not measure self-control, willpower or personality — only resisting visual conflict in this task.',
    task: inhibitionTask,
    scoring:
      COMMON_SCORING +
      ' Descriptive extras: distraction cost (incongruent − congruent median RT), accuracy on conflict trials, and STOP signals respected.',
    uncertainty: COMMON_UNCERTAINTY,
    biases: [
      { bias: 'Handedness / key mapping', mitigation: 'Both arrow keys and F/J are accepted, and on-screen buttons are mirrored for touch.' },
      { bias: 'Speed–accuracy strategy', mitigation: 'Both speed and accuracy are reported; the coach flags fast-error patterns instead of rewarding rushing.' },
      { bias: 'Device latency', mitigation: 'Calibrated response windows.' },
    ],
    strategies: [
      { key: 'center', title: 'Anchor your gaze', detail: 'Keep your eyes on the centre spot between trials so the middle arrow is where you already look.', source: 'Eriksen & Eriksen, 1974' },
      { key: 'pause', title: 'A micro-pause on conflict', detail: 'When the arrows disagree, a tiny pause is cheaper than an error.' },
      { key: 'accuracy-first', title: 'Accuracy first', detail: 'Aim for clean responses; speed follows naturally once conflict feels familiar.' },
    ],
    missions: [
      'When you feel the urge to check your phone today, wait 10 seconds first — notice whether the urge passes.',
      'Read a page with music or chatter in the background and summarise it afterwards.',
    ],
    references: [
      'Eriksen, B. A. & Eriksen, C. W. (1974). Effects of noise letters upon the identification of a target letter. Perception & Psychophysics, 16, 143–149.',
      'Diamond, A. (2013). Executive functions. Annual Review of Psychology, 64, 135–168.',
      'Verbruggen, F. & Logan, G. D. (2008). Response inhibition in the stop-signal paradigm. Trends in Cognitive Sciences, 12, 418–424.',
    ],
    synonyms: ['inhibition', 'inhibitory', 'self-control', 'impulse', 'distraction', 'arrow', 'flanker', 'resist'],
  },
  {
    id: 'flexibility',
    name: 'Cognitive Flexibility',
    short: 'Flexibility',
    icon: 'Shuffle',
    definition: 'The ability to switch smoothly between rules, perspectives or tasks when the situation changes.',
    everyday: ['Switching between two languages', 'Changing plans when a meeting moves', 'Going from email to deep work and back'],
    notThis: 'It is not creativity or open-mindedness as a personality trait — only rule switching in this task.',
    task: flexibilityTask,
    scoring:
      COMMON_SCORING +
      ' Descriptive extras: switch cost (switch − repeat median RT), accuracy drop on switches, and errors that follow the old rule.',
    uncertainty: COMMON_UNCERTAINTY,
    biases: [
      { bias: 'Colour perception', mitigation: 'Colour-independent mode swaps colour for fill (solid vs outline).' },
      { bias: 'Learning the response mapping', mitigation: 'Four practice trials with feedback before any trial counts.' },
      { bias: 'Reading the rule cue', mitigation: 'The cue uses an icon plus one word, and keeps the same position on screen.' },
    ],
    strategies: [
      { key: 'cue', title: 'Read the cue every time', detail: 'Glance at the rule banner on every trial, not just when you think it changed.', source: 'Monsell, 2003' },
      { key: 'say', title: 'Say the rule', detail: 'Silently say "shape" or "colour" when the banner appears — naming the rule speeds the switch.' },
      { key: 'prepare', title: 'Use the preparation time', detail: 'The cue appears a moment before the shape: use that moment to load the new rule.' },
    ],
    missions: [
      'Alternate between two different tasks every 10 minutes for half an hour, with a short ritual at each switch.',
      'Explain one idea to two different audiences (a child and an expert).',
    ],
    references: [
      'Monsell, S. (2003). Task switching. Trends in Cognitive Sciences, 7, 134–140.',
      'Rogers, R. D. & Monsell, S. (1995). Costs of a predictable switch between simple cognitive tasks. Journal of Experimental Psychology: General, 124, 207–231.',
      'Miyake, A. et al. (2000). The unity and diversity of executive functions. Cognitive Psychology, 41, 49–100.',
    ],
    synonyms: ['flexibility', 'flexible', 'switch', 'switching', 'shifting', 'multitask', 'rule', 'adapt'],
  },
  {
    id: 'reasoning',
    name: 'Abstract Reasoning',
    short: 'Reasoning',
    icon: 'Puzzle',
    definition:
      'The ability to detect rules and relationships in new information and use them to reach a conclusion — here, completing visual patterns.',
    everyday: ['Spotting a trend in a table', 'Debugging why something does not work', 'Solving a puzzle game'],
    notThis: 'It is not a measure of intelligence and is not compared with population norms. Puzzles are generated, so there is no fixed answer key to memorise.',
    task: reasoningTask,
    scoring:
      COMMON_SCORING +
      ' Speed is recorded but not rewarded (generous 34–70 s window). The chance of a lucky guess (≈ 1/number of options) is part of the model.',
    uncertainty:
      COMMON_UNCERTAINTY +
      ' Few, long trials per session make this the widest interval after one session; it tightens over several sessions.',
    biases: [
      { bias: 'Familiarity with puzzle tests', mitigation: 'Endless procedurally generated grids (no item can be learned by heart) and a worked example first.' },
      { bias: 'Language and education', mitigation: 'No words or numbers inside puzzles — only shapes, counts, fills and sizes.' },
      { bias: 'Time pressure anxiety', mitigation: 'Long windows and a calm timer; speed never adds to the score.' },
      { bias: 'Lucky guesses', mitigation: 'Modelled explicitly with a guessing parameter (c = 0.15).' },
    ],
    strategies: [
      { key: 'one-attribute', title: 'One attribute at a time', detail: 'Check shape, then count, then fill, then size — never all at once.', source: 'Carpenter, Just & Shell, 1990' },
      { key: 'rows-first', title: 'Rows first, then columns', detail: 'Find what changes along a row; then verify it holds down the columns.' },
      { key: 'eliminate', title: 'Eliminate', detail: 'Cross out options that break any rule you are sure of before choosing.' },
      { key: 'verbalise', title: 'Put the rule in words', detail: '"Each row has one of each fill" — saying it makes slips visible.' },
    ],
    missions: [
      'Solve one logic puzzle (sudoku, nonogram, kakuro) and explain your key step to someone.',
      'Look at a chart in the news and write one sentence about the pattern it shows.',
    ],
    references: [
      'Carpenter, P. A., Just, M. A. & Shell, P. (1990). What one intelligence test measures. Psychological Review, 97, 404–431.',
      'Matzen, L. E. et al. (2010). Recreating Raven’s: software for systematically generating large numbers of Raven-like matrix problems. Behavior Research Methods, 42, 525–541.',
    ],
    synonyms: ['reasoning', 'logic', 'pattern', 'puzzle', 'matrix', 'problem solving', 'abstract', 'rules'],
  },
];

export const DIMENSION_IDS: DimensionId[] = DIMENSIONS.map((d) => d.id);

const byId = new Map(DIMENSIONS.map((d) => [d.id, d]));
const byTask = new Map(DIMENSIONS.map((d) => [d.task.id, d]));

export function getDimension(id: DimensionId): DimensionDoc {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown dimension: ${id}`);
  return d;
}

export function findDimension(id: DimensionId): DimensionDoc | undefined {
  return byId.get(id);
}

export function findTask(taskId: string): AnyTaskSpec | undefined {
  return byTask.get(taskId)?.task;
}

export function getTask(taskId: string): AnyTaskSpec {
  const d = byTask.get(taskId);
  if (!d) throw new Error(`Unknown task: ${taskId}`);
  return d.task;
}

export function taskForDimension(id: DimensionId): AnyTaskSpec {
  return getDimension(id).task;
}

export const GENERAL_REFERENCES = [
  'Embretson, S. E. & Reise, S. P. (2000). Item Response Theory for Psychologists. Erlbaum.',
  'van der Linden, W. J. & Glas, C. A. W. (2010). Elements of Adaptive Testing. Springer.',
  'Wilson, R. C. et al. (2019). The Eighty Five Percent Rule for optimal learning. Nature Communications, 10, 4646.',
  'Bjork, E. L. & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: creating desirable difficulties to enhance learning.',
  'Cepeda, N. J. et al. (2006). Distributed practice in verbal recall tasks: a review and quantitative synthesis. Psychological Bulletin, 132, 354–380.',
  'Simons, D. J. et al. (2016). Do "brain-training" programs work? Psychological Science in the Public Interest, 17, 103–186.',
  'Hattie, J. & Timperley, H. (2007). The power of feedback. Review of Educational Research, 77, 81–112.',
  'Barrett, L. F. et al. (2019). Emotional expressions reconsidered. Psychological Science in the Public Interest, 20, 1–68.',
];
