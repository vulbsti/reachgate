// Type definitions for reachgate. The implementation is plain ES modules in src/.

/** An invariant result: true/undefined/null = holds, false = violated, string = violated with this message. */
export type Verdict = boolean | string | null | undefined | { ok: boolean; message?: string };

export interface Target<S = any, A = any> {
  name?: string;
  /** The start state. Must be deterministic. */
  initial(): S;
  /** Every action possible in state s (user input, timers, network replies...). */
  affordances(s: S): A[];
  /** Apply one action with your real code. reachgate passes a copy of s, so mutating it is fine. */
  step(s: S, a: A): S;
  /** Must hold in every reachable state. */
  invariants?: Record<string, (s: S) => Verdict>;
  /** Must hold on every transition. */
  transitions?: Record<string, (prev: S, a: A, next: S) => Verdict>;
  /** Labels naming behaviour in s; the baseline records which labels are reachable. */
  observe?(s: S): string[];
  /** Exact identity for dedupe (default: canonical JSON of s). */
  hash?(s: S): unknown;
  /** Coarse cell for Go-Explore's archive (default: hash). */
  abstract?(s: S): unknown;
  /** Defining this turns on deadlock detection: a non-terminal state with no actions is a violation. */
  isTerminal?(s: S): boolean;
  /** How an action prints in witnesses and labels (default: canonical JSON). */
  label?(a: A): string;
  /** Deep copy (default: structuredClone). */
  clone?(s: S): S;
  /** Human descriptions of invariants, shown in reports. */
  describe?: Record<string, string>;
}

export interface Violation { id: string; message?: string }

export interface VisitInfo {
  actions: unknown[];
  violations: Violation[];
  labels: string[];
  hash: string;
  cell: string | null;
  terminal: boolean;
}

/** The uniform async interface the explorer uses for in-process and adapter targets. */
export interface Driver {
  name: string;
  source: string | null;
  kind: 'in-process' | 'adapter';
  invariantIds: string[];
  transitionIds: string[];
  deadlock: boolean;
  describe: Record<string, string>;
  label(a: unknown): string;
  clone(s: unknown): unknown;
  initial(): Promise<unknown>;
  visit(s: unknown): Promise<VisitInfo>;
  step(s: unknown, a: unknown): Promise<{ state: unknown; violations: Violation[]; crash?: undefined } | { crash: string }>;
  close(): Promise<void>;
}

export interface ExploreOptions {
  strategy?: 'bfs' | 'go-explore';
  maxSteps?: number;
  maxStates?: number;
  maxSeconds?: number;
  maxDepth?: number;
  seed?: number;
  /** go-explore: at most this many steps per return to a cell. */
  rollout?: number;
  /** Include "action:<label>" for every offered action in the signature (default true). */
  actionLabels?: boolean;
  /** Keep exploring from states that violate an invariant (default false). */
  expandViolations?: boolean;
  /** go-explore: shrink witnesses to 1-minimal (default true). */
  shrink?: boolean;
  /** Replay every witness twice to prove it reproduces (default true). */
  verify?: boolean;
  onProgress?(stats: Stats & { violations: number; labels: number }): void;
}

export interface Stats {
  steps: number;
  states: number;
  cells: number;
  depth: number;
  /** States not explored further because they violate an invariant (0 with expandViolations). */
  unexpanded: number;
  stoppedBy: 'steps' | 'states' | 'time' | 'exhausted';
  exhaustive: boolean;
  ms: number;
  firstViolation: { id: string; steps: number; states: number; ms: number } | null;
}

export interface Witness {
  id: string;
  message: string;
  count: number;
  length: number;
  /** True only for BFS witnesses: no shorter trace exists. */
  shortest: boolean;
  minimal: 'shortest' | '1-minimal' | 'none';
  first: { steps: number; states: number; ms: number };
  shrunk: { from: number; to: number; replays: number } | null;
  /** False if replaying the witness did not reproduce the violation (nondeterministic target). */
  replayed?: boolean;
  trace: unknown[];
}

export interface ExploreResult {
  target: string;
  options: Required<Pick<ExploreOptions, 'strategy' | 'seed' | 'maxSteps' | 'maxStates' | 'maxSeconds'>> & { maxDepth: number | null; rollout?: number };
  stats: Stats;
  invariants: { id: string; description: string; status: 'holds' | 'violated' }[];
  violations: Witness[];
  /** label -> shortest trace found that reaches it */
  labels: Record<string, unknown[]>;
  warnings: string[];
}

export interface ReplayResult {
  ok: boolean;
  divergence?: { at: number; reason: 'not-offered' | 'crashed'; action: string; offered?: string[]; message?: string };
  violations: (Violation & { at: number })[];
  labels: Set<string>;
  labelAt: Map<string, number>;
  hashes: string[];
  finalHash: string | null;
  offered: string[];
  crashed: boolean;
}

export interface Baseline {
  reachgate: 1;
  tool?: string;
  target: string;
  options: ExploreResult['options'];
  stats: { states: number; steps: number; exhaustive: boolean; stoppedBy: Stats['stoppedBy'] };
  invariants: Record<string, 'holds' | 'violated'>;
  labels: Record<string, unknown[]>;
}

export type FailOn = 'lost' | 'violation' | 'new' | 'removed';

export interface Diff {
  verdict: 'pass' | 'fail';
  reasons: string[];
  failOn: FailOn[];
  lost: { label: string; baselineWitness: unknown[]; diagnosis: { reason: string; step: number; action?: string; offered?: string[]; text: string }; witnessFile?: string }[];
  added: { label: string; witness: unknown[] }[];
  recovered: { label: string; via: string; length: number }[];
  regressed: { id: string; before: string; message: string; witness: unknown[]; length: number; shortest: boolean; witnessFile?: string }[];
  fixed: { id: string }[];
  stillViolated: { id: string; message: string; witness: unknown[]; length: number }[];
  removedInvariants: string[];
  stats: { before: Baseline['stats']; after: Baseline['stats'] };
}

export declare const EXIT: { PASS: 0; FAIL: 1; USAGE: 2; ERROR: 3 };
export declare const DEFAULTS: Required<Omit<ExploreOptions, 'onProgress'>>;
export declare const PROTOCOL_VERSION: 1;
export declare const BASELINE_FORMAT: 1;

export declare class TargetError extends Error {
  fatal: boolean;
  usage: boolean;
}

export declare function defineTarget<S, A>(t: Target<S, A>): Target<S, A>;
export declare function inProcessDriver(t: Target, opts?: { source?: string }): Driver;
export declare function adapterDriver(cmd: string | string[], opts?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<Driver>;
export declare function loadDriver(spec: { target?: string; cmd?: string | string[]; cwd?: string; timeoutMs?: number }): Promise<Driver>;
export declare function splitCommand(cmd: string | string[]): string[];
export declare function explore(driver: Driver, options?: ExploreOptions): Promise<ExploreResult>;
export declare function replay(driver: Driver, trace: unknown[], opts?: { actionLabels?: boolean }): Promise<ReplayResult>;
export declare function shrink(driver: Driver, trace: unknown[], id: string, opts?: { maxReplays?: number }): Promise<{ trace: unknown[]; replays: number; shrunk: boolean; budgetHit?: boolean }>;
export declare function signature(result: ExploreResult, opts?: { version?: string }): Baseline;
export declare function compare(driver: Driver, baseline: Baseline, result: ExploreResult, opts?: { failOn?: FailOn[] }): Promise<Diff>;
export declare function exploreOptionsOf(baseline: Baseline): ExploreOptions;
export declare function traceOf(node: unknown): unknown[];
export declare function exitCodeOf(result: ExploreResult): 0 | 1 | 3;
export declare function summaryLine(result: ExploreResult): string;
export declare function exploreMarkdown(result: ExploreResult, opts: { witnessFiles?: Record<string, string>; driver: Driver }): string;
export declare function diffMarkdown(diff: Diff, opts: { target: string; driver: Driver }): string;
export declare function judge(v: Verdict): string | null;
export declare function canonical(v: unknown): string;
export declare function digest(v: unknown): string;

/** Explore an in-process target (or a driver). */
export declare function run(target: Target | Driver, options?: ExploreOptions): Promise<ExploreResult>;
export declare function replayTrace(target: Target | Driver, trace: unknown[]): Promise<ReplayResult>;
export declare function recordBaseline(target: Target | Driver, options?: ExploreOptions): Promise<Baseline>;
export declare function checkBaseline(target: Target | Driver, baseline: Baseline, options?: ExploreOptions & { failOn?: FailOn[] }): Promise<{ result: ExploreResult; diff: Diff }>;
