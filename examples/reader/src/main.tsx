import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./lab.css";

const container = document.getElementById("root");
if (container === null) throw new Error("the lab root element is missing");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
