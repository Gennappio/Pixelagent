import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// The two pixel fonts, latin only: the files are bundled, nothing is fetched from elsewhere.
import "@fontsource/dotgothic16/latin-400.css";
import "@fontsource/silkscreen/latin-400.css";
import "./pixel.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
