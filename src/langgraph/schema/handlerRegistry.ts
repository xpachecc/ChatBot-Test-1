import type { CfsState } from "../state.js";

type NodeHandler =
  | ((state: CfsState) => Partial<CfsState>)
  | ((state: CfsState) => Promise<Partial<CfsState>>);
type RouterFn = (state: CfsState) => string;
type ConfigInitFn = () => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConfigFn = (...args: any[]) => any;

const handlers = new Map<string, NodeHandler>();
const routers = new Map<string, RouterFn>();
const configs = new Map<string, ConfigInitFn>();
const configFns = new Map<string, ConfigFn>();

export function registerHandler(ref: string, fn: NodeHandler): void {
  handlers.set(ref, fn);
}

export function registerRouter(ref: string, fn: RouterFn): void {
  routers.set(ref, fn);
}

export function registerConfig(ref: string, fn: ConfigInitFn): void {
  configs.set(ref, fn);
}

export function resolveHandler(ref: string): NodeHandler {
  const fn = handlers.get(ref);
  if (!fn) throw new Error(`Handler not registered: "${ref}". Call the appropriate registration function first.`);
  return fn;
}

export function resolveRouter(ref: string): RouterFn {
  const fn = routers.get(ref);
  if (!fn) throw new Error(`Router not registered: "${ref}". Call the appropriate registration function first.`);
  return fn;
}

export function resolveConfig(ref: string): ConfigInitFn {
  const fn = configs.get(ref);
  if (!fn) throw new Error(`Config not registered: "${ref}". Call the appropriate registration function first.`);
  return fn;
}

export function getRegisteredHandlerIds(): string[] {
  return [...handlers.keys()];
}

export function getRegisteredRouterIds(): string[] {
  return [...routers.keys()];
}

export function getRegisteredConfigIds(): string[] {
  return [...configs.keys()];
}

export function registerConfigFn(ref: string, fn: ConfigFn): void {
  configFns.set(ref, fn);
}

export function resolveConfigFn(ref: string): ConfigFn {
  const fn = configFns.get(ref);
  if (!fn) throw new Error(`ConfigFn not registered: "${ref}". Call registerConfigFn first.`);
  return fn;
}

export function getRegisteredConfigFnIds(): string[] {
  return [...configFns.keys()];
}

export function clearRegistry(): void {
  handlers.clear();
  routers.clear();
  configs.clear();
  configFns.clear();
}
