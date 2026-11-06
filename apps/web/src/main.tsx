import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./auth/AuthGate";
import "./styles.css";

// React starts at the root element declared in index.html. StrictMode helps
// surface accidental side effects during local development.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate><App /></AuthGate>
  </React.StrictMode>
);
