/**
 * DomService — DOM scaffolding: container construction, the editor's complete
 * listener wiring and CSS state sync.
 */
import type { EditorContext } from "./context";

export class DomService {
  constructor(private ctx: EditorContext) {}

  /** Keep the container's CSS state in sync with options / focus. */
  updateContainerClass(): void {
    const cls = [
      "se-editor",
      "se-vanilla",
      this.ctx.Features.phoneme.toneFormat === "number"
        ? "se-tone-number"
        : "se-tone-symbol",
      this.ctx.readOnly ? "se-input-readonly" : "",
      this.ctx.state.focused ? "se-focused" : "",
      this.ctx.className,
    ]
      .filter(Boolean)
      .join(" ");
    this.ctx.container.className = cls;
  }

  buildDOM(): void {
    const container = document.createElement("div");
    container.className = "se-editor se-vanilla";
    container.tabIndex = 0;
    container.setAttribute("spellcheck", "false");
    if (this.ctx.styleOpts) {
      Object.assign(container.style, this.ctx.styleOpts);
    }

    const content = document.createElement("div");
    content.className = "se-content";
    container.appendChild(content);

    const inputHost = document.createElement("div");
    inputHost.className = "se-input-host";
    inputHost.setAttribute("contenteditable", "true");
    inputHost.setAttribute("spellcheck", "false");
    container.appendChild(inputHost);

    this.ctx.hostEl.appendChild(container);
    this.ctx.container = container;
    this.ctx.content = content;
    this.ctx.inputHost = inputHost;
    this.updateContainerClass();
  }

  attach(): void {
    const { ctx } = this;
    ctx.container.addEventListener("keydown", ctx.boundKeyDown);
    ctx.container.addEventListener("mousedown", ctx.boundMouseDown);
    ctx.container.addEventListener("dblclick", ctx.boundDoubleClick);
    ctx.container.addEventListener("contextmenu", ctx.boundContextMenu);
    ctx.container.addEventListener("copy", ctx.boundCopy);
    ctx.container.addEventListener("paste", ctx.boundPaste);
    ctx.container.addEventListener("dragover", ctx.boundDragOver);
    ctx.container.addEventListener("drop", ctx.boundDrop);
    ctx.container.addEventListener("focusin", ctx.boundFocus);
    ctx.container.addEventListener("focusout", ctx.boundBlur);
    ctx.container.addEventListener("compositionstart", ctx.boundCompositionStart);
    ctx.container.addEventListener("compositionupdate", ctx.boundCompositionUpdate);
    ctx.container.addEventListener("compositionend", ctx.boundCompositionEnd);
    ctx.inputHost.addEventListener("input", ctx.boundInputHostInput);
    ctx.inputHost.addEventListener("beforeinput", ctx.boundBeforeInput);
    ctx.content.addEventListener("click", ctx.boundContentClick);
    ctx.content.addEventListener("mousedown", ctx.boundContentMouseDown);
    ctx.content.addEventListener("mouseover", ctx.boundContentMouseOver);
    ctx.content.addEventListener("mouseout", ctx.boundContentMouseOut);
    document.addEventListener("selectionchange", ctx.boundSelectionChange);
    window.addEventListener("resize", ctx.boundScroll);
    window.addEventListener("scroll", ctx.boundScroll, true);
    window.addEventListener("mouseup", ctx.boundMouseUp, true);
    window.addEventListener("mousemove", ctx.boundMouseMove, true);
    window.addEventListener("blur", ctx.boundWindowBlur);
    document.addEventListener("mousedown", ctx.boundDocMouseDown, true);
    document.addEventListener("copy", ctx.boundDocCopy, true);
    document.addEventListener("cut", ctx.boundDocCut, true);
  }

  detach(): void {
    const { ctx } = this;
    ctx.container.removeEventListener("keydown", ctx.boundKeyDown);
    ctx.container.removeEventListener("mousedown", ctx.boundMouseDown);
    ctx.container.removeEventListener("dblclick", ctx.boundDoubleClick);
    ctx.container.removeEventListener("contextmenu", ctx.boundContextMenu);
    ctx.container.removeEventListener("copy", ctx.boundCopy);
    ctx.container.removeEventListener("paste", ctx.boundPaste);
    ctx.container.removeEventListener("dragover", ctx.boundDragOver);
    ctx.container.removeEventListener("drop", ctx.boundDrop);
    ctx.container.removeEventListener("focusin", ctx.boundFocus);
    ctx.container.removeEventListener("focusout", ctx.boundBlur);
    ctx.container.removeEventListener("compositionstart", ctx.boundCompositionStart);
    ctx.container.removeEventListener("compositionupdate", ctx.boundCompositionUpdate);
    ctx.container.removeEventListener("compositionend", ctx.boundCompositionEnd);
    ctx.inputHost.removeEventListener("input", ctx.boundInputHostInput);
    ctx.inputHost.removeEventListener("beforeinput", ctx.boundBeforeInput);
    ctx.content.removeEventListener("click", ctx.boundContentClick);
    ctx.content.removeEventListener("mousedown", ctx.boundContentMouseDown);
    ctx.content.removeEventListener("mouseover", ctx.boundContentMouseOver);
    ctx.content.removeEventListener("mouseout", ctx.boundContentMouseOut);
    document.removeEventListener("selectionchange", ctx.boundSelectionChange);
    window.removeEventListener("resize", ctx.boundScroll);
    window.removeEventListener("scroll", ctx.boundScroll, true);
    window.removeEventListener("mouseup", ctx.boundMouseUp, true);
    window.removeEventListener("mousemove", ctx.boundMouseMove, true);
    window.removeEventListener("blur", ctx.boundWindowBlur);
    document.removeEventListener("mousedown", ctx.boundDocMouseDown, true);
    document.removeEventListener("copy", ctx.boundDocCopy, true);
    document.removeEventListener("cut", ctx.boundDocCut, true);
  }

  destroyOverlays(): void {
    this.ctx.bus.emit("overlay:close");
  }
}
