declare module 'drawflow' {
  export default class Drawflow {
    constructor(element: HTMLElement, render?: unknown, parent?: unknown);
    drawflow: { drawflow: { Home: { data: Record<string, unknown> } } };
    reroute: boolean;
    curvature: number;
    start(): void;
    clear(): void;
    import(data: unknown): void;
    export(): unknown;
    addNode(
      name: string, inputs: number, outputs: number,
      posX: number, posY: number, className: string,
      data: Record<string, unknown>, html: string,
    ): number;
    removeNodeId(id: string): void;
    removeSingleConnection(
      outputId: string, inputId: string,
      outputClass: string, inputClass: string,
    ): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    zoom_in(): void;
    zoom_out(): void;
    zoom_reset(): void;
  }
}
