// A DOM helper instead of a framework.
//
// Strings passed as children become text nodes, never markup, so idea text
// cannot inject HTML. That is the whole reason this exists rather than
// innerHTML with template strings.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    // null, undefined and false mean "leave it off", for a class and a handler too
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  append(node, children);
  return node;
}

export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}

// mount() rebuilds a page under whatever had focus, and an element kept
// across rebuilds is blurred the moment the new tree takes it (appending
// moves it out of the page), even though it goes straight back.
// holdFocus(root), called before the new tree is built, remembers the focused element inside `root` and hands
// back a function that puts focus (and a text field's caret) back on it, or
// on its replacement in the new tree: found by id, data-pick, data-check,
// name, href, or failing those the same tag, class and text, inside the same
// [data-idea] card. Nothing inside `root` had focus: null.
export function holdFocus(root) {
  const was = document.activeElement;
  if (!was || was === root || !root.contains(was)) return null;
  let sel = null;
  try { if (typeof was.selectionStart === "number") sel = [was.selectionStart, was.selectionEnd, was.selectionDirection]; } catch { /* not a text field */ }
  const card = was.closest("[data-idea]");
  const scope = card ? `[data-idea="${CSS.escape(card.dataset.idea)}"] ` : "";
  const attr = (k, v) => `[${k}="${CSS.escape(v)}"]`;
  const tag = was.tagName.toLowerCase();
  const key = was.id ? `#${CSS.escape(was.id)}`
    : was.dataset.pick ? attr("data-pick", was.dataset.pick)
    : was.dataset.check ? attr("data-check", was.dataset.check)
    : was.name ? tag + attr("name", was.name) + (was.type === "radio" ? attr("value", was.value) : "")
    : was.getAttribute("href") ? tag + attr("href", was.getAttribute("href"))
    : null;
  const text = was.textContent;
  const find = () => key ? root.querySelector(scope + key)
    : [...root.querySelectorAll(scope + tag)].find((n) => n.className === was.className && n.textContent === text);
  return () => {
    if (root.contains(document.activeElement) && document.activeElement !== root) return;   // someone already placed it
    const to = was.isConnected && root.contains(was) ? was : find();
    if (!to) return;
    to.focus({ preventScroll: true });
    if (sel && to.value !== undefined) try { to.setSelectionRange(...sel); } catch { /* not a text field */ }
  };
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
