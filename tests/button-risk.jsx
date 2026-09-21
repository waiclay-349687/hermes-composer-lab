import React from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@host/components/ui/button";
window.submits = 0;
createRoot(document.getElementById("root")).render(
  <form
    onSubmit={(e) => {
      e.preventDefault();
      window.submits++;
    }}
  >
    <input defaultValue="unsent draft" aria-label="Draft" />
    <Button data-testid="old" onClick={() => {}}>
      Old Aa
    </Button>
    <Button
      data-testid="fixed"
      type="button"
      onClick={(e) => e.preventDefault()}
    >
      Safe Aa
    </Button>
  </form>,
);
