import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";
import "./ui/space.css";
import "./ui/nature.css";
import "./ui/albums.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
