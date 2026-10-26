/** The parts of noVNC's RFB client (https://github.com/novnc/noVNC/blob/master/docs/API.md) that the VM viewer uses. */
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean; wsProtocols?: string[] });
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
    clipboardPasteFrom(text: string): void;
  }
}
