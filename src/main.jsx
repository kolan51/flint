import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./monaco.js";
import App from "./App.jsx";
import { PaneProvider } from "./panes.jsx";
import { AppProvider } from "./store.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppProvider>
      <PaneProvider>
        <App />
      </PaneProvider>
    </AppProvider>
  </React.StrictMode>
);
