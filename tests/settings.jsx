import React from "react";
import { createRoot } from "react-dom/client";
import plugin from "../src/plugin.js";
window.submits = 0;
window.notifications = [];
window.registrations = [];
window.saved = {};
const disposers = [];
plugin.register({
  storage: {
    get: (key, fallback) => window.saved[key] ?? fallback,
    set: (key, value) => {
      window.saved[key] = structuredClone(value);
    },
  },
  register: (c) => window.registrations.push(c),
  onDispose: (f) => disposers.push(f),
});
window.mountSecondUI = () => {
  const container = document.createElement("div");
  document.querySelector("form").append(container);
  createRoot(container).render(
    window.registrations.find((c) => c.id === "controls").render(),
  );
};
window.disposePlugin = () => {
  for (const f of disposers) f();
};
createRoot(document.getElementById("root")).render(
  <form
    onSubmit={(e) => {
      e.preventDefault();
      window.submits++;
    }}
  >
    <div
      data-slot="composer-rich-input"
      contentEditable
      suppressContentEditableWarning
      aria-label="Unsent host draft"
    >
      Unsent test draft
    </div>
    {window.registrations.find((c) => c.id === "controls").render()}
  </form>,
);
