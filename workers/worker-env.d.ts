// Type declarations for Web Worker context
// The main tsconfig includes "dom" which doesn't know about DedicatedWorkerGlobalScope
// This provides the minimal typing needed for our Worker code

declare function postMessage(message: unknown): void;

interface DedicatedWorkerGlobalScope {
  postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

interface StructuredSerializeOptions {
  transfer?: Transferable[];
}
